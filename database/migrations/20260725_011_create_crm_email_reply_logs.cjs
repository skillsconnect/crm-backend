/**
 * crm_email_reply_logs — every inbox message seen while polling sender
 * accounts (checkReplies.js): replies, bounces, and normal inbound mail.
 *
 * Replaces legacy Perfex `tblemail_reply_log`. Bounces update
 * crm_campaign_email_logs / crm_marketing_email_recipient; unsubscribe
 * requests flip the recipient to 'unsubscribed'.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_email_reply_logs', (t) => {
    t.increments('id').unsigned().primary();

    t.integer('sender_id').unsigned().notNullable()
      .comment('References crm_sender_emails.id (whose inbox this was found in)');
    t.string('gmail_message_id', 255).notNullable();
    t.string('thread_id', 255).nullable();
    t.string('from_email', 500).nullable()
      .comment('Raw From header, may include display name');
    t.string('from_email_clean', 255).nullable()
      .comment('Lowercased bare address extracted from From header');
    t.string('subject', 998).nullable();
    t.string('in_reply_to', 500).nullable();
    t.enu('type', ['normal', 'reply', 'bounce']).notNullable().defaultTo('normal');
    t.datetime('received_at').nullable();
    t.string('bounce_recipient', 255).nullable()
      .comment('Original recipient extracted from DSN body, bounces only');
    t.text('body_snippet').nullable();
    t.boolean('processed').notNullable().defaultTo(false);

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    t.unique(['gmail_message_id', 'sender_id']);
    t.index('thread_id');
    t.index('from_email_clean');
    t.index('type');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_email_reply_logs');
};
