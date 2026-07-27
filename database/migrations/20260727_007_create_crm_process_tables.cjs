/**
 * Process automation master + per-lead assignments. Column set is driven by
 * processController/processService/leadController usage (they were written
 * before these tables existed).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_process', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('sequence').unsigned().notNullable().defaultTo(0);
    t.string('process_name', 191).notNullable();
    t.string('email_subject', 500).nullable();
    t.text('email_content').nullable();
    t.text('whatsapp_content').nullable();
    t.string('communication_mode', 50).notNullable().defaultTo('email'); // email | whatsapp | email,whatsapp
    t.enu('status', ['Active', 'In-active']).notNullable().defaultTo('Active');

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);

    t.unique('process_name');
  });

  await knex.schema.createTable('crm_process_staff', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('lead_id').unsigned().notNullable();
    t.integer('master_process_id').unsigned().notNullable();
    t.integer('sequence').unsigned().notNullable().defaultTo(0);
    t.string('process_name', 191).nullable();
    t.string('email_subject', 500).nullable();
    t.text('email_content').nullable();
    t.text('whatsapp_content').nullable();
    t.string('communication_mode', 50).notNullable().defaultTo('email');
    t.integer('staff_id').unsigned().notNullable().defaultTo(1);
    t.datetime('contact_date_time').nullable();
    t.enu('email_sent', ['pending', 'sent', 'failed']).notNullable().defaultTo('pending');
    t.datetime('sent_at').nullable();
    t.enu('status', ['Active', 'In-active']).notNullable().defaultTo('Active');

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);

    t.unique(['lead_id', 'master_process_id']);
    t.index(['email_sent', 'contact_date_time']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_process_staff');
  await knex.schema.dropTableIfExists('crm_process');
};
