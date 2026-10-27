/**
 * M8: the production configuration contract, proved by booting the real server.
 *
 * These rules are only worth writing down if something checks them, and the only
 * honest way to check them is to start the process with the bad configuration and
 * watch it refuse. Asserting on `config.problems` from inside the test would be
 * circular: the test would be validating the same module instance it configures,
 * loaded before the environment it thinks it is describing.
 *
 * Each case spawns `server.js` with a full production environment and one thing
 * wrong, and asserts both halves of the outcome: the process exits non-zero, and
 * the message names the setting that caused it.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';

/** A production environment that passes validation on its own. */
const productionEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb://mongo.invalid:27017/vanta',
  CORS_ORIGINS: 'https://shop.vanta.test',
  SESSION_SECRET: 'a-production-secret-that-is-long-enough-to-pass-validation',
  MAIL_PROVIDER: 'http',
  MAIL_FROM: 'no-reply@shop.vanta.test',
  MAIL_HTTP_ENDPOINT: 'https://mail.vanta.test/send',
  ALLOW_MEMORY_DB: 'false',
  SEED_ON_START: 'false',
  MONGO_TRANSACTIONS: 'false',
});

const serverEntry = path.join(__dirname, '..', 'server.js');

interface BootResult {
  code: number | null;
  output: string;
}

function boot(env: NodeJS.ProcessEnv, until?: RegExp): Promise<BootResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverEntry], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (result: BootResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
      // A server that boots successfully keeps running, so waiting for its exit
      // would mean waiting for the timeout. Stopping as soon as the line of
      // interest appears is both faster and a stronger assertion.
      if (until && until.test(output)) {
        child.kill();
        finish({ code: null, output });
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', reject);
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, output: `${output}\n[timed out: the process was still running]` });
    }, 15_000);
    child.once('exit', (code) => finish({ code, output }));
  });
}

async function refuses(env: NodeJS.ProcessEnv, expected: RegExp): Promise<void> {
  const result = await boot(env);
  assert.notEqual(result.code, 0, `the server booted anyway:\n${result.output}`);
  assert.match(result.output, expected, `the refusal did not name the offending setting:\n${result.output}`);
}

describe('production configuration', () => {
  it('refuses a wildcard CORS origin', async () => {
    await refuses({ ...productionEnv(), CORS_ORIGINS: '*' }, /CORS_ORIGINS/);
  });

  it('refuses an empty CORS allowlist', async () => {
    await refuses({ ...productionEnv(), CORS_ORIGINS: '' }, /CORS_ORIGINS/);
  });

  it('refuses the console mail transport', async () => {
    await refuses({ ...productionEnv(), MAIL_PROVIDER: 'console' }, /MAIL_PROVIDER.*console/);
  });

  it('refuses a mail provider this build cannot actually deliver with', async () => {
    // `smtp` is in the type union so a deployment can name it, but no SMTP client
    // is bundled. Catching it at boot beats discovering it when a customer asks
    // for a reset link.
    await refuses({ ...productionEnv(), MAIL_PROVIDER: 'smtp' }, /MAIL_PROVIDER=smtp/);
  });

  it('refuses the default test sender address', async () => {
    await refuses({ ...productionEnv(), MAIL_FROM: 'no-reply@vanta.test' }, /MAIL_FROM/);
  });

  it('refuses an in-memory database in production', async () => {
    await refuses({ ...productionEnv(), MONGO_URI: '' }, /MONGO_URI/);
  });

  it('refuses automatic seeding in production', async () => {
    await refuses({ ...productionEnv(), SEED_ON_START: 'true' }, /SEED_ON_START/);
  });

  it('refuses a weak session secret', async () => {
    await refuses({ ...productionEnv(), SESSION_SECRET: 'short' }, /SESSION_SECRET/);
  });

  it('rejects a negative session cap', async () => {
    await refuses({ ...productionEnv(), SESSION_MAX_PER_USER: '-1' }, /SESSION_MAX_PER_USER/);
  });

  it('accepts SESSION_MAX_PER_USER=0, which is documented as "no cap"', async () => {
    // Not a refusal case: the process gets far enough to fail on the unreachable
    // Mongo host instead, which is the proof that validation let 0 through rather
    // than treating it as a malformed number.
    const result = await boot({ ...productionEnv(), SESSION_MAX_PER_USER: '0' });
    assert.doesNotMatch(result.output, /SESSION_MAX_PER_USER/, 'zero was rejected as if it were invalid');
  });

  it('refuses to start when transactions are required but the database cannot provide them', async () => {
    // A real standalone mongod: the connection *succeeds*, so the boot reaches the
    // capability check instead of dying on a connection error, and the refusal is
    // genuinely about the transaction guarantee rather than about the network.
    const standalone = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
    try {
      const result = await boot({
        ...productionEnv(),
        MONGO_URI: standalone.getUri(),
        MONGO_TRANSACTIONS: 'true',
      });
      assert.notEqual(result.code, 0, `the server booted without transactions:\n${result.output}`);
      assert.match(result.output, /cannot provide transactions/i, result.output);
      assert.match(result.output, /MONGO_TRANSACTIONS/, result.output);
    } finally {
      await standalone.stop();
    }
  });

  it('starts on a standalone mongod when compensating writes are accepted', async () => {
    // The mirror image: with MONGO_TRANSACTIONS=false the same topology is fine, and
    // it says so out loud rather than pretending it has the stronger guarantee.
    const standalone = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
    try {
      const result = await boot(
        {
          ...productionEnv(),
          MONGO_URI: standalone.getUri(),
          MONGO_TRANSACTIONS: 'false',
        },
        /transactions unavailable/i,
      );
      assert.match(result.output, /transactions unavailable/i, result.output);
      assert.match(result.output, /compensating writes/i, result.output);
    } finally {
      await standalone.stop();
    }
  });
});
