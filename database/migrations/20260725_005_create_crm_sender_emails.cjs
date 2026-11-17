/**
 * crm_sender_emails — Gmail accounts used to send campaign emails.
 *
 * Replaces legacy Perfex `tblsender_emails`. `email_details` stores the
 * Google OAuth token bundle as JSON (access_token, refresh_token,
 * expiry_date, scope, connected flag) written by googleOAuthHelper.js.
 * `daily_limit` caps sends per rolling 24h per sender (Gmail anti-spam).
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_sender_emails', (t) => {
    t.increments('id').unsigned().primary();

    t.string('sender_name', 150).notNullable();
    t.string('email', 255).notNullable();
    t.integer('daily_limit').unsigned().notNullable().defaultTo(500);
    t.text('email_details', 'longtext').nullable()
      .comment('JSON: Google OAuth tokens; NULL until Gmail is connected');
    t.enu('status', ['Active', 'Inactive']).notNullable().defaultTo('Active');

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(0);
    t.integer('updated_by').unsigned().notNullable().defaultTo(0);

    t.unique('email');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_sender_emails');
};
