/**
 * Seed CLI (M7-O).
 *
 * `npm run seed` writes the deterministic development dataset. `--fresh` clears
 * the seeded collections first, which is only ever appropriate against a
 * development database — it refuses to run in production.
 */
import { config, describeConfig } from '../config/env';
import { connectDatabase, disconnectDatabase, seedBundle } from '../db/connection';
import { runSeed } from './seed';

async function main(): Promise<void> {
  const fresh = process.argv.includes('--fresh');
  if (fresh && config.isProduction) {
    throw new Error('Refusing to run --fresh in production.');
  }

  const repos = await connectDatabase();
  if (fresh) {
    await seedBundle(repos).clear();
    console.log('[seed] cleared existing documents');
  }

  const summary = await runSeed(repos);
  console.log(`[seed] driver=${repos.driver} ${JSON.stringify(describeConfig())}`);
  console.log(
    `[seed] created=${summary.created} skipped=${summary.skipped} ` +
      `categories=${summary.categories} users=${summary.users} sellers=${summary.sellers} ` +
      `stores=${summary.stores} products=${summary.products} vouchers=${summary.vouchers} ` +
      `addresses=${summary.addresses} orders=${summary.orders} reviews=${summary.reviews}`,
  );
  if (summary.created === 0) console.log('[seed] already up to date (idempotent no-op)');
  await disconnectDatabase();
}

main().catch((error) => {
  console.error('[seed] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
