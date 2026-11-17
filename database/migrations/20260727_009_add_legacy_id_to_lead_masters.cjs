/**
 * legacy_id on lead status/source masters so the legacy data migration can map
 * tblleads.status/source ids without clobbering rows already created here.
 * Also adds the legacy `isdefault` flag on statuses (used for form defaults).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('crm_lead_status', (t) => {
    t.integer('legacy_id').unsigned().nullable().unique();
    t.boolean('isdefault').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('crm_lead_source', (t) => {
    t.integer('legacy_id').unsigned().nullable().unique();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('crm_lead_status', (t) => {
    t.dropColumn('legacy_id');
    t.dropColumn('isdefault');
  });
  await knex.schema.alterTable('crm_lead_source', (t) => {
    t.dropColumn('legacy_id');
  });
};
