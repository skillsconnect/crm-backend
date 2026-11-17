/**
 * Mirrors legacy `tbllead_activity_log`. `full_name` stays denormalized just
 * like the legacy table so history survives staff-account changes.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_lead_activity_log', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();
    t.integer('lead_id').unsigned().notNullable();
    t.text('description', 'mediumtext').notNullable();
    t.text('additional_data').nullable();
    t.datetime('date').notNullable().defaultTo(knex.fn.now());
    t.integer('staffid').unsigned().notNullable().defaultTo(0);
    t.string('full_name', 100).nullable();
    t.boolean('custom_activity').notNullable().defaultTo(false);

    t.index('lead_id');
    t.index('date');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_lead_activity_log');
};
