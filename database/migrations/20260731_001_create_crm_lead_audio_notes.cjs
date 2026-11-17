/**
 * Voice notes recorded in-browser against a lead (legacy CRM's "Audio Notes"
 * tab). Separate from crm_lead_attachments since the legacy UI treats them
 * as a distinct concept (dedicated record/play widget, not a file picker).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_lead_audio_notes', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('lead_id').unsigned().notNullable();
    t.string('file_name', 191).notNullable();
    t.string('file_path', 255).notNullable();
    t.string('mime_type', 100).nullable();
    t.integer('duration_seconds').unsigned().nullable();
    t.integer('staffid').unsigned().notNullable().defaultTo(0);
    t.datetime('dateadded').notNullable().defaultTo(knex.fn.now());

    t.index('lead_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_lead_audio_notes');
};
