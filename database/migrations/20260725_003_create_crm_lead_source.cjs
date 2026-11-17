/** @param {import('knex').Knex} knex */
exports.up = async function (knex) {
  await knex.schema.createTable('crm_lead_source', (t) => {
    t.increments('id').unsigned().primary();
    t.string('name', 100).notNullable();
    t.integer('sequence').unsigned().notNullable().defaultTo(0);
    t.enu('status', ['Active', 'In-active']).notNullable().defaultTo('Active');

    t.timestamp('created_on').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_on').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
    t.integer('created_by').unsigned().notNullable().defaultTo(1);
    t.integer('updated_by').unsigned().notNullable().defaultTo(1);

    t.unique('name');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('crm_lead_source');
};
