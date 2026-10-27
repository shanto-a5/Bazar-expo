/**
 * Test launcher (M7-R).
 *
 * `npm test` cannot rely on inline environment variables because npm runs scripts
 * through `cmd.exe` on Windows, where `NODE_ENV=test node ...` is not valid. This
 * launcher sets the test environment policy in one place, then re-executes the
 * platform's own test runner as a child process so parallel execution, reporting
 * and exit codes all behave exactly as `node --test` does.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const testEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  ALLOW_MEMORY_DB: 'true',
  // The lowest cost bcrypt allows: the suite exercises the real hash path but
  // should not spend seconds on KDF rounds.
  BCRYPT_ROUNDS: '4',
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  SEED_ON_START: 'false',
};

const testDirectory = path.resolve(__dirname);
const child = spawn(process.execPath, ['--test', testDirectory], {
  stdio: 'inherit',
  env: testEnvironment,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[test] runner terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
