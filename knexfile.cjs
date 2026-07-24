require('dotenv/config');

const ENVIRONMENT = process.env.ENVIRONMENT || 'DEVELOPMENT';

const connections = {
  DEVELOPMENT: {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'skillsconnect_saas',
    port: 3306,
    timezone: '+05:30',
    dateStrings: true,
  },
  STAGING: {
    host: '20.197.6.60',
    user: 'sk_stage_mern',
    password: 'sk3tage2d33',
    database: 'sk_stage',
    port: 3306,
    timezone: '+05:30',
    dateStrings: true,
  },
  PRODUCTION: {
    host: '20.198.48.52',
    user: 'skdblivemern',
    password: 'skdvsd332!',
    database: 'skdblive',
    port: 3306,
    timeout: 300000,
    timezone: '+05:30',
    dateStrings: true,
  },
};

module.exports = {
  client: 'mysql2',
  connection: connections[ENVIRONMENT] || connections.DEVELOPMENT,
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './database/migrations',
    extension: 'cjs',
    loadExtensions: ['.cjs'],
    // Separate tracking table from skillsconnect-node's migrations, since both
    // currently point at the same physical `skillsconnect_saas` database —
    // each service owns its own migration history independently.
    tableName: 'crm_knex_migrations',
  },
};
