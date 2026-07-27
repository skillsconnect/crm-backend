/**
 * Tag master (legacy `tbltags`). Lead-tag assignment is flattened into the
 * comma separated crm_leads.tags column (legacy tbltaggables is collapsed
 * during the data migration), matching what the new UI reads/writes.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_tags', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();
    t.string('name', 100).notNullable().unique();
    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_tags');
};
