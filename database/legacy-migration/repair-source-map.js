/**
 * One-off repair: a handful of legacy lead sources shared the same name
 * (case-insensitive), which meant only the last one's id got recorded in
 * crm_lead_source.legacy_id — leads referencing the other now-orphaned
 * legacy source ids were migrated with source=0. This recomputes the full
 * legacy-id -> destination-id map by name and fixes those leads.
 * Safe to re-run.
 */
import 'dotenv/config';
import mysql2 from 'mysql2/promise';
import db from '../../config/knex.js';

const LEGACY_DB = { host: 'localhost', user: 'root', password: '', database: 'sk_crm', port: 3306 };

async function main() {
    const legacy = await mysql2.createConnection(LEGACY_DB);
    try {
        const [legacySources] = await legacy.query('SELECT id, name FROM tblleads_sources');
        const destSources = await db('crm_lead_source').select('id', 'name');
        const destByName = new Map(destSources.map((r) => [r.name.toLowerCase(), r.id]));
        const sourceMap = new Map();
        for (const row of legacySources) {
            const destId = destByName.get(row.name.toLowerCase());
            if (destId) sourceMap.set(row.id, destId);
        }

        const unmapped = await db('crm_leads').where('source', 0).whereNotNull('legacy_id').select('id', 'legacy_id');
        if (!unmapped.length) {
            console.log('Nothing to repair — no leads with source=0');
            return;
        }

        const legacyIds = unmapped.map((r) => r.legacy_id);
        const [legacyLeads] = await legacy.query(
            `SELECT id, source FROM tblleads WHERE id IN (${legacyIds.map(() => '?').join(',')})`,
            legacyIds
        );
        const legacySourceByLeadId = new Map(legacyLeads.map((r) => [r.id, r.source]));

        let fixed = 0;
        for (const row of unmapped) {
            const legacySourceId = legacySourceByLeadId.get(row.legacy_id);
            const newSourceId = sourceMap.get(legacySourceId);
            if (newSourceId) {
                await db('crm_leads').where('id', row.id).update({ source: newSourceId });
                fixed += 1;
            }
        }
        console.log(`✅ Repaired source mapping on ${fixed}/${unmapped.length} leads`);
    } finally {
        await legacy.end();
        await db.destroy();
    }
}

main().catch((err) => {
    console.error('❌ Repair failed:', err);
    process.exit(1);
});
