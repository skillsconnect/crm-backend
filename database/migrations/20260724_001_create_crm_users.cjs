/**
 * crm_users — CRM-owned staff profile data.
 *
 * ups_users stays thin (identity + login: email, password, user_type=23).
 * This table holds the full staff profile migrated from the legacy Perfex
 * `tblstaff` table, keyed by `user_id` (value-reference to ups_users.id —
 * no real cross-DB FK, since this table may live in a different physical
 * database from ups_users in the future).
 */

/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_users', (t) => {
    t.increments('id').unsigned().primary();

    t.integer('user_id').unsigned().notNullable()
      .comment('References ups_users.id (value-only, no cross-DB FK)');
    t.integer('legacy_staff_id').unsigned().nullable()
      .comment('tblstaff.staffid in the legacy Perfex CRM, for migration traceability');

    t.boolean('is_admin').notNullable().defaultTo(false)
      .comment('Superadmin bypass — mirrors legacy tblstaff.admin');
    t.string('department', 100).nullable();
    t.string('designation', 100).nullable();
    t.decimal('hourly_rate', 10, 2).nullable();
    t.string('default_language', 20).nullable();
    t.string('profile_image', 255).nullable();

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    t.unique('user_id');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_users');
};
