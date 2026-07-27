/**
 * crm_mailing_list — named recipient lists targeted by campaigns.
 *
 * Replaces legacy Perfex `tblmailing_list`.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_mailing_list', (t) => {
    t.increments('id').unsigned().primary();

    t.string('name', 255).notNullable();
    t.enu('status', ['Active', 'Inactive']).notNullable().defaultTo('Active');

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(0);
    t.integer('updated_by').unsigned().notNullable().defaultTo(0);

    t.unique('name');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_mailing_list');
};
