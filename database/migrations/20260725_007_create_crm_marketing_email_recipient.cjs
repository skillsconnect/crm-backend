/**
 * crm_marketing_email_recipient — individual subscribers inside a mailing list.
 *
 * Replaces legacy Perfex `tblmarketing_email_recipient`. Same email may exist
 * in different lists, but only once per list (the controller relies on the
 * ER_DUP_ENTRY from the unique key during CSV import). `mail_status` is the
 * per-recipient delivery outcome; `reason` stores bounce/unsubscribe detail.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_marketing_email_recipient', (t) => {
    t.increments('id').unsigned().primary();

    t.integer('mailing_list_id').unsigned().notNullable()
      .comment('References crm_mailing_list.id');
    t.string('name', 150).nullable();
    t.string('last_name', 150).nullable();
    t.string('email', 255).notNullable();
    t.enu('mail_status', ['pending', 'queued', 'sent', 'failed', 'unsubscribed'])
      .notNullable().defaultTo('pending');
    t.text('reason').nullable()
      .comment('Bounce diagnostic / unsubscribe reason');

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(0);
    t.integer('updated_by').unsigned().notNullable().defaultTo(0);

    t.unique(['mailing_list_id', 'email']);
    t.index('email');
    t.index('mail_status');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_marketing_email_recipient');
};
