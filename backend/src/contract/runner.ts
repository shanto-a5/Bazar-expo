/**
 * Scenario runner shared by both driver suites (M8).
 *
 * Each scenario gets its own freshly seeded bundle and its own recording mail
 * transport, and tears both down afterwards, so a failure in one cannot be
 * explained by leftovers from another and the two suites stay independent.
 */
import { describe, it } from 'node:test';
import { recordingMail, serveHarness } from './harness';
import { scenarios } from './scenarios';
import { runSeed } from '../seed/seed';
import type { RepositoryBundle } from '../repositories/contracts';

export interface BundleFactory {
  (): Promise<RepositoryBundle> | RepositoryBundle;
  /** Called after each scenario, e.g. to clear a shared database. */
  dispose?(): Promise<void> | void;
}

/**
 * Registers the shared scenarios under `node:test`. Both `src/tests/contract.test`
 * (memory) and `src/tests-mongo/contract.test` (real replica set) call this, which
 * is what makes "identical behaviour on both drivers" a checked claim rather than
 * an intention.
 */
export function registerContractSuite(label: string, factory: BundleFactory): void {
  describe(`contract · ${label}`, () => {
    for (const scenario of scenarios) {
      it(scenario.name, async () => {
        const mail = recordingMail();
        const repos = await factory();
        try {
          await runSeed(repos);
          const harness = await serveHarness({ repos, mail });
          try {
            await scenario.run({ harness, mail: mail.sent });
          } finally {
            await harness.close();
          }
        } finally {
          await factory.dispose?.();
        }
      });
    }
  });
}
