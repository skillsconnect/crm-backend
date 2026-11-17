/**
 * Empties the CRM's data tables so the legacy migration (migrate-leads.js)
 * can be re-run from a clean slate — e.g. on staging after a trial migration.
 *
 * Deletes: every crm_* table EXCEPT the ones in KEEP_TABLES below. The list
 * of tables is read from the database at run time, so a crm_* table added
 * later is emptied too unless you add it to KEEP_TABLES.
 *
 * Keeps:   CRM users and everything that makes them work (roles, permissions,
 *          connected Gmail/Calendar accounts), migration-seeded defaults, and
 *          the knex migration bookkeeping. ups_* tables (including accounts
 *          created or converted by the staff migration) are never touched.
 *
 * Does NOT delete uploaded files (attachments, audio notes) from disk/blob.
 *
 * Which database is hit is decided by ENVIRONMENT in .env (see config/knex.js).
 *
 * Preview:  node database/legacy-migration/reset-crm-data.js --dry-run
 * Run:      node database/legacy-migration/reset-crm-data.js
 *           (asks you to type "delete"; refuses PRODUCTION unless
 *            --allow-production is also passed)
 */
import 'dotenv/config';
import readline from 'readline/promises';
import db from '../../config/knex.js';

const KEEP_TABLES = new Set([
    // CRM users and their access
    'crm_users',
    'crm_roles',             // also seeded by a migration
    'crm_role_permissions',
    'crm_staff_permissions',
    'crm_permissions',
    // Per-user connected accounts (OAuth tokens) — reconnecting is a chore
    'crm_sender_emails',
    'crm_staff_google_calendar',
    // Defaults inserted by migrations — would never come back if emptied
    'crm_payment_modes',
    'crm_tax_rates',
    // knex migration bookkeeping — emptying this would re-run/break migrations
    'crm_knex_migrations',
    'crm_knex_migrations_lock',
]);

const DRY_RUN = process.argv.includes('--dry-run');
const ALLOW_PRODUCTION = process.argv.includes('--allow-production');

async function loadTables() {
    const [rows] = await db.raw(
        "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE 'crm\\_%' ORDER BY TABLE_NAME"
    );
    const tables = [];
    for (const { name } of rows) {
        const [[{ total }]] = await db.raw('SELECT COUNT(*) AS total FROM ??', [name]);
        tables.push({ name, total: Number(total), keep: KEEP_TABLES.has(name) });
    }
    return tables;
}

async function confirm(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await rl.question(question)).trim();
    } finally {
        rl.close();
    }
}

async function main() {
    const env = process.env.ENVIRONMENT || '(unset)';
    const [[target]] = await db.raw('SELECT DATABASE() AS name, @@hostname AS host');

    console.log(`\n🎯 Target: database "${target.name}" on ${target.host} (ENVIRONMENT=${env})\n`);

    if (env === 'PRODUCTION' && !ALLOW_PRODUCTION) {
        console.error('⛔ ENVIRONMENT is PRODUCTION. Refusing to run without --allow-production.');
        process.exitCode = 1;
        return;
    }

    const tables = await loadTables();
    const toEmpty = tables.filter((t) => !t.keep);
    const toKeep = tables.filter((t) => t.keep);

    console.log('🗑  Will be EMPTIED:');
    for (const t of toEmpty) console.log(`   ${t.name.padEnd(36)} ${t.total} rows`);
    console.log('\n🔒 Will be KEPT:');
    for (const t of toKeep) console.log(`   ${t.name.padEnd(36)} ${t.total} rows`);

    const missingKeeps = [...KEEP_TABLES].filter((name) => !tables.some((t) => t.name === name));
    if (missingKeeps.length) console.log(`\n   (not present in this DB: ${missingKeeps.join(', ')})`);

    const totalRows = toEmpty.reduce((sum, t) => sum + t.total, 0);
    console.log(`\n   ${toEmpty.length} tables, ${totalRows} rows to delete.`);

    if (DRY_RUN) {
        console.log('\n🔍 Dry run — nothing was deleted.');
        return;
    }
    if (!toEmpty.length) {
        console.log('\nNothing to delete.');
        return;
    }

    const answer = await confirm(`\n⚠️  This permanently deletes the data above from "${target.name}". Type "delete" to continue: `);
    if (answer !== 'delete') {
        console.log('Aborted — nothing was deleted.');
        return;
    }

    // One pinned connection so FOREIGN_KEY_CHECKS applies to every TRUNCATE.
    // TRUNCATE (not DELETE) also resets AUTO_INCREMENT, so a re-migration
    // starts from id 1. Note: TRUNCATE auto-commits per table in MySQL — if
    // this stops halfway, re-run it; already-emptied tables are just no-ops.
    await db.transaction(async (trx) => {
        await trx.raw('SET FOREIGN_KEY_CHECKS = 0');
        try {
            for (const t of toEmpty) {
                await trx.raw('TRUNCATE TABLE ??', [t.name]);
                console.log(`   ✔ emptied ${t.name}`);
            }
        } finally {
            await trx.raw('SET FOREIGN_KEY_CHECKS = 1');
        }
    });

    console.log(`\n✅ Emptied ${toEmpty.length} tables. Kept ${toKeep.length}. You can now re-run migrate-leads.js.`);
}

main()
    .catch((err) => {
        console.error('❌ Reset failed:', err);
        process.exitCode = 1;
    })
    .finally(() => db.destroy());
