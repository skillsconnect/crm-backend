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
 * only DB rows/metadata.
 *
 * Run with:   node database/legacy-migration/migrate-leads.js
 * Preview:    node database/legacy-migration/migrate-leads.js --dry-run
 *             (staff phase only: prints what would be created/linked, writes nothing)
 *
 * The staff phase creates CRM accounts for legacy staff that don't exist yet
 * and writes their one-time random passwords to a CSV OUTSIDE the repo
 * (os temp dir, or LEGACY_STAFF_CREDENTIALS_OUT). Distribute it securely,
 * then delete it — staff change the password from Profile after first login.
 *
 * Existing SkillsConnect operations accounts (user_type 3) of active legacy
 * staff are CONVERTED to CRM staff (user_type 23), which removes their
 * SkillsConnect operations access. Each conversion is recorded in a revert
 * CSV next to the credentials file (id, email, previous user_type).
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import mysql2 from 'mysql2/promise';
import db from '../../config/knex.js';
import { USER_TYPE } from '../../helpers/V1/crmAccess.js';

const DRY_RUN = process.argv.includes('--dry-run');
const MIGRATION_ACTOR_ID = 1; // ups_users.id recorded as created_by/updated_by
const RUN_STAMP = Date.now();
const CREDENTIALS_FILE = process.env.LEGACY_STAFF_CREDENTIALS_OUT
    || path.join(os.tmpdir(), `crm-legacy-staff-credentials-${RUN_STAMP}.csv`);
const CONVERSIONS_FILE = path.join(path.dirname(CREDENTIALS_FILE), `crm-legacy-staff-type-conversions-${RUN_STAMP}.csv`);

// Account types the staff phase will onboard: superadmin/admin keep their type,
// operations is converted to CRM staff, CRM staff is used as-is.
const ONBOARDABLE_TYPES = [USER_TYPE.SUPERADMIN, USER_TYPE.ADMIN, USER_TYPE.OPERATIONS, USER_TYPE.CRM_STAFF];

// Legacy tblstaff email -> the email of the SAME person's account in
// skillsconnect_saas, where the two differ. Keys/values are lowercase.
const LEGACY_EMAIL_ALIASES = new Map([
    ['vinayak.skillsconnect@gmail.com', 'vinayak.skillsconnect+1@gmail.com'],
]);

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

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

// 16 random bytes + one char of each class so it also satisfies the
// Profile page's password policy. Never logged — only written to the CSV.
const generatePassword = () => `${crypto.randomBytes(16).toString('base64url')}aA1!`;

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// When one email has several live ups_users rows, prefer an account the
// staff phase can onboard, then the oldest — deterministic across re-runs.
const pickAccount = (accounts) => [...accounts].sort((a, b) => {
    const aOk = ONBOARDABLE_TYPES.includes(Number(a.user_type)) ? 0 : 1;
    const bOk = ONBOARDABLE_TYPES.includes(Number(b.user_type)) ? 0 : 1;
    return aOk - bOk || a.id - b.id;
})[0];

const resolveEmail = (raw) => {
    const email = raw?.trim();
    if (!email) return null;
    return LEGACY_EMAIL_ALIASES.get(email.toLowerCase()) || email;
};

// Decides, per legacy tblstaff row, what the staff phase will do. Pure read —
// shared by --dry-run and the real run so the preview is exactly what applies.
//
//   no email                          -> unmapped (0)
//   no live ups_users account         -> create ups_admin_users + ups_users
//                                        (user_type 23) + crm_users
//   inactive in legacy, no crm_users  -> link leads only; account untouched
//   type 3 (operations)               -> convert to type 23 + crm_users
//   type 1/2 (superadmin/admin), 23   -> keep type; add crm_users if missing
//   any other type                    -> link leads, grant NO CRM access
async function planStaff(legacy) {
    const [staffRows] = await legacy.query(
        'SELECT staffid, email, firstname, lastname, phonenumber, admin, active FROM tblstaff ORDER BY staffid ASC'
    );

    const emails = [...new Set(staffRows.map((r) => resolveEmail(r.email)).filter(Boolean))];
    const accounts = emails.length
        ? await db('ups_users').whereIn('email', emails).where('is_deleted', 'No')
            .select('id', 'email', 'user_type', 'status')
        : [];
    const accountsByEmail = new Map();
    for (const a of accounts) {
        const key = a.email.toLowerCase();
        accountsByEmail.set(key, [...(accountsByEmail.get(key) || []), a]);
    }

    const userIds = accounts.map((a) => a.id);
    const crmRows = userIds.length
        ? await db('crm_users').whereIn('user_id', userIds).select('user_id', 'legacy_staff_id')
        : [];
    const crmByUserId = new Map(crmRows.map((r) => [r.user_id, r]));

    const plan = [];
    const plannedCreates = new Set(); // same email twice in tblstaff -> create once
    for (const row of staffRows) {
        const email = resolveEmail(row.email);
        const aliased = email && email.toLowerCase() !== row.email.trim().toLowerCase();
        const base = {
            staff: row, email, legacyEmail: aliased ? row.email.trim() : null,
            active: toBool(row.active), legacyAdmin: toBool(row.admin),
        };

        if (!email) { plan.push({ ...base, action: 'no_email' }); continue; }

        const candidates = accountsByEmail.get(email.toLowerCase());
        if (!candidates) {
            const key = email.toLowerCase();
            plan.push({ ...base, action: plannedCreates.has(key) ? 'link_created' : 'create' });
            plannedCreates.add(key);
            continue;
        }

        const account = pickAccount(candidates);
        const crmUser = crmByUserId.get(account.id) || null;
        const ctx = { ...base, account, crmUser, duplicates: candidates.length };
        const type = Number(account.user_type);
        if (!ONBOARDABLE_TYPES.includes(type)) {
            plan.push({ ...ctx, action: 'link_no_access_wrong_type' });
        } else if (!base.active && !crmUser) {
            // Left the legacy CRM: don't convert (that would strip their
            // SkillsConnect access) and don't grant CRM access.
            plan.push({ ...ctx, action: 'link_no_access_inactive' });
        } else if (type === USER_TYPE.OPERATIONS) {
            plan.push({ ...ctx, action: 'convert' });
        } else if (crmUser) {
            plan.push({ ...ctx, action: 'link_existing_crm' });
        } else {
            plan.push({ ...ctx, action: 'onboard' });
        }
    }
    return plan;
}

const ACTION_LABELS = {
    create: 'create new CRM account',
    convert: 'operations account → convert to CRM staff (type 23) + CRM access',
    onboard: 'existing account → grant CRM access (type unchanged)',
    link_existing_crm: 'already CRM user → link only',
    link_created: 'duplicate legacy email → link to account created above',
    link_no_access_inactive: 'inactive in legacy → link leads, no CRM access',
    link_no_access_wrong_type: 'non-CRM account type → link leads, no CRM access',
    no_email: 'no email → cannot map (0)',
};

function printStaffPlan(plan) {
    console.log('\n👥 Staff plan:');
    for (const p of plan) {
        const acct = p.account ? ` [ups_users#${p.account.id} type ${p.account.user_type}${p.account.user_type === USER_TYPE.SUPERADMIN ? ' superadmin → CRM admin' : ''}]` : '';
        const dup = p.duplicates > 1 ? ` (⚠ ${p.duplicates} live accounts share this email)` : '';
        const state = p.active ? '' : ' (inactive)';
        const alias = p.legacyEmail ? ` (legacy email ${p.legacyEmail})` : '';
        const willAccess = ['create', 'convert', 'onboard', 'link_existing_crm'].includes(p.action);
        const blocked = willAccess && p.account && p.account.status !== 'Active'
            ? ` (⚠ SkillsConnect status ${p.account.status} — cannot log in until activated)` : '';
        console.log(`   #${p.staff.staffid} ${p.email || '—'}${alias}${state}: ${ACTION_LABELS[p.action]}${acct}${dup}${blocked}`);
    }
    const counts = plan.reduce((acc, p) => ({ ...acc, [p.action]: (acc[p.action] || 0) + 1 }), {});
    console.log(`   Totals: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}\n`);
}

async function createStaffAccount(trx, p, password) {
    const firstName = p.staff.firstname?.trim() || p.email.split('@')[0];
    const lastName = p.staff.lastname?.trim() || '';
    const mobile = p.staff.phonenumber?.trim() || null;
    const audit = { created_by: MIGRATION_ACTOR_ID, updated_by: MIGRATION_ACTOR_ID };

    // Same shape as accounts created from the SkillsConnect admin panel:
    // ups_users.frecord_id points at the ups_admin_users profile row.
    const [profileId] = await trx('ups_admin_users').insert({
        first_name: firstName, last_name: lastName, email: p.email, mobile, whatsapp_number: mobile, ...audit,
    });
    const [userId] = await trx('ups_users').insert({
        frecord_id: profileId,
        user_type: USER_TYPE.CRM_STAFF,
        company_id: 0,
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`.trim(),
        email: p.email,
        password: md5(password),
        mobile,
        whatsapp_number: mobile,
        // Legacy-inactive staff still get an account so their leads keep a
        // real owner, but In-active blocks CRM login (crmAccess requires Active).
        status: p.active ? 'Active' : 'In-active',
        register_via: 'legacy-crm-migration',
        ...audit,
    });
    await trx('crm_users').insert({
        user_id: userId, legacy_staff_id: p.staff.staffid, is_admin: p.legacyAdmin, ...audit,
    });
    return userId;
}

// Returns the legacy tblstaff.staffid -> ups_users.id map every later phase
// uses. After this phase every legacy staff member with an email maps to a
// real account, so lead owners are correct on the first run.
async function migrateStaff(legacy) {
    const plan = await planStaff(legacy);
    printStaffPlan(plan);

    const map = new Map();
    const createdByEmail = new Map();
    const credentials = [];
    const conversions = [];

    for (const p of plan) {
        const sid = p.staff.staffid;
        switch (p.action) {
            case 'no_email':
                map.set(sid, 0);
                break;
            case 'create': {
                const password = generatePassword();
                const userId = await db.transaction((trx) => createStaffAccount(trx, p, password));
                createdByEmail.set(p.email.toLowerCase(), userId);
                map.set(sid, userId);
                // Inactive accounts can't log in, so there's nothing to hand out.
                if (p.active) credentials.push({ email: p.email, name: `${p.staff.firstname || ''} ${p.staff.lastname || ''}`.trim(), password });
                break;
            }
            case 'link_created':
                map.set(sid, createdByEmail.get(p.email.toLowerCase()) || 0);
                break;
            case 'convert':
                // Type change + CRM row in one transaction so a failure can't
                // leave an operations user stripped of access but not onboarded.
                await db.transaction(async (trx) => {
                    await trx('ups_users').where({ id: p.account.id, user_type: USER_TYPE.OPERATIONS })
                        .update({ user_type: USER_TYPE.CRM_STAFF, updated_by: MIGRATION_ACTOR_ID });
                    if (p.crmUser) {
                        if (!p.crmUser.legacy_staff_id) {
                            await trx('crm_users').where('user_id', p.account.id).update({ legacy_staff_id: sid });
                        }
                    } else {
                        await trx('crm_users').insert({
                            user_id: p.account.id,
                            legacy_staff_id: sid,
                            is_admin: p.legacyAdmin,
                            created_by: MIGRATION_ACTOR_ID,
                            updated_by: MIGRATION_ACTOR_ID,
                        });
                    }
                });
                conversions.push({ id: p.account.id, email: p.email, previous_user_type: p.account.user_type });
                map.set(sid, p.account.id);
                break;
            case 'onboard':
                await db('crm_users').insert({
                    user_id: p.account.id,
                    legacy_staff_id: sid,
                    is_admin: p.legacyAdmin, // superadmins are admins regardless — derived live from user_type
                    created_by: MIGRATION_ACTOR_ID,
                    updated_by: MIGRATION_ACTOR_ID,
                }).onConflict('user_id').ignore();
                map.set(sid, p.account.id);
                break;
            case 'link_existing_crm':
                // Never overwrite is_admin/role on an existing CRM user — it may
                // have been changed by hand since. Only fill in traceability.
                if (!p.crmUser.legacy_staff_id) {
                    await db('crm_users').where('user_id', p.account.id).update({ legacy_staff_id: sid });
                }
                map.set(sid, p.account.id);
                break;
            default: // link_no_access_inactive, link_no_access_wrong_type
                map.set(sid, p.account.id);
        }
    }

    if (credentials.length) {
        const csv = ['email,name,temporary_password', ...credentials.map((c) => [c.email, c.name, c.password].map(csvCell).join(','))].join('\n');
        fs.writeFileSync(CREDENTIALS_FILE, `${csv}\n`, { mode: 0o600 });
        console.log(`🔑 ${credentials.length} temporary passwords written to ${CREDENTIALS_FILE}`);
        console.log('   Share them securely, ask staff to change them after first login, then DELETE this file.');
    }

    if (conversions.length) {
        const csv = ['ups_user_id,email,previous_user_type', ...conversions.map((c) => [c.id, c.email, c.previous_user_type].map(csvCell).join(','))].join('\n');
        fs.writeFileSync(CONVERSIONS_FILE, `${csv}\n`);
        console.log(`🔁 ${conversions.length} operations accounts converted to CRM staff — revert list: ${CONVERSIONS_FILE}`);
    }

    const wrongType = plan.filter((p) => p.action === 'link_no_access_wrong_type');
    for (const p of wrongType) {
        console.warn(`⚠️  ${p.email} is a SkillsConnect user_type ${p.account.user_type} account — leads linked, but it cannot log into the CRM.`);
    }

    console.log(`ℹ️  Staff mapping: ${[...map.values()].filter((v) => v > 0).length}/${plan.length} legacy staff linked to ups_users accounts`);
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
        if (DRY_RUN) {
            console.log('🔍 Dry run — staff phase preview only, nothing will be written');
            printStaffPlan(await planStaff(legacy));
            return;
        }

        const staffMap = await migrateStaff(legacy);
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
