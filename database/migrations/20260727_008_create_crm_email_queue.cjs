/**
 * Introductory-email queue written by lead creation (leadController
 * queueIntroductoryEmail). Column names match what the controller inserts.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_email_queue', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('lead_id').unsigned().notNullable();
    t.string('email_to', 255).notNullable();
    t.string('email_subject', 500).nullable();
    t.text('email_content').nullable();
    t.string('contact_date_time', 255).nullable();
    t.enu('status', ['pending', 'sent', 'failed']).notNullable().defaultTo('pending');
    t.datetime('sent_at').nullable();

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    t.index(['status']);
    t.index('lead_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_email_queue');
};
