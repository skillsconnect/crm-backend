/**
 * Demo scheduling — booking a demo against a lead blocks both the assigned
 * staff member's calendar (no two demos for the same staff can overlap) and
 * the lead's "calendar" (the same lead can't have two overlapping demos
 * either) — both enforced at the controller level via overlap queries
 * against demo_date_time/duration_minutes.
 *
 * reminder_*_sent flags let the in-process reminder scheduler (running
 * inside app.js, alongside the live WebSocket connections) fire each
 * threshold exactly once per demo.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_demo_schedules', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('lead_id').unsigned().notNullable();
    t.integer('assigned_staff_id').unsigned().notNullable();

    t.string('title', 191).nullable();
    t.datetime('demo_date_time').notNullable();
    t.integer('duration_minutes').unsigned().notNullable().defaultTo(30);

    t.string('client_name', 191).nullable();
    t.string('client_email', 150).nullable();
    t.string('client_phone', 50).nullable();

    t.string('meeting_link', 255).nullable();
    t.text('notes').nullable();

    t.enu('status', ['Scheduled', 'Completed', 'Cancelled', 'No-show']).notNullable().defaultTo('Scheduled');

    t.boolean('reminder_12hr_sent').notNullable().defaultTo(false);
    t.boolean('reminder_1hr_sent').notNullable().defaultTo(false);
    t.boolean('reminder_30min_sent').notNullable().defaultTo(false);

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);

    t.index('lead_id');
    t.index('assigned_staff_id');
    t.index('demo_date_time');
    t.index('status');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_demo_schedules');
};
