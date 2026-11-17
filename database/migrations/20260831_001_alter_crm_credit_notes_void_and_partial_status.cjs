/**
 * Adds void audit columns (who/when) and a distinct 'Partially Applied'
 * status so the credit note lifecycle matches Draft -> Open ->
 * Partially Applied -> Applied, with Void as a sticky terminal state.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('crm_credit_notes', (t) => {
    t.integer('voided_by').unsigned().nullable();
    t.timestamp('voided_on').nullable();
  });

  await knex.raw(
    "ALTER TABLE `crm_credit_notes` MODIFY COLUMN `status` ENUM('Draft', 'Open', 'Partially Applied', 'Applied', 'Void') NOT NULL DEFAULT 'Draft'"
  );
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex('crm_credit_notes').where('status', 'Partially Applied').update({ status: 'Open' });

  await knex.raw(
    "ALTER TABLE `crm_credit_notes` MODIFY COLUMN `status` ENUM('Draft', 'Open', 'Applied', 'Void') NOT NULL DEFAULT 'Draft'"
  );

  await knex.schema.alterTable('crm_credit_notes', (t) => {
    t.dropColumn('voided_by');
    t.dropColumn('voided_on');
  });
};
