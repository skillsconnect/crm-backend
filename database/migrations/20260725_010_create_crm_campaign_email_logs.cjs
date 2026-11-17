/**
 * crm_campaign_email_logs — one row per email a campaign will send / has sent.
 *
 * Replaces legacy Perfex `tblcampaign_email_logs`, but doubles as the send
 * queue: scheduleCampaigns.js inserts rows as 'queued', sendEmails.js picks
 * them up, sends via Gmail, and flips them to 'sent'/'failed'. `response`
 * stores the raw Gmail API response JSON; `gmail_message_id` links bounces
 * detected by checkReplies.js back to the original send.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_campaign_email_logs', (t) => {
    t.increments('id').unsigned().primary();

    t.integer('campaign_id').unsigned().notNullable()
      .comment('References crm_campaigns.id');
    t.integer('template_id').unsigned().nullable()
      .comment('References crm_email_campaign_template.id (assigned at queue time)');
    t.integer('sender_id').unsigned().nullable()
      .comment('References crm_sender_emails.id (assigned at queue time)');
    t.integer('recipient_id').unsigned().nullable()
      .comment('References crm_marketing_email_recipient.id');
    t.string('recipient_email', 255).notNullable();
    t.enu('status', ['queued', 'sent', 'failed']).notNullable().defaultTo('queued');
    t.datetime('sent_at').nullable();
    t.text('error_message').nullable();
    t.text('response', 'longtext').nullable()
      .comment('JSON: raw Gmail API send response + verification stamps');
    t.string('gmail_message_id', 255).nullable();

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    t.index('campaign_id');
    t.index(['status', 'id']);
    t.index('sender_id');
    t.index('recipient_email');
    t.index('gmail_message_id');
    t.index(['sender_id', 'status', 'sent_at']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_campaign_email_logs');
};
