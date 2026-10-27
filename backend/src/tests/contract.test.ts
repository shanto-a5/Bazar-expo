/**
 * Contract suite — in-memory driver (M8).
 *
 * Runs the shared scenario list against `createMemoryRepositories()`. This is the
 * fast default gate; `src/tests-mongo` runs the same list against a real MongoDB
 * replica set, and a scenario that passes here but fails there is a real defect in
 * one of the two drivers.
 */
import { createMemoryRepositories } from '../repositories/memory/memory-repositories';
import { registerContractSuite } from '../contract/runner';

registerContractSuite('memory driver', createMemoryRepositories);
