/**
 * Credit notes — a client-side credit balance, optionally raised against a
 * specific invoice, that can be applied (partially or across multiple
 * invoices over time) to reduce what's owed. Applying one is recorded both
 * here (crm_credit_note_applications, the credit-note-side ledger) and as a
 * normal crm_invoice_payments row with payment_mode='Credit Note' on the
 * invoice side — so invoice balance/status derivation needs no special case.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_credit_notes', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();

    t.string('credit_note_number', 40).notNullable().unique();
    t.integer('client_id').unsigned().nullable();
    t.integer('lead_id').unsigned().nullable();
    t.integer('invoice_id').unsigned().nullable(); // the invoice this credit was raised against, if any

    t.string('currency', 10).notNullable().defaultTo('INR');
    t.decimal('subtotal', 15, 2).notNullable().defaultTo(0);
    t.enu('discount_type', ['percent', 'fixed']).nullable();
    t.decimal('discount_percent', 15, 2).notNullable().defaultTo(0);
    t.decimal('discount_total', 15, 2).notNullable().defaultTo(0);
    t.decimal('total_tax', 15, 2).notNullable().defaultTo(0);
    t.decimal('adjustment', 15, 2).notNullable().defaultTo(0);
    t.decimal('total', 15, 2).notNullable().defaultTo(0);
    t.decimal('amount_used', 15, 2).notNullable().defaultTo(0);

    t.date('date').notNullable();
    t.enu('status', ['Draft', 'Open', 'Applied', 'Void']).notNullable().defaultTo('Draft');
    t.integer('assigned').unsigned().notNullable().defaultTo(0);
    t.text('notes').nullable();

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);

    t.index('client_id');
    t.index('lead_id');
    t.index('invoice_id');
    t.index('status');
  });

  await knex.schema.createTable('crm_credit_note_items', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('credit_note_id').unsigned().notNullable();
    t.text('description').notNullable();
    t.text('long_description').nullable();
    t.decimal('qty', 15, 2).notNullable().defaultTo(1);
    t.decimal('rate', 15, 2).notNullable().defaultTo(0);
    t.string('unit', 40).nullable();
    t.integer('tax_rate_id').unsigned().nullable();
    t.integer('item_order').unsigned().notNullable().defaultTo(0);

    t.index('credit_note_id');
  });

  await knex.schema.createTable('crm_credit_note_applications', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('credit_note_id').unsigned().notNullable();
    t.integer('invoice_id').unsigned().notNullable();
    t.integer('invoice_payment_id').unsigned().nullable(); // the crm_invoice_payments row this created
    t.decimal('amount', 15, 2).notNullable();
    t.date('applied_date').notNullable();
    t.integer('applied_by').unsigned().notNullable().defaultTo(1);
    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());

    t.index('credit_note_id');
    t.index('invoice_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_credit_note_applications');
  await knex.schema.dropTableIfExists('crm_credit_note_items');
  await knex.schema.dropTableIfExists('crm_credit_notes');
};
