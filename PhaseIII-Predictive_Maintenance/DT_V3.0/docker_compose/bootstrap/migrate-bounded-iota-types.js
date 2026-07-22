/* global db, print, quit */

'use strict';

const applyMigration = String(process.env.MIGRATION_APPLY || 'false').toLowerCase() === 'true';
const databaseName = process.env.IOTA_MONGO_DB || 'iotagentjson';
const backupCollectionName = process.env.IOTA_BACKUP_COLLECTION || 'devices_backup_bounded_number_v1';
const boundedMetricPattern = /(_since_last_pm|_since_last_air_filter_pm|_since_replacement)$/;

if (!/^[A-Za-z0-9_]+$/.test(backupCollectionName)) {
    print(`ERROR: unsafe backup collection name: ${backupCollectionName}`);
    quit(2);
}

const registry = db.getSiblingDB(databaseName);
const devices = registry.getCollection('devices');
const backup = registry.getCollection(backupCollectionName);
const documents = devices.find({}).toArray();

function isBoundedAttribute(attribute) {
    if (!attribute || typeof attribute !== 'object') return false;
    return boundedMetricPattern.test(String(attribute.name || attribute.object_id || ''));
}

function migratePortalMetadata(value) {
    const prefix = 'b64url:';
    if (typeof value !== 'string' || !value.startsWith(prefix)) {
        return { value, changed: 0 };
    }

    try {
        const attributes = JSON.parse(Buffer.from(value.slice(prefix.length), 'base64url').toString('utf8'));
        if (!Array.isArray(attributes)) return { value, changed: 0 };

        let changed = 0;
        const migrated = attributes.map((attribute) => {
            if (!isBoundedAttribute(attribute) || attribute.type === 'Number') return attribute;
            changed += 1;
            return { ...attribute, type: 'Number' };
        });
        if (!changed) return { value, changed: 0 };

        return {
            value: `${prefix}${Buffer.from(JSON.stringify(migrated), 'utf8').toString('base64url')}`,
            changed
        };
    } catch (error) {
        throw new Error(`invalid portalTelemetryAttributes value: ${error.message}`);
    }
}

let changedDevices = 0;
let changedActiveAttributes = 0;
let changedMetadataAttributes = 0;

for (const original of documents) {
    const migrated = { ...original };
    let activeChanges = 0;
    migrated.active = Array.isArray(original.active)
        ? original.active.map((attribute) => {
            if (!isBoundedAttribute(attribute) || attribute.type === 'Number') return attribute;
            activeChanges += 1;
            return { ...attribute, type: 'Number' };
        })
        : original.active;

    let metadataChanges = 0;
    migrated.staticAttributes = Array.isArray(original.staticAttributes)
        ? original.staticAttributes.map((attribute) => {
            if (attribute?.name !== 'portalTelemetryAttributes') return attribute;
            const result = migratePortalMetadata(attribute.value);
            metadataChanges += result.changed;
            return result.changed ? { ...attribute, value: result.value } : attribute;
        })
        : original.staticAttributes;

    if (!activeChanges && !metadataChanges) continue;

    changedDevices += 1;
    changedActiveAttributes += activeChanges;
    changedMetadataAttributes += metadataChanges;
    print(
        `${applyMigration ? 'MIGRATE' : 'WOULD MIGRATE'} device=${original.id || original._id} ` +
        `active=${activeChanges} metadata=${metadataChanges}`
    );

    if (applyMigration) {
        if (!backup.findOne({ _id: original._id })) backup.insertOne(original);
        devices.replaceOne({ _id: original._id }, migrated);
    }
}

print(
    `${applyMigration ? 'Migration complete' : 'Dry run complete'}: devices=${changedDevices}, ` +
    `activeAttributes=${changedActiveAttributes}, metadataAttributes=${changedMetadataAttributes}`
);
if (!applyMigration && changedDevices) {
    print('Set MIGRATION_APPLY=true to apply. The original documents will be copied once to ' + backupCollectionName + '.');
}
