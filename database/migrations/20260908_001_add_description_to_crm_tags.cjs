/**
 * Adds the description column to crm_tags, which the Lead Tags UI has
 * always sent on create/update but the table never persisted.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('crm_tags', 'description');
  if (!hasColumn) {
    await knex.schema.alterTable('crm_tags', (t) => {
      t.text('description').nullable();
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('crm_tags', 'description');
  if (hasColumn) {
    await knex.schema.alterTable('crm_tags', (t) => {
      t.dropColumn('description');
    });
  }
};
