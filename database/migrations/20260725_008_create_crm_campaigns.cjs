/**
 * crm_campaigns — a scheduled email blast.
 *
 * Replaces legacy Perfex `tblcampaigns`. `template_id` and `sender_email_id`
 * are CSV id lists (kept from the legacy design because the controller,
 * frontend, and rotation logic all speak CSV; mailing lists moved to the
 * proper junction table crm_campaign_mailing_lists).
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_campaigns', (t) => {
    t.increments('id').unsigned().primary();

    t.string('name', 255).notNullable();
    t.string('template_id', 500).notNullable()
      .comment('CSV of crm_email_campaign_template.id (rotated round-robin)');
    t.string('sender_email_id', 500).notNullable()
      .comment('CSV of crm_sender_emails.id (rotated round-robin)');
    t.datetime('schedule_time').notNullable();
    t.enu('status', ['scheduled', 'in_progress', 'completed', 'failed', 'cancelled'])
      .notNullable().defaultTo('scheduled');

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(0);
    t.integer('updated_by').unsigned().notNullable().defaultTo(0);

    t.index(['status', 'schedule_time']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_campaigns');
};
