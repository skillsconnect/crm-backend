/**
 * In-app notifications for CRM staff (lead assignment, demo scheduling/
 * reschedule/cancel, pipeline status changes, demo reminders).
 *
 * Rows are created by services/notificationService.js, which also pushes the
 * same payload over the live WebSocket (helpers/V1/websocket.js) so a connected
 * user sees it instantly; the table is what makes them survive a refresh / an
 * offline window and drives the bell dropdown's history + unread count.
 *
 * `user_id` / `actor_id` are ups_users.id (same id space as crm_leads.assigned
 * and crm_demo_schedules.assigned_staff_id).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_notifications', (t) => {
    t.increments('id').unsigned().primary();

    t.integer('user_id').unsigned().notNullable();   // recipient (ups_users.id)
    t.integer('actor_id').unsigned().nullable();      // who triggered it

    t.string('type', 50).notNullable();              // lead_assigned, demo_scheduled, ...
    t.string('title', 191).notNullable();
    t.string('message', 500).nullable();
    t.string('link', 255).nullable();                // in-app route to open
    t.json('meta').nullable();                       // { lead_id, demo_id, meeting_link, ... }

    t.boolean('is_read').notNullable().defaultTo(false);
    t.datetime('read_at').nullable();

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());

    t.index(['user_id', 'is_read']);
    t.index(['user_id', 'id']);
    t.index('created_on');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_notifications');
};
