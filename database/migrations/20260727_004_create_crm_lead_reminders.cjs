/**
 * Mirrors legacy `tblreminders` rows where rel_type = 'lead'.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_lead_reminders', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();
    t.integer('lead_id').unsigned().notNullable();
    t.text('description').nullable();
    t.datetime('date').notNullable();
    t.boolean('isnotified').notNullable().defaultTo(false);
    t.boolean('notify_by_email').notNullable().defaultTo(true);
    t.integer('staff').unsigned().notNullable().defaultTo(0); // who gets reminded
    t.integer('creator').unsigned().notNullable().defaultTo(0);

    t.index('lead_id');
    t.index(['isnotified', 'date']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_lead_reminders');
};
