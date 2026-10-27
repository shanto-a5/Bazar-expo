/**
 * Contract suite — real MongoDB replica set (M8).
 *
 * The same scenario list the in-memory suite runs, against the production driver.
 * A scenario that passes on RAM and fails here is a real defect in the Mongo
 * driver: a missing index, a filter that does not survive `lean()`, or a
 * transaction that does not actually roll back.
 *
 * Each scenario gets a `reset()` beforehand and a fresh seed, mirroring the
 * in-memory suite exactly, so neither suite can pass on leftovers from the other.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerContractSuite, type BundleFactory } from '../contract/runner';
import { startMongoHarness, type MongoHarness } from './harness';

let mongo: MongoHarness;

before(async () => {
  mongo = await startMongoHarness();
  console.log(`[test:mongo] connected to replica set "${mongo.replicaSet}" — multi-document transactions available`);
});

after(async () => {
  await mongo?.stop();
});

describe('real MongoDB', () => {
  it('is actually using the mongo driver with transactions', () => {
    // Asserted first and loudly: if this ever reads `memory`, everything below is
    // testing RAM while being reported as MongoDB.
    assert.equal(mongo.repos.driver, 'mongo');
    assert.equal(mongo.repos.supportsTransactions, true);
  });
});

const factory: BundleFactory = () => mongo.repos;
factory.dispose = () => mongo.reset();

registerContractSuite('mongo replica set', factory);
