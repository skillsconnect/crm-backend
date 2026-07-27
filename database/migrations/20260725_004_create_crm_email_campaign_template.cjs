/**
 * crm_email_campaign_template — reusable campaign email templates.
 *
 * Replaces legacy Perfex `tblemail_campaign_template`. Fresh schema (campaign
 * data is NOT migrated from the legacy CRM). Body supports {first_name} /
 * {last_name} style placeholders filled by email_content.helper.js.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_email_campaign_template', (t) => {
    t.increments('id').unsigned().primary();

    t.string('template_name', 255).notNullable();
    t.string('slug', 255).notNullable();
    t.string('email_subject', 500).notNullable();
    t.text('email_content', 'longtext').notNullable();
    t.enu('status', ['Active', 'Inactive']).notNullable().defaultTo('Active');

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(0);
    t.integer('updated_by').unsigned().notNullable().defaultTo(0);

    t.unique('slug');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_email_campaign_template');
};
