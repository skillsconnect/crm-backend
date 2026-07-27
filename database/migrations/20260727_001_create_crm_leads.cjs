/**
 * crm_leads mirrors the legacy Perfex `tblleads` structure (column names kept
 * identical where the data migrates 1:1) plus the extra fields the new lead
 * form captures (sector, employee count, outreach content, etc.).
 * `legacy_id` holds the original tblleads.id so the data migration is
 * idempotent and old references stay traceable.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_leads', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();
    t.string('hash', 65).nullable();

    t.string('name', 191).notNullable();
    t.string('title', 191).nullable(); // position / designation
    t.string('company', 191).nullable();
    t.text('description').nullable();

    t.string('email', 150).nullable();
    t.string('phonenumber', 50).nullable();
    t.string('website', 150).nullable();

    t.integer('country').notNullable().defaultTo(0); // legacy country id (101 = India)
    t.string('zip', 15).nullable();
    t.string('city', 100).nullable();
    t.string('state', 100).nullable();
    t.string('address', 191).nullable();

    t.integer('assigned').unsigned().notNullable().defaultTo(0); // ups_users.id
    t.integer('addedfrom').unsigned().notNullable().defaultTo(0); // ups_users.id
    t.integer('status').unsigned().notNullable().defaultTo(0); // crm_lead_status.id
    t.integer('source').unsigned().notNullable().defaultTo(0); // crm_lead_source.id

    t.datetime('dateadded').notNullable().defaultTo(knex.fn.now());
    t.datetime('lastcontact').nullable();
    t.date('dateassigned').nullable();
    t.datetime('last_status_change').nullable();
    t.datetime('date_converted').nullable();

    t.integer('leadorder').notNullable().defaultTo(1);
    t.boolean('lost').notNullable().defaultTo(false);
    t.boolean('junk').notNullable().defaultTo(false);
    t.integer('last_lead_status').unsigned().notNullable().defaultTo(0);
    t.boolean('is_public').notNullable().defaultTo(false);
    t.integer('client_id').unsigned().notNullable().defaultTo(0);
    t.decimal('lead_value', 15, 2).nullable();

    // legacy custom columns (values like 'on'/'Yes'/'No' and free-text
    // datetimes such as '26-08-2024 5:55 PM' — kept as-is for migration fidelity)
    t.string('send_introductry_mail', 255).nullable();
    t.string('contact_date_time', 255).nullable();
    t.string('event_name', 255).nullable();
    t.string('uploaded_card_name', 255).nullable();

    // new-system extras captured by the lead form
    t.text('tags').nullable(); // comma separated tag names
    t.string('employee_count', 50).nullable();
    t.string('sector', 191).nullable();
    t.string('alternative_email', 255).nullable();
    t.boolean('public_contacted_today').notNullable().defaultTo(false);
    t.boolean('persist_mail_24h').notNullable().defaultTo(false);
    t.string('email_subject', 500).nullable();
    t.text('email_content').nullable();
    t.text('whatsapp_content').nullable();

    t.boolean('is_deleted').notNullable().defaultTo(false);

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);

    t.index('name');
    t.index('company');
    t.index('email');
    t.index('assigned');
    t.index('status');
    t.index('source');
    t.index('lastcontact');
    t.index('dateadded');
    t.index('leadorder');
    t.index(['lost', 'junk', 'is_deleted']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_leads');
};
