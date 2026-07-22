'use strict';

const http = require('http');
const https = require('https');

const orionUrl = process.env.ORION_URL || 'http://orion-v2:1026';
const crateUrl = process.env.CRATE_URL || 'http://crate-db:4200';
const fiwareService = process.env.FIWARE_SERVICE || 'openiot';
const fiwareServicePath = process.env.FIWARE_SERVICEPATH || '/';
const entityType = process.env.ENTITY_TYPE || 'Machine';
const syncIntervalSeconds = Number.parseInt(process.env.SYNC_INTERVAL_SECONDS || '30', 10);
const runOnce = String(process.env.RUN_ONCE || 'false').toLowerCase() === 'true';
const mismatchPolicy = String(process.env.TYPE_MISMATCH_POLICY || 'fail').toLowerCase();
const safeIdentifierPattern = /^[a-z_][a-z0-9_]*$/;

if (!Number.isFinite(syncIntervalSeconds) || syncIntervalSeconds <= 0) {
    throw new Error('SYNC_INTERVAL_SECONDS must be a positive integer');
}
if (!['fail', 'warn'].includes(mismatchPolicy)) {
    throw new Error("TYPE_MISMATCH_POLICY must be 'fail' or 'warn'");
}

const schemaName = `mt${fiwareService.toLowerCase()}`;
const tableName = `et${entityType.toLowerCase()}`;

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestJson(rawUrl, options = {}) {
    const url = new URL(rawUrl);
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const client = url.protocol === 'https:' ? https : http;
    const headers = { ...(options.headers || {}) };
    if (body !== null) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(body);
    }

    return new Promise((resolve, reject) => {
        const request = client.request(url, {
            method: options.method || 'GET',
            headers
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let parsed;
                try {
                    parsed = text ? JSON.parse(text) : null;
                } catch (error) {
                    reject(new Error(`${url} returned invalid JSON (${response.statusCode}): ${text}`));
                    return;
                }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`${url} returned ${response.statusCode}: ${text}`));
                    return;
                }
                resolve(parsed);
            });
        });
        request.on('error', reject);
        request.setTimeout(15000, () => request.destroy(new Error(`Timed out requesting ${url}`)));
        if (body !== null) request.write(body);
        request.end();
    });
}

async function waitFor(name, url) {
    for (let attempt = 1; attempt <= 60; attempt += 1) {
        try {
            await requestJson(url);
            return;
        } catch (error) {
            if (attempt === 60) throw new Error(`${name} did not become reachable at ${url}: ${error.message}`);
            await delay(2000);
        }
    }
}

async function crateSql(statement) {
    return requestJson(`${crateUrl}/_sql`, { method: 'POST', body: { stmt: statement } });
}

async function waitForCrate() {
    for (let attempt = 1; attempt <= 60; attempt += 1) {
        try {
            await crateSql('SELECT 1');
            return;
        } catch (error) {
            if (attempt === 60) throw new Error(`CrateDB did not become reachable at ${crateUrl}: ${error.message}`);
            await delay(2000);
        }
    }
}

function typeContract(ngsiType) {
    switch (String(ngsiType || 'Text').toLowerCase()) {
        case 'number':
        case 'float':
        case 'double':
            return { ddl: 'REAL', dataType: 'real' };
        case 'integer':
        case 'int':
        case 'long':
            return { ddl: 'BIGINT', dataType: 'bigint' };
        case 'boolean':
        case 'bool':
            return { ddl: 'BOOLEAN', dataType: 'boolean' };
        case 'datetime':
        case 'iso8601':
            return { ddl: 'TIMESTAMP WITH TIME ZONE', dataType: 'timestamp with time zone' };
        case 'structuredvalue':
        case 'object':
            return { ddl: 'OBJECT(DYNAMIC)', dataType: 'object' };
        case 'array':
            return { ddl: 'ARRAY(TEXT)', dataType: 'array' };
        default:
            return { ddl: 'TEXT', dataType: 'text' };
    }
}

function quoteIdentifier(identifier) {
    if (!safeIdentifierPattern.test(identifier)) throw new Error(`Unsupported QuantumLeap column name: ${identifier}`);
    return `"${identifier}"`;
}

async function syncSchema() {
    const entities = await requestJson(
        `${orionUrl}/v2/entities?type=${encodeURIComponent(entityType)}&limit=1000`,
        { headers: { 'Fiware-Service': fiwareService, 'Fiware-ServicePath': fiwareServicePath } }
    );
    const typeByAttribute = new Map();
    for (const entity of entities) {
        for (const [rawName, attribute] of Object.entries(entity)) {
            if (rawName === 'id' || rawName === 'type' || !attribute || typeof attribute !== 'object') continue;
            const name = rawName.toLowerCase();
            quoteIdentifier(name);
            const type = String(attribute.type || 'Text');
            const knownType = typeByAttribute.get(name);
            if (knownType && knownType.toLowerCase() !== type.toLowerCase()) {
                throw new Error(`Orion exposes conflicting types for ${name}: ${knownType} and ${type}`);
            }
            typeByAttribute.set(name, type);
        }
    }
    if (!typeByAttribute.size) return;

    const columnResult = await crateSql(
        `SELECT column_name, data_type FROM information_schema.columns ` +
        `WHERE table_schema='${schemaName}' AND table_name='${tableName}'`
    );
    const existingTypeByColumn = new Map(
        columnResult.rows.map(([name, type]) => [name, String(type).toLowerCase()])
    );
    const mismatches = [];

    for (const [name, ngsiType] of [...typeByAttribute].sort(([left], [right]) => left.localeCompare(right))) {
        const contract = typeContract(ngsiType);
        const existingType = existingTypeByColumn.get(name);
        if (existingType) {
            if (existingType !== contract.dataType) {
                mismatches.push(
                    `${schemaName}.${tableName}.${name} is ${existingType}; ` +
                    `Orion requires ${contract.dataType} (${ngsiType})`
                );
            }
            continue;
        }

        try {
            await crateSql(
                `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ` +
                `ADD COLUMN ${quoteIdentifier(name)} ${contract.ddl}`
            );
            console.log(`Added historical column ${schemaName}.${tableName}.${name} (${contract.ddl})`);
        } catch (error) {
            console.error(`WARN: failed to add historical column ${schemaName}.${tableName}.${name}: ${error.message}`);
        }
    }

    if (mismatches.length) {
        const message = `Historical schema type mismatch:\n${mismatches.join('\n')}`;
        if (mismatchPolicy === 'fail') throw new Error(message);
        console.error(`WARN: ${message}`);
    }
}

async function main() {
    await waitFor('Orion', `${orionUrl}/version`);
    await waitForCrate();
    do {
        await syncSchema();
        if (!runOnce) await delay(syncIntervalSeconds * 1000);
    } while (!runOnce);
}

main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
});
