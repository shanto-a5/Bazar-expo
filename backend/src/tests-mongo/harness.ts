/**
 * Real-MongoDB test harness (M8).
 *
 * Connects the *real* Mongoose driver to the single-node replica set that
 * `src/tests-mongo/run.ts` started, so this suite exercises the production driver
 * end to end: real collections, real indexes, real sessions and real
 * multi-document transactions.
 *
 * A replica set rather than a standalone `mongod` is the whole point. A standalone
 * server refuses `withTransaction` outright, so a suite run against one would skip
 * the only thing this suite exists to prove. The capability is asserted below
 * rather than assumed, so a misconfigured run fails loudly instead of quietly
 * skipping its own reason to exist.
 */
import mongoose from 'mongoose';
import { createMongoRepositories, mongoTransactionCapability } from '../repositories/mongo/mongo-repositories';
import { ensureIndexes } from '../db/mongo-models';
import { config } from '../config/env';
import type { RepositoryBundle } from '../repositories/contracts';

export interface MongoHarness {
  uri: string;
  replicaSet: string;
  repos: RepositoryBundle;
  /** Drops every collection, so the next test starts from an empty database. */
  reset(): Promise<void>;
  stop(): Promise<void>;
}

let harness: MongoHarness | null = null;
let starting: Promise<MongoHarness> | null = null;

export function startMongoHarness(): Promise<MongoHarness> {
  if (harness) return Promise.resolve(harness);
  if (starting) return starting;

  starting = (async () => {
    if (!config.mongoUri) {
      throw new Error('MONGO_URI is not set. Use `npm run test:mongo`, which starts a replica set and passes it in.');
    }
    if (!config.transactionsEnabled) {
      throw new Error('MONGO_TRANSACTIONS must be enabled for the real-Mongo suite; it is the suite under test.');
    }

    mongoose.set('strictQuery', true);
    // `node --test` runs each test file in its own process, in parallel, against
    // the one replica set the launcher started. Without a per-process database
    // name, `contract.test.ts` and `transaction.test.ts` would share collections
    // and each one's `reset()` would delete the other's fixtures mid-scenario.
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 20_000,
      dbName: `${process.env.MONGO_DB_NAME ?? 'vanta_test'}_${process.pid}`,
    });
    await ensureIndexes();

    const capability = mongoTransactionCapability();
    if (!capability.capable) {
      throw new Error(`the real-Mongo suite requires multi-document transactions, but: ${capability.reason}`);
    }

    const created: MongoHarness = {
      uri: config.mongoUri,
      replicaSet: capability.replicaSet ?? 'unknown',
      repos: createMongoRepositories(),
      reset: async () => {
        const collections = Object.values(mongoose.connection.collections);
        if (collections.length > 0) {
          await Promise.all(collections.map((collection) => collection.deleteMany({})));
        }
      },
      stop: async () => {
        await mongoose.disconnect().catch(() => undefined);
        harness = null;
        starting = null;
      },
    };
    harness = created;
    return created;
  })();

  return starting;
}
