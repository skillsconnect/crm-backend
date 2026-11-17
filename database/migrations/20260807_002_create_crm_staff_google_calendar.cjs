/**
 * Per-staff Google Calendar OAuth connection, used for one-way event push
 * when a demo is scheduled/rescheduled/cancelled (see demoController.js +
 * helpers/V1/googleOAuthHelper.js's calendar methods). Separate from
 * crm_sender_emails (that's Gmail-send OAuth for campaign senders, a
 * different concept — a "sender" isn't necessarily a staff member's own
 * calendar) even though both flows share the same Google OAuth client and
 * callback route (google only allows one registered redirect URI, so the
 * shared callback disambiguates via the `state` param's `type` field).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_staff_google_calendar', (t) => {
    t.increments('id').unsigned().primary();
    t.integer('staff_id').unsigned().notNullable().unique();
    t.text('access_token').nullable();
    t.text('refresh_token').nullable();
    t.bigInteger('expiry_date').unsigned().nullable();
    t.string('token_type', 40).nullable();
    t.string('scope', 255).nullable();
    t.string('calendar_id', 191).notNullable().defaultTo('primary');
    t.boolean('connected').notNullable().defaultTo(true);
    t.string('last_error', 255).nullable();
    t.timestamp('connected_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });

  await knex.schema.alterTable('crm_demo_schedules', (t) => {
    t.string('google_event_id', 255).nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.alterTable('crm_demo_schedules', (t) => {
    t.dropColumn('google_event_id');
  });
  await knex.schema.dropTableIfExists('crm_staff_google_calendar');
};
