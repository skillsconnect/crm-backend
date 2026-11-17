/**
 * Mirrors legacy `tblnotes` rows where rel_type = 'lead'.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_lead_notes', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();
    t.integer('lead_id').unsigned().notNullable();
    t.text('description').nullable();
    t.datetime('date_contacted').nullable();
    t.integer('addedfrom').unsigned().notNullable().defaultTo(0);
    t.datetime('dateadded').notNullable().defaultTo(knex.fn.now());

    t.index('lead_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_lead_notes');
};
