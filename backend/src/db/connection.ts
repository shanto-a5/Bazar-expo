/**
 * Mongo connection lifecycle (M7-C / M8-C).
 *
 * The process refuses to start without a datastore. `ALLOW_MEMORY_DB=true` is a
 * development-only escape hatch and is rejected outright in production by the
 * config validator, so a production deploy can never silently run on RAM.
 *
 * M8: after connecting, every declared index is applied before the server starts
 * accepting traffic. The unique index behind the idempotency claim is a
 * correctness guarantee, not an optimisation — a replica set created before M8
 * does not have it, and a checkout that believed it did would allow two orders
 * for one submit.
 */
import mongoose from 'mongoose';
import { config } from '../config/env';
import { createMongoRepositories, mongoTransactionCapability } from '../repositories/mongo/mongo-repositories';
import { createMemoryRepositories } from '../repositories/memory/memory-repositories';
import { ensureIndexes } from './mongo-models';
import type { RepositoryBundle, SeedBundle } from '../repositories/contracts';

let bundle: RepositoryBundle | null = null;
let memoryBundle: SeedBundle | null = null;

export async function connectDatabase(): Promise<RepositoryBundle> {
  if (bundle) return bundle;
  if (!config.mongoUri) {
    if (!config.allowMemoryDb) {
      throw new Error(
        'MONGO_URI is not set. Configure a MongoDB connection string, or set ALLOW_MEMORY_DB=true for a development run.',
      );
    }
    console.warn('[db] MONGO_URI is not set — using the in-memory driver (development only).');
    memoryBundle = createMemoryRepositories();
    bundle = memoryBundle;
    return bundle;
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8_000 });
  await ensureIndexes();
  console.log('[db] connected to MongoDB, indexes verified');

  const transactions = mongoTransactionCapability();
  if (!transactions.capable) {
    if (config.transactionsEnabled && config.isProduction) {
      // Compensating writes are a development convenience. A production deploy
      // that *asked* for transactions and did not get them has a weaker guarantee
      // than its configuration claims, so it is refused at boot instead of being
      // downgraded quietly and reported only by /health/ready.
      throw new Error(
        `MONGO_TRANSACTIONS is enabled but the database cannot provide transactions (${transactions.reason}). ` +
          'Point MONGO_URI at a replica set or sharded cluster, or set MONGO_TRANSACTIONS=false to accept compensating writes.',
      );
    }
    // Said plainly at boot and again by /health/ready: checkout will use
    // compensating writes here, and that is a weaker guarantee than a
    // transaction. Pretending otherwise would be the actual defect.
    console.warn(`[db] transactions unavailable (${transactions.reason}) — checkout will use compensating writes`);
  } else {
    console.log(`[db] transactions available (replica set ${transactions.replicaSet})`);
  }

  bundle = createMongoRepositories();
  return bundle;
}

export async function disconnectDatabase(): Promise<void> {
  bundle = null;
  memoryBundle = null;
  await mongoose.disconnect().catch(() => undefined);
}

/** Seed target: available for the memory driver, a Mongo-backed bundle otherwise. */
export function seedBundle(current: RepositoryBundle): SeedBundle {
  if (current.driver === 'memory' && memoryBundle) return memoryBundle;
  const withClear: SeedBundle = {
    ...current,
    clear: async () => {
      const collections = Object.values(mongoose.connection.collections);
      await Promise.all(collections.map((collection) => collection.deleteMany({})));
    },
  };
  return withClear;
}

export async function pingDatabase(): Promise<{ ok: boolean; driver: string; detail?: string }> {
  if (!bundle) return { ok: false, driver: 'none', detail: 'not connected' };
  return bundle.ping();
}
