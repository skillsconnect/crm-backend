/**
 * Clients — mirrors legacy `tblclients` (company-level record). A client can
 * originate from a converted lead (lead_id), matching the legacy
 * lead-to-client conversion flow.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_clients', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();
    t.integer('lead_id').unsigned().nullable();

    t.string('company', 191).notNullable();
    t.string('vat', 50).nullable();
    t.string('phone', 30).nullable();
    t.string('email', 150).nullable();
    t.string('website', 150).nullable();

    t.string('address', 191).nullable();
    t.string('city', 100).nullable();
    t.string('state', 100).nullable();
    t.string('zip', 15).nullable();
    t.integer('country').unsigned().notNullable().defaultTo(0);

    t.text('notes').nullable();
    t.enu('status', ['Active', 'In-active']).notNullable().defaultTo('Active');

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);

    t.index('company');
    t.index('lead_id');
    t.index('status');
  });

  await knex.schema.createTable('crm_client_contacts', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('client_id').unsigned().notNullable();
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).nullable();
    t.string('email', 150).nullable();
    t.string('phone', 50).nullable();
    t.string('title', 100).nullable();
    t.boolean('is_primary').notNullable().defaultTo(false);

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());

    t.index('client_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_client_contacts');
  await knex.schema.dropTableIfExists('crm_clients');
};
