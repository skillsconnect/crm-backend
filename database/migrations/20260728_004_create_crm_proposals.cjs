/**
 * Proposals — can be sent against a lead OR a converted client (client_id/
 * lead_id are both nullable; exactly one is normally set), mirroring legacy
 * `tblproposals`' rel_id/rel_type pattern. Line items live in
 * crm_proposal_items. Acceptance/signature fields support the public
 * accept-proposal flow (e-signature capture is a following iteration — the
 * columns exist so that feature slots in without another migration).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_proposals', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('legacy_id').unsigned().nullable().unique();

    t.string('subject', 191).notNullable();
    t.text('content').nullable();

    t.integer('client_id').unsigned().nullable();
    t.integer('lead_id').unsigned().nullable();
    t.string('proposal_to', 191).nullable();
    t.string('email', 150).nullable();
    t.string('phone', 50).nullable();
    t.string('address', 191).nullable();
    t.string('city', 100).nullable();
    t.string('state', 100).nullable();
    t.string('zip', 50).nullable();
    t.integer('country').unsigned().notNullable().defaultTo(0);

    t.string('currency', 10).notNullable().defaultTo('INR');
    t.decimal('subtotal', 15, 2).notNullable().defaultTo(0);
    t.enu('discount_type', ['percent', 'fixed']).nullable();
    t.decimal('discount_percent', 15, 2).notNullable().defaultTo(0);
    t.decimal('discount_total', 15, 2).notNullable().defaultTo(0);
    t.decimal('total_tax', 15, 2).notNullable().defaultTo(0);
    t.decimal('adjustment', 15, 2).notNullable().defaultTo(0);
    t.decimal('total', 15, 2).notNullable().defaultTo(0);

    t.date('date').notNullable();
    t.date('open_till').nullable();
    t.enu('status', ['Draft', 'Sent', 'Viewed', 'Declined', 'Accepted']).notNullable().defaultTo('Draft');
    t.integer('assigned').unsigned().notNullable().defaultTo(0);
    t.string('hash', 40).notNullable();

    t.integer('converted_invoice_id').unsigned().nullable();
    t.datetime('date_converted').nullable();

    t.string('acceptance_name', 191).nullable();
    t.string('acceptance_email', 150).nullable();
    t.datetime('acceptance_date').nullable();
    t.string('acceptance_ip', 40).nullable();
    t.text('signature').nullable();

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);

    t.index('client_id');
    t.index('lead_id');
    t.index('status');
    t.unique('hash');
  });

  await knex.schema.createTable('crm_proposal_items', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('proposal_id').unsigned().notNullable();
    t.text('description').notNullable();
    t.text('long_description').nullable();
    t.decimal('qty', 15, 2).notNullable().defaultTo(1);
    t.decimal('rate', 15, 2).notNullable().defaultTo(0);
    t.string('unit', 40).nullable();
    t.integer('tax_rate_id').unsigned().nullable();
    t.integer('item_order').unsigned().notNullable().defaultTo(0);

    t.index('proposal_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_proposal_items');
  await knex.schema.dropTableIfExists('crm_proposals');
};
