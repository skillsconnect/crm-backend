/**
 * Permission system — mirrors the legacy PHP CRM's actual working pattern:
 * `tblroles` (mostly vestigial there — only used as a label) +
 * `tblstaff_permissions` (staff_id, feature, capability) is what really
 * drives access, with the staff `admin` flag bypassing all checks entirely.
 *
 * This is intentionally kept separate from the main platform's own
 * ups_roles/ups_permissions/ups_roles_permission_mapping tables — those
 * govern the wider SkillsConnect platform's modules; crm_* here governs only
 * CRM modules (leads/proposals/invoices/etc.) and is managed from inside
 * the CRM app itself.
 *
 * Roles are made slightly more useful than the legacy version by letting
 * them carry a template permission set (crm_role_permissions) that can be
 * applied to a staff member as a starting point — but the actual
 * enforcement always reads crm_staff_permissions (the per-staff grant
 * table), exactly like legacy tblstaff_permissions. Assigning a role never
 * grants permissions by itself; applying it copies rows into
 * crm_staff_permissions.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_roles', (t) => {
    t.increments('id').unsigned().primary();
    t.string('name', 150).notNullable().unique();
    t.string('description', 255).nullable();
    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
  });

  await knex.schema.createTable('crm_role_permissions', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('role_id').unsigned().notNullable();
    t.string('feature', 40).notNullable();
    t.string('capability', 40).notNullable();

    t.unique(['role_id', 'feature', 'capability']);
    t.index('role_id');
  });

  await knex.schema.createTable('crm_staff_permissions', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('staff_id').unsigned().notNullable(); // ups_users.id
    t.string('feature', 40).notNullable();
    t.string('capability', 40).notNullable();
    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.integer('created_by').unsigned().notNullable().defaultTo(1);

    t.unique(['staff_id', 'feature', 'capability']);
    t.index('staff_id');
  });

  await knex.schema.alterTable('crm_users', (t) => {
    t.integer('role_id').unsigned().nullable();
  });

  // Seed the "Employee" role to match the legacy default, plus an "Admin"
  // role for completeness (admins bypass permission checks via is_admin
  // regardless, so this role is purely a label for them).
  await knex('crm_roles').insert([
    { name: 'Admin', description: 'Full access — bypasses permission checks via the admin flag.' },
    { name: 'Employee', description: 'Default role. Grant module access individually.' },
  ]);
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('crm_users', (t) => {
    t.dropColumn('role_id');
  });
  await knex.schema.dropTableIfExists('crm_staff_permissions');
  await knex.schema.dropTableIfExists('crm_role_permissions');
  await knex.schema.dropTableIfExists('crm_roles');
};
