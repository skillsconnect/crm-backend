/**
 * crm_permissions — granular (user_id, feature, capability) access grants.
 *
 * Mirrors the legacy Perfex `tblstaff_permissions` shape directly, so the
 * migration from it is a straight column-for-column copy. Lives in
 * crm-backend's own tables, separate from the platform's ups_permissions /
 * ups_roles_permission_mapping system used elsewhere.
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_permissions', (t) => {
    t.increments('id').unsigned().primary();

    t.integer('user_id').unsigned().notNullable()
      .comment('References ups_users.id (value-only, no cross-DB FK)');
    t.string('feature', 100).notNullable()
      .comment("Module slug, e.g. 'leads', 'invoices'");
    t.string('capability', 50).notNullable()
      .comment("e.g. 'view', 'view_own', 'create', 'edit', 'delete'");

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());

    t.unique(['user_id', 'feature', 'capability']);
    t.index('user_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_permissions');
};
