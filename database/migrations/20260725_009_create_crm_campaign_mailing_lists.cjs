/**
 * crm_campaign_mailing_lists — junction: which mailing lists a campaign targets,
 * plus per-list send progress.
 *
 * Replaces legacy Perfex `tblcampaign_mailing_lists`.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_campaign_mailing_lists', (t) => {
    t.increments('id').unsigned().primary();

    t.integer('campaign_id').unsigned().notNullable()
      .comment('References crm_campaigns.id');
    t.integer('mailing_list_id').unsigned().notNullable()
      .comment('References crm_mailing_list.id');
    t.enu('status', ['pending', 'in_progress', 'completed'])
      .notNullable().defaultTo('pending');
    t.integer('total_emails').unsigned().notNullable().defaultTo(0);
    t.integer('sent_count').unsigned().notNullable().defaultTo(0);

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    t.index('campaign_id');
    t.index('mailing_list_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_campaign_mailing_lists');
};
