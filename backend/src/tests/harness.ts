/**
 * Test harness (M7-R) — thin wrapper over the shared M8 contract harness.
 *
 * Boots the *real* Express app and the *real* services against a fresh in-memory
 * repository bundle, then drives it over a real HTTP socket on an ephemeral port.
 * No mocks, no shared state between files, no database process required.
 *
 * The bootstrap, HTTP client and seed references moved to `src/contract/harness`
 * in M8 so the identical scenario code can also run against a real MongoDB
 * replica set. This file keeps the M7 import path working.
 */
import { createMemoryRepositories } from '../repositories/memory/memory-repositories';
import { runSeed } from '../seed/seed';
import { serveHarness, type TestHarness } from '../contract/harness';

export { SEED, signIn, serveHarness } from '../contract/harness';
export type { ApiResult, Envelope, TestHarness } from '../contract/harness';

export async function startHarness(options: { seed?: boolean } = {}): Promise<TestHarness> {
  const repos = createMemoryRepositories();
  if (options.seed !== false) await runSeed(repos);
  return serveHarness({ repos });
}
