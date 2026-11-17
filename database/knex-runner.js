import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load CJS knexfile then create knex instance via ESM import
const config = require('../knexfile.cjs');
const { default: Knex } = await import('knex');
const knex = Knex(config);

const command = process.argv[2];
const arg = process.argv[3];

try {
  switch (command) {

    case 'latest': {
      const [batch, log] = await knex.migrate.latest();
      if (!log.length) {
        console.log('✅ Already up to date');
      } else {
        console.log(`✅ Batch ${batch} — ${log.length} migration(s) run:`);
        log.forEach(m => console.log('  •', path.basename(m)));
      }
      break;
    }

    case 'rollback': {
      const [batch, log] = await knex.migrate.rollback();
      if (!log.length) {
        console.log('⚠️  Nothing to roll back');
      } else {
        console.log(`↩️  Batch ${batch} rolled back — ${log.length} migration(s):`);
        log.forEach(m => console.log('  •', path.basename(m)));
      }
      break;
    }

    case 'status': {
      const [completed, pending] = await knex.migrate.list();
      console.log(`\nCompleted (${completed.length}):`);
      completed.forEach(m => console.log('  ✅', path.basename(m.name || m)));
      console.log(`\nPending (${pending.length}):`);
      pending.forEach(m => console.log('  ⏳', path.basename(m.file || m)));
      break;
    }

    case 'make': {
      if (!arg) {
        console.error('Usage: npm run migrate:make -- <migration_name>');
        process.exit(1);
      }
      const file = await knex.migrate.make(arg, {
        stub: path.join(__dirname, 'migration-stub.js'),
      });
      console.log('✅ Created:', file);
      break;
    }
    case 'unlock': {
      await knex.migrate.forceFreeMigrationsLock();
      console.log('✅ Migration lock released');
      break;
    }

    default:
      console.error(`Unknown command: "${command}". Use: latest | rollback | status | make`);
      process.exit(1);
  }
} catch (err) {
  console.error('Migration error:', err.message);
  process.exit(1);
} finally {
  await knex.destroy();
}
