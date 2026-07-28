/**
 * One-shot migration of the legacy PHP CRM's lead data (sk_crm, Perfex-based
 * schema at c:\xampp\htdocs\csdf623r632fs) into the new Node/knex CRM
 * (skillsconnect_saas, crm_* tables).
 *
 * Safe to re-run: each phase checks whether it has already migrated data
 * (via the `legacy_id` column) and skips if so, except the leads phase which
 * additionally guards row-by-row so it can pick up where it left off.
 *
 * Does NOT copy physical uploaded files (business cards, lead attachments) —
 * only DB rows/metadata. Run with: node database/legacy-migration/migrate-leads.js
 */
import 'dotenv/config';
import mysql2 from 'mysql2/promise';
import db from '../../config/knex.js';

const LEGACY_DB = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'sk_crm',
    port: 3306,
};

const CHUNK_SIZE = 1000;

const chunk = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

const toBool = (v) => Boolean(Number(v));

async function alreadyMigrated(table) {
    const row = await db(table).whereNotNull('legacy_id').first();
    return Boolean(row);
}

// Builds a COMPLETE legacy-id -> destination-id map by name match, rather
// than relying on the `legacy_id` column alone. That column is unique per
// destination row, so when several legacy rows share a name (case-insensitive
// duplicates, e.g. two "Siddharth Singh" sources) it can only remember the
// last one written — matching by name recovers every legacy id instead.
const mapLegacyByName = (legacyRows, destRows) => {
    const destByName = new Map(destRows.map((r) => [r.name.toLowerCase(), r.id]));
    const map = new Map();
    for (const row of legacyRows) {
        const destId = destByName.get(row.name.toLowerCase());
        if (destId) map.set(row.id, destId);
    }
    return map;
};

async function migrateStatuses(legacy) {
    const [legacyRows] = await legacy.query('SELECT id, name, statusorder, color, isdefault FROM tblleads_status ORDER BY statusorder ASC');

    if (await alreadyMigrated('crm_lead_status')) {
        console.log('⏭  crm_lead_status already migrated, skipping');
        const destRows = await db('crm_lead_status').select('id', 'name');
        return mapLegacyByName(legacyRows, destRows);
    }

    const existing = await db('crm_lead_status').select('id', 'name');
    const existingByName = new Map(existing.map((r) => [r.name.toLowerCase(), r.id]));

    for (const row of legacyRows) {
        const key = row.name.toLowerCase();
        if (existingByName.has(key)) {
            await db('crm_lead_status').where('id', existingByName.get(key)).update({
                legacy_id: row.id,
                isdefault: toBool(row.isdefault),
            });
        } else {
            const [insertedId] = await db('crm_lead_status').insert({
                legacy_id: row.id,
                name: row.name,
                color: row.color || '#6B7280',
                sequence: row.statusorder || 0,
                status: 'Active',
                isdefault: toBool(row.isdefault),
            });
            existingByName.set(key, insertedId);
        }
    }

    console.log(`✅ Migrated ${legacyRows.length} lead statuses`);
    const destRows = await db('crm_lead_status').select('id', 'name');
    return mapLegacyByName(legacyRows, destRows);
}

async function migrateSources(legacy) {
    const [legacyRows] = await legacy.query('SELECT id, name FROM tblleads_sources ORDER BY id ASC');

    if (await alreadyMigrated('crm_lead_source')) {
        console.log('⏭  crm_lead_source already migrated, skipping');
        const destRows = await db('crm_lead_source').select('id', 'name');
        return mapLegacyByName(legacyRows, destRows);
    }

    const existing = await db('crm_lead_source').select('id', 'name');
    const existingByName = new Map(existing.map((r) => [r.name.toLowerCase(), r.id]));

    let seq = (await db('crm_lead_source').max('sequence as m').first())?.m || 0;

    for (const row of legacyRows) {
        const key = row.name.toLowerCase();
        if (existingByName.has(key)) {
            await db('crm_lead_source').where('id', existingByName.get(key)).update({ legacy_id: row.id });
        } else {
            seq += 1;
            const [insertedId] = await db('crm_lead_source').insert({
                legacy_id: row.id,
                name: row.name,
                sequence: seq,
                status: 'Active',
            });
            existingByName.set(key, insertedId);
        }
    }

    console.log(`✅ Migrated ${legacyRows.length} lead sources`);
    const destRows = await db('crm_lead_source').select('id', 'name');
    return mapLegacyByName(legacyRows, destRows);
}

// Maps legacy tblstaff.staffid -> ups_users.id via matching email. Staff with
// no matching ups_users account (most of them, per earlier audit) fall back
// to 0, meaning "legacy owner, no linked account in this system".
async function loadStaffMap(legacy) {
    const [staffRows] = await legacy.query('SELECT staffid, email FROM tblstaff');
    const emails = staffRows.map((r) => r.email).filter(Boolean);
    const upsUsers = emails.length ? await db('ups_users').whereIn('email', emails).select('id', 'email') : [];
    const upsByEmail = new Map(upsUsers.map((u) => [u.email.toLowerCase(), u.id]));

    const map = new Map();
    for (const row of staffRows) {
        const upsId = row.email ? upsByEmail.get(row.email.toLowerCase()) : undefined;
        map.set(row.staffid, upsId || 0);
    }
    console.log(`ℹ️  Staff mapping: ${[...map.values()].filter((v) => v > 0).length}/${staffRows.length} legacy staff linked to ups_users accounts`);
    return map;
}

async function migrateLeads(legacy, statusMap, sourceMap, staffMap) {
    const [rows] = await legacy.query('SELECT * FROM tblleads ORDER BY id ASC');

    const existingLegacyIds = new Set(
        (await db('crm_leads').whereNotNull('legacy_id').select('legacy_id')).map((r) => r.legacy_id)
    );

    const toInsert = rows
        .filter((row) => !existingLegacyIds.has(row.id))
        .map((row) => ({
            legacy_id: row.id,
            hash: row.hash || null,
            name: row.name || '/',
            title: row.title || null,
            company: row.company || null,
            description: row.description || null,
            email: row.email || null,
            phonenumber: row.phonenumber || null,
            website: row.website || null,
            country: row.country || 0,
            zip: row.zip || null,
            city: row.city || null,
            state: row.state || null,
            address: row.address || null,
            assigned: staffMap.get(row.assigned) || 0,
            addedfrom: staffMap.get(row.addedfrom) || 0,
            status: statusMap.get(row.status) || 0,
            source: sourceMap.get(row.source) || 0,
            dateadded: row.dateadded,
            lastcontact: row.lastcontact || null,
            dateassigned: row.dateassigned || null,
            last_status_change: row.last_status_change || null,
            date_converted: row.date_converted || null,
            leadorder: row.leadorder || 1,
            lost: toBool(row.lost),
            junk: toBool(row.junk),
            last_lead_status: statusMap.get(row.last_lead_status) || 0,
            is_public: toBool(row.is_public),
            client_id: row.client_id || 0,
            lead_value: row.lead_value || null,
            send_introductry_mail: row.send_introductry_mail || null,
            contact_date_time: row.contact_date_time || null,
            event_name: row.event_name || null,
            uploaded_card_name: row.uploaded_card_name || null,
            created_by: staffMap.get(row.addedfrom) || 1,
            updated_by: staffMap.get(row.addedfrom) || 1,
        }));

    for (const batch of chunk(toInsert, CHUNK_SIZE)) {
        await db('crm_leads').insert(batch);
    }

    console.log(`✅ Migrated ${toInsert.length} leads (${rows.length - toInsert.length} already present, skipped)`);

    const leadIdRows = await db('crm_leads').whereNotNull('legacy_id').select('id', 'legacy_id');
    return new Map(leadIdRows.map((r) => [r.legacy_id, r.id]));
}

async function migrateActivity(legacy, leadIdMap, staffMap) {
    if (await alreadyMigrated('crm_lead_activity_log')) {
        console.log('⏭  crm_lead_activity_log already migrated, skipping');
        return;
    }

    const [rows] = await legacy.query('SELECT * FROM tbllead_activity_log ORDER BY id ASC');
    const toInsert = [];
    for (const row of rows) {
        const leadId = leadIdMap.get(row.leadid);
        if (!leadId) continue;
        toInsert.push({
            legacy_id: row.id,
            lead_id: leadId,
            description: row.description,
            additional_data: row.additional_data || null,
            date: row.date,
            staffid: staffMap.get(row.staffid) || 0,
            full_name: row.full_name || null,
            custom_activity: toBool(row.custom_activity),
        });
    }

    for (const batch of chunk(toInsert, CHUNK_SIZE)) {
        await db('crm_lead_activity_log').insert(batch);
    }
    console.log(`✅ Migrated ${toInsert.length}/${rows.length} activity log entries (${rows.length - toInsert.length} orphaned, skipped)`);
}

async function migrateNotes(legacy, leadIdMap, staffMap) {
    if (await alreadyMigrated('crm_lead_notes')) {
        console.log('⏭  crm_lead_notes already migrated, skipping');
        return;
    }

    const [rows] = await legacy.query("SELECT * FROM tblnotes WHERE rel_type = 'lead' ORDER BY id ASC");
    const toInsert = [];
    for (const row of rows) {
        const leadId = leadIdMap.get(row.rel_id);
        if (!leadId) continue;
        toInsert.push({
            legacy_id: row.id,
            lead_id: leadId,
            description: row.description || null,
            date_contacted: row.date_contacted || null,
            addedfrom: staffMap.get(row.addedfrom) || 0,
            dateadded: row.dateadded,
        });
    }

    for (const batch of chunk(toInsert, CHUNK_SIZE)) {
        await db('crm_lead_notes').insert(batch);
    }
    console.log(`✅ Migrated ${toInsert.length}/${rows.length} lead notes`);
}

async function migrateReminders(legacy, leadIdMap, staffMap) {
    if (await alreadyMigrated('crm_lead_reminders')) {
        console.log('⏭  crm_lead_reminders already migrated, skipping');
        return;
    }

    const [rows] = await legacy.query("SELECT * FROM tblreminders WHERE rel_type = 'lead' ORDER BY id ASC");
    const toInsert = [];
    for (const row of rows) {
        const leadId = leadIdMap.get(row.rel_id);
        if (!leadId) continue;
        toInsert.push({
            legacy_id: row.id,
            lead_id: leadId,
            description: row.description || null,
            date: row.date,
            isnotified: toBool(row.isnotified),
            notify_by_email: toBool(row.notify_by_email),
            staff: staffMap.get(row.staff) || 0,
            creator: staffMap.get(row.creator) || 0,
        });
    }

    for (const batch of chunk(toInsert, CHUNK_SIZE)) {
        await db('crm_lead_reminders').insert(batch);
    }
    console.log(`✅ Migrated ${toInsert.length}/${rows.length} lead reminders`);
}

async function migrateAttachments(legacy, leadIdMap, staffMap) {
    if (await alreadyMigrated('crm_lead_attachments')) {
        console.log('⏭  crm_lead_attachments already migrated, skipping');
        return;
    }

    const [rows] = await legacy.query("SELECT * FROM tblfiles WHERE rel_type = 'lead' ORDER BY id ASC");
    const toInsert = [];
    for (const row of rows) {
        const leadId = leadIdMap.get(row.rel_id);
        if (!leadId) continue;
        toInsert.push({
            legacy_id: row.id,
            lead_id: leadId,
            file_name: row.file_name,
            filetype: row.filetype || null,
            file_path: null, // physical file was not copied — see migration notes
            external: row.external || null,
            external_link: row.external_link || null,
            staffid: staffMap.get(row.staffid) || 0,
            dateadded: row.dateadded,
        });
    }

    for (const batch of chunk(toInsert, CHUNK_SIZE)) {
        await db('crm_lead_attachments').insert(batch);
    }
    console.log(`✅ Migrated ${toInsert.length}/${rows.length} lead attachments (metadata only, files not copied)`);
}

async function migrateTags(legacy, leadIdMap) {
    if (await alreadyMigrated('crm_tags')) {
        console.log('⏭  crm_tags already migrated, skipping');
        return;
    }

    const [tagRows] = await legacy.query('SELECT id, name FROM tbltags ORDER BY id ASC');
    const tagNameById = new Map(tagRows.map((r) => [r.id, r.name]));

    const existing = await db('crm_tags').select('id', 'name');
    const existingByName = new Map(existing.map((r) => [r.name.toLowerCase(), r.id]));

    for (const row of tagRows) {
        const key = row.name.toLowerCase();
        if (existingByName.has(key)) {
            await db('crm_tags').where('id', existingByName.get(key)).update({ legacy_id: row.id });
        } else {
            const [insertedId] = await db('crm_tags').insert({ legacy_id: row.id, name: row.name });
            existingByName.set(key, insertedId);
        }
    }
    console.log(`✅ Migrated ${tagRows.length} tag master rows`);

    const [taggables] = await legacy.query("SELECT rel_id, tag_id FROM tbltaggables WHERE rel_type = 'lead'");
    const tagsByLead = new Map();
    for (const row of taggables) {
        const tagName = tagNameById.get(row.tag_id);
        if (!tagName) continue;
        if (!tagsByLead.has(row.rel_id)) tagsByLead.set(row.rel_id, []);
        tagsByLead.get(row.rel_id).push(tagName);
    }

    let updated = 0;
    for (const [legacyLeadId, tagNames] of tagsByLead.entries()) {
        const leadId = leadIdMap.get(legacyLeadId);
        if (!leadId) continue;
        await db('crm_leads').where('id', leadId).update({ tags: tagNames.join(', ') });
        updated += 1;
    }
    console.log(`✅ Applied tags to ${updated}/${tagsByLead.size} leads`);
}

async function main() {
    console.log('🚀 Starting legacy lead data migration (sk_crm → skillsconnect_saas)');
    const legacy = await mysql2.createConnection(LEGACY_DB);

    try {
        const staffMap = await loadStaffMap(legacy);
        const statusMap = await migrateStatuses(legacy);
        const sourceMap = await migrateSources(legacy);
        const leadIdMap = await migrateLeads(legacy, statusMap, sourceMap, staffMap);
        await migrateActivity(legacy, leadIdMap, staffMap);
        await migrateNotes(legacy, leadIdMap, staffMap);
        await migrateReminders(legacy, leadIdMap, staffMap);
        await migrateAttachments(legacy, leadIdMap, staffMap);
        await migrateTags(legacy, leadIdMap);

        console.log('🎉 Legacy lead migration completed');
    } finally {
        await legacy.end();
        await db.destroy();
    }
}

main().catch((err) => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
