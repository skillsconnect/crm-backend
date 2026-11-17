/**
 * crm_users was missing created_by/updated_by — every other table in both
 * codebases (ups_admin_users, ups_roles, etc.) carries these as NOT NULL
 * audit columns. Adding them for consistency, defaulting existing/future
 * system-created rows to user id 1 (matches the seed convention already used
 * for the ups_roles CRM Staff row).
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.alterTable('crm_users', (t) => {
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('crm_users', (t) => {
    t.dropColumn('created_by');
    t.dropColumn('updated_by');
  });
};
