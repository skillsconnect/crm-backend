/**
 * Invoices — mirrors legacy `tblinvoices`/`tblinvoiceitems`/
 * `tblinvoicepaymentrecords`. Recurring-invoice columns are included so that
 * feature can be turned on later without another schema change, but the
 * automation itself (cron generating the next cycle's invoice) is not wired
 * up yet.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_invoices', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();

    t.string('invoice_number', 50).notNullable().unique();
    t.integer('client_id').unsigned().nullable();
    t.integer('lead_id').unsigned().nullable();
    t.integer('proposal_id').unsigned().nullable();

    t.string('currency', 10).notNullable().defaultTo('INR');
    t.date('date').notNullable();
    t.date('due_date').nullable();

    t.decimal('subtotal', 15, 2).notNullable().defaultTo(0);
    t.enu('discount_type', ['percent', 'fixed']).nullable();
    t.decimal('discount_percent', 15, 2).notNullable().defaultTo(0);
    t.decimal('discount_total', 15, 2).notNullable().defaultTo(0);
    t.decimal('total_tax', 15, 2).notNullable().defaultTo(0);
    t.decimal('adjustment', 15, 2).notNullable().defaultTo(0);
    t.decimal('total', 15, 2).notNullable().defaultTo(0);
    t.decimal('amount_paid', 15, 2).notNullable().defaultTo(0);

    t.enu('status', ['Draft', 'Unpaid', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled']).notNullable().defaultTo('Draft');
    t.text('terms').nullable();
    t.text('client_note').nullable();
    t.text('admin_note').nullable();
    t.integer('assigned').unsigned().notNullable().defaultTo(0);

    // Recurring — reserved for a later automation pass, not active yet.
    t.boolean('is_recurring').notNullable().defaultTo(false);
    t.enu('recurring_cycle', ['weekly', 'monthly', 'quarterly', 'yearly']).nullable();
    t.integer('recurring_cycles_total').unsigned().nullable();
    t.integer('recurring_cycles_done').unsigned().notNullable().defaultTo(0);
    t.integer('recurring_source_invoice_id').unsigned().nullable();

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);

    t.index('client_id');
    t.index('lead_id');
    t.index('status');
    t.index('due_date');
  });

  await knex.schema.createTable('crm_invoice_items', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('invoice_id').unsigned().notNullable();
    t.text('description').notNullable();
    t.text('long_description').nullable();
    t.decimal('qty', 15, 2).notNullable().defaultTo(1);
    t.decimal('rate', 15, 2).notNullable().defaultTo(0);
    t.string('unit', 40).nullable();
    t.integer('tax_rate_id').unsigned().nullable();
    t.integer('item_order').unsigned().notNullable().defaultTo(0);

    t.index('invoice_id');
  });

  await knex.schema.createTable('crm_invoice_payments', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('invoice_id').unsigned().notNullable();
    t.decimal('amount', 15, 2).notNullable();
    t.string('payment_mode', 100).nullable();
    t.date('payment_date').notNullable();
    t.string('transaction_id', 191).nullable();
    t.text('note').nullable();
    t.integer('recorded_by').unsigned().notNullable().defaultTo(1);
    t.timestamp('recorded_on').notNullable().defaultTo(knex.fn.now());

    t.index('invoice_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_invoice_payments');
  await knex.schema.dropTableIfExists('crm_invoice_items');
  await knex.schema.dropTableIfExists('crm_invoices');
};
