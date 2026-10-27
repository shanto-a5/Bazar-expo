/**
 * Real-MongoDB test launcher (M8).
 *
 * `npm run test:mongo` cannot rely on inline environment variables, because npm
 * runs scripts through `cmd.exe` on Windows where `NODE_ENV=test node ...` is not
 * valid. It also cannot assume a MongoDB server is installed, because this
 * repository must be verifiable on a clean machine.
 *
 * So this launcher owns the whole arrangement:
 *   1. starts a single-node MongoDB replica set from `mongodb-memory-server`
 *      (downloaded once, then cached),
 *   2. exports its URI as `MONGO_URI` for the child process, together with the test
 *      environment policy the config validator expects,
 *   3. re-executes the platform's own test runner so parallel execution, reporting
 *      and exit codes behave exactly as `node --test` does,
 *   4. stops the replica set, whatever the result.
 *
 * A replica set, not a standalone: multi-document transactions are unavailable on a
 * standalone, so the suite that exists to verify them would be testing nothing.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const REPLICA_SET_VERSION = '7.0.14';

async function main(): Promise<void> {
  let replSet: MongoMemoryReplSet | null = null;

  try {
    process.stdout.write(`[test:mongo] starting a disposable MongoDB ${REPLICA_SET_VERSION} replica set (first run downloads it)…\n`);
    replSet = await MongoMemoryReplSet.create({
      binary: { version: REPLICA_SET_VERSION },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });

    const testEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      MONGO_URI: replSet.getUri(),
      // Each test file's process appends its own pid to this, so parallel files
      // never share a database. See `tests-mongo/harness.ts`.
      MONGO_DB_NAME: 'vanta_test',
      // The real driver, with the guarantee the milestone is about.
      MONGO_TRANSACTIONS: 'true',
      // The suite is not testing the memory escape hatch, and leaving it off means
      // a silent fallback to RAM would fail loudly instead.
      ALLOW_MEMORY_DB: 'false',
      BCRYPT_ROUNDS: '4',
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '100000',
      PASSWORD_RESET_RATE_LIMIT_MAX: '100000',
      MAIL_PROVIDER: 'console',
      SEED_ON_START: 'false',
    };

    const testDirectory = path.resolve(__dirname);
    const child = spawn(process.execPath, ['--test', testDirectory], { stdio: 'inherit', env: testEnvironment });

    const code = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (exitCode, signal) => {
        if (signal) {
          console.error(`[test:mongo] runner terminated by ${signal}`);
          resolve(1);
          return;
        }
        resolve(exitCode ?? 1);
      });
    });

    process.exitCode = code;
  } catch (error) {
    console.error('[test:mongo] could not run the real-MongoDB suite:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    // The replica set is disposable either way; leaving it running would hold a port
    // and keep a mongod alive after the suite is done.
    await replSet?.stop().catch(() => undefined);
  }
}

void main();
