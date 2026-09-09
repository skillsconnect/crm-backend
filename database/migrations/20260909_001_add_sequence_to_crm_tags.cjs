/**
 * Adds a sequence column to crm_tags so tags can be manually reordered
 * via drag & drop on the Lead Tags master page.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('crm_tags', 'sequence');
  if (!hasColumn) {
    await knex.schema.alterTable('crm_tags', (t) => {
      t.integer('sequence').unsigned().nullable();
    });
  }

  const rows = await knex('crm_tags').select('id').orderBy('id', 'asc');
  await Promise.all(
    rows.map((row, index) => knex('crm_tags').where({ id: row.id }).update({ sequence: index + 1 }))
  );
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('crm_tags', 'sequence');
  if (hasColumn) {
    await knex.schema.alterTable('crm_tags', (t) => {
      t.dropColumn('sequence');
    });
  }
};
