'use strict';

const http = require('http');
const https = require('https');

const orionUrl = process.env.ORION_URL || 'http://orion-v2:1026';
const crateUrl = process.env.CRATE_URL || 'http://crate-db:4200';
const fiwareService = process.env.FIWARE_SERVICE || 'openiot';
const fiwareServicePath = process.env.FIWARE_SERVICEPATH || '/';
const entityType = process.env.ENTITY_TYPE || 'Machine';
const applyMigration = String(process.env.MIGRATION_APPLY || 'false').toLowerCase() === 'true';
const migrationId = process.env.MIGRATION_ID || 'bounded_number_v1';
const boundedMetricPattern = /(_since_last_pm|_since_last_air_filter_pm|_since_replacement)$/;
const safeIdentifierPattern = /^[a-z_][a-z0-9_]*$/;

if (!/^[a-z0-9_]+$/.test(migrationId)) {
    throw new Error('MIGRATION_ID may contain only lowercase letters, digits, and underscores');
}

const schemaName = `mt${fiwareService.toLowerCase()}`;
const tableName = `et${entityType.toLowerCase()}`;
const legacySuffix = `__legacy_${migrationId}`;

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

function quoteIdentifier(identifier) {
    if (!safeIdentifierPattern.test(identifier)) {
        throw new Error(`Unsafe SQL identifier: ${identifier}`);
    }
    return `"${identifier}"`;
}

async function crateSql(statement) {
    return requestJson(`${crateUrl}/_sql`, { method: 'POST', body: { stmt: statement } });
}

async function readColumns() {
    const result = await crateSql(
        `SELECT column_name, data_type FROM information_schema.columns ` +
        `WHERE table_schema='${schemaName}' AND table_name='${tableName}' ORDER BY column_name`
    );
    return result.rows.map(([name, type]) => ({ name, type: String(type).toLowerCase() }));
}

async function restoreViews(views) {
    for (const view of views) {
        await crateSql(
            `CREATE OR REPLACE VIEW ${quoteIdentifier(schemaName)}.${quoteIdentifier(view.name)} AS ${view.definition}`
        );
    }
}

async function main() {
    const entities = await requestJson(
        `${orionUrl}/v2/entities?type=${encodeURIComponent(entityType)}&limit=1000`,
        { headers: { 'Fiware-Service': fiwareService, 'Fiware-ServicePath': fiwareServicePath } }
    );

    const numberAttributes = new Set();
    const wrongOrionTypes = new Set();
    for (const entity of entities) {
        for (const [name, attribute] of Object.entries(entity)) {
            if (!boundedMetricPattern.test(name)) continue;
            const type = String(attribute?.type || 'missing');
            if (type.toLowerCase() === 'number') numberAttributes.add(name.toLowerCase());
            else wrongOrionTypes.add(`${name}=${type}`);
        }
    }
    if (wrongOrionTypes.size) {
        throw new Error(
            'Orion still exposes bounded counters with non-Number types:\n' +
            [...wrongOrionTypes].sort().join('\n') +
            '\nMigrate the IoT Agent registry, restart the agent, and wait for fresh telemetry first.'
        );
    }

    const columns = await readColumns();
    const columnByName = new Map(columns.map((column) => [column.name, column]));
    const objectColumns = columns.filter(
        (column) => boundedMetricPattern.test(column.name) && column.type === 'object'
    );
    if (!objectColumns.length) {
        console.log(`No bounded OBJECT columns require migration in ${schemaName}.${tableName}.`);
        return;
    }

    for (const column of objectColumns) {
        quoteIdentifier(column.name);
        if (!numberAttributes.has(column.name)) {
            throw new Error(`${column.name} is OBJECT in CrateDB but is not currently confirmed as Number in Orion`);
        }
        const legacyName = `${column.name}${legacySuffix}`;
        quoteIdentifier(legacyName);
        if (columnByName.has(legacyName)) {
            throw new Error(`Backup column already exists: ${schemaName}.${tableName}.${legacyName}`);
        }
    }

    const viewResult = await crateSql(
        `SELECT table_name, view_definition FROM information_schema.views ` +
        `WHERE table_schema='${schemaName}' ORDER BY table_name`
    );
    const tableReference = `"${schemaName}"."${tableName}"`;
    const affectedViews = viewResult.rows
        .map(([name, definition]) => ({ name, definition }))
        .filter((view) => String(view.definition).includes(tableReference));
    affectedViews.forEach((view) => quoteIdentifier(view.name));

    console.log(`Bounded columns to migrate: ${objectColumns.length}`);
    console.log(`Views to rebuild: ${affectedViews.length}`);
    for (const column of objectColumns) {
        console.log(`  ${column.name} (OBJECT -> REAL; backup ${column.name}${legacySuffix})`);
    }
    if (!applyMigration) {
        console.log('Dry run only. Set MIGRATION_APPLY=true after stopping QuantumLeap and historical-schema-sync.');
        return;
    }

    let viewsDropped = false;
    const renamedColumns = [];
    try {
        for (const view of affectedViews) {
            await crateSql(`DROP VIEW ${quoteIdentifier(schemaName)}.${quoteIdentifier(view.name)}`);
        }
        viewsDropped = affectedViews.length > 0;

        for (const column of objectColumns) {
            const legacyName = `${column.name}${legacySuffix}`;
            await crateSql(
                `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ` +
                `RENAME COLUMN ${quoteIdentifier(column.name)} TO ${quoteIdentifier(legacyName)}`
            );
            renamedColumns.push({ original: column.name, legacy: legacyName });
            await crateSql(
                `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ` +
                `ADD COLUMN ${quoteIdentifier(column.name)} REAL`
            );
            console.log(`Migrated ${column.name}; legacy data remains in ${legacyName}`);
        }

        if (viewsDropped) await restoreViews(affectedViews);
        viewsDropped = false;
    } catch (error) {
        const currentColumns = new Map((await readColumns()).map((column) => [column.name, column.type]));
        for (const renamed of renamedColumns) {
            if (!currentColumns.has(renamed.original) && currentColumns.has(renamed.legacy)) {
                await crateSql(
                    `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ` +
                    `RENAME COLUMN ${quoteIdentifier(renamed.legacy)} TO ${quoteIdentifier(renamed.original)}`
                );
            }
        }
        if (viewsDropped) await restoreViews(affectedViews);
        throw error;
    }

    const migratedColumns = await readColumns();
    const remainingMismatches = migratedColumns.filter(
        (column) => boundedMetricPattern.test(column.name) &&
            !column.name.endsWith(legacySuffix) && column.type !== 'real'
    );
    if (remainingMismatches.length) {
        throw new Error(`Validation found non-REAL bounded columns: ${remainingMismatches.map((c) => c.name).join(', ')}`);
    }
    console.log('Historical migration complete. Legacy OBJECT columns were retained and all affected views were rebuilt.');
}

main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
});
