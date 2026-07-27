/**
 * Mirrors legacy `tblfiles` rows where rel_type = 'lead'. Migrated rows keep
 * pointing at the legacy uploads path via external_link when the physical file
 * was not copied over.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_lead_attachments', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();
    t.integer('lead_id').unsigned().notNullable();
    t.string('file_name', 191).notNullable();
    t.string('filetype', 60).nullable();
    t.string('file_path', 255).nullable(); // path under this app's uploads dir
    t.string('external', 40).nullable();
    t.text('external_link').nullable();
    t.integer('staffid').unsigned().notNullable().defaultTo(0);
    t.datetime('dateadded').notNullable().defaultTo(knex.fn.now());

    t.index('lead_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_lead_attachments');
};
