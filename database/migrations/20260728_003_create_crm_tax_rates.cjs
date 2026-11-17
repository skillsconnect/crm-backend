/**
 * Tax rate master (mirrors legacy `tbltaxes`) — applied per line item on
 * proposals/invoices.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_tax_rates', (t) => {
    t.increments('id').unsigned().primary();
    t.string('name', 100).notNullable();
    t.decimal('rate', 6, 2).notNullable();
    t.enu('status', ['Active', 'In-active']).notNullable().defaultTo('Active');
    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('crm_payment_modes', (t) => {
    t.increments('id').unsigned().primary();
    t.string('name', 100).notNullable().unique();
    t.enu('status', ['Active', 'In-active']).notNullable().defaultTo('Active');
    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
  });

  // Seed the common defaults so proposal/invoice line items have something
  // to select immediately.
  await knex('crm_tax_rates').insert([
    { name: 'GST 18%', rate: 18.0 },
    { name: 'No Tax', rate: 0.0 },
  ]);
  await knex('crm_payment_modes').insert([
    { name: 'Bank Transfer' },
    { name: 'Cash' },
    { name: 'UPI' },
    { name: 'Cheque' },
  ]);
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_payment_modes');
  await knex.schema.dropTableIfExists('crm_tax_rates');
};
