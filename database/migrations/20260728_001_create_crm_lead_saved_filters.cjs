/**
 * Named filter presets for the leads list/kanban offcanvas — lets a user save
 * a combination of search/status/source/assigned/tag/sort and re-apply it
 * later instead of rebuilding it every time. Scoped per-user (created_by).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_lead_saved_filters', (t) => {
    t.increments('id').unsigned().primary();
    t.string('name', 100).notNullable();
    t.json('filters').notNullable();
    t.integer('created_by').unsigned().notNullable();
    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());

    t.index('created_by');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_lead_saved_filters');
};
