/**
 * Real-MongoDB transaction and index proofs (M8).
 *
 * These are guarantees the in-memory suite *cannot* make, because they are
 * properties of the database rather than of the code:
 *
 *   - a failure part-way through checkout rolls back every write it had already
 *     made, which is what a compensating write can only approximate;
 *   - the commit path really does persist all of it;
 *   - the unique index behind the idempotency claim is enforced by the server, so
 *     two concurrent submits of one key cannot both create an order;
 *   - the TTL indexes hang off real BSON dates, so the server can act on them.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import mongoose from 'mongoose';
import { createMongoRepositories, mongoTransactionCapability } from '../repositories/mongo/mongo-repositories';
import { runSeed } from '../seed/seed';
import { SEED, recordingMail, serveHarness, signIn, type Envelope, type TestHarness } from '../contract/harness';
import { startMongoHarness, type MongoHarness } from './harness';
import {
  CartModel,
  IdempotencyRecordModel,
  OrderModel,
  PasswordResetTokenModel,
  PaymentModel,
  ProductModel,
  SellerOrderModel,
  SessionModel,
} from '../db/mongo-models';
import type { IdempotencyRecordEntity } from '../domain/entities';
import type { RepositoryBundle } from '../repositories/contracts';

const checkout = (overrides: Record<string, unknown> = {}) => ({
  address: { ...SEED.address },
  paymentMethod: 'cod',
  ...overrides,
});

/**
 * Direct collection access, so a claim means "the server stored it", not "we think
 * we did".
 *
 * Names are taken from the models rather than typed out. A hardcoded
 * `'idempotencykeys'` addressed a namespace nothing ever writes: Mongoose derives
 * `idempotencyrecords` from the model name, so every assertion against it passed
 * vacuously against an empty collection while the real rows went unexamined.
 */
const raw = (model: { collection: { name: string } }) => mongoose.connection.collection(model.collection.name);
const rawIdempotency = () => raw(IdempotencyRecordModel);
const rawSessions = () => raw(SessionModel);
const rawResetTokens = () => raw(PasswordResetTokenModel);
const rawOrders = () => raw(OrderModel);
const rawProducts = () => raw(ProductModel);
const rawCarts = () => raw(CartModel);
const rawPayments = () => raw(PaymentModel);
const rawSellerOrders = () => raw(SellerOrderModel);

describe('real MongoDB · transactions', () => {
  let mongo: MongoHarness;

  before(async () => {
    mongo = await startMongoHarness();
  });
  after(async () => {
    await mongo?.stop();
  });

  it('is connected to a replica set, and reports transactions as available', () => {
    const capability = mongoTransactionCapability();
    assert.equal(capability.capable, true, capability.reason);
    assert.ok(capability.replicaSet, 'the connected topology names a replica set');
    assert.equal(mongo.repos.driver, 'mongo');
    assert.equal(mongo.repos.supportsTransactions, true);
  });

  it('commits every write of a successful checkout together', async () => {
    await mongo.reset();
    await runSeed(mongo.repos);
    const harness = await serveHarness({ repos: mongo.repos, mail: recordingMail() });
    try {
      const token = await signIn(harness, SEED.customerEmail);
      const userId = await currentUserId(harness, token);
      await harness.request('/cart/items', {
        method: 'POST',
        token,
        body: JSON.stringify({ productId: SEED.productActive, quantity: 2 }),
      });
      const stockBefore = (await mongo.repos.products.findById(SEED.productActive))!.stock;

      const result = await harness.request<Envelope<{ order: { id: string; sellerOrderIds: string[] } }>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(checkout({ idempotencyKey: 'commit-path' })),
      });
      assert.equal(result.status, 201);
      const orderId = result.body.data!.order.id;

      assert.ok(await rawOrders().findOne({ _id: orderId } as never), 'the order row is on the server');
      assert.equal(await rawPayments().countDocuments({ orderId } as never), 1, 'exactly one payment row');
      assert.equal(
        await rawSellerOrders().countDocuments({ orderId } as never),
        result.body.data!.order.sellerOrderIds.length,
        'every seller split persisted',
      );
      assert.equal((await mongo.repos.products.findById(SEED.productActive))!.stock, stockBefore - 2, 'stock was decremented');
      assert.equal((await mongo.repos.carts.findByUserId(userId))?.items.length, 0, 'the ordered items left the cart');
      const record = await rawIdempotency().findOne({ key: 'commit-path' } as never);
      assert.equal(record?.state, 'completed', 'the idempotency record was completed');
      assert.equal(record?.resourceId, orderId, 'it points at the order it created');
    } finally {
      await harness.close();
    }
  });

  it('rolls back every earlier write when checkout fails after stock has moved', async () => {
    await mongo.reset();
    await runSeed(mongo.repos);

    // The failure is armed on the *payment* write, which checkout performs after
    // reserving stock and before creating the order — so by the time it throws
    // there is a real, already-written stock decrement to undo.
    //
    // The fault lives in this test file, built from the exported production
    // factory, so nothing in `src/repositories` exists only for testing.
    const faulting = faultInjectingBundle(mongo.repos, 'payments');
    const harness = await serveHarness({ repos: faulting, mail: recordingMail() });
    try {
      const token = await signIn(harness, SEED.customerEmail);
      const userId = await currentUserId(harness, token);
      await harness.request('/cart/items', {
        method: 'POST',
        token,
        body: JSON.stringify({ productId: SEED.productActive, quantity: 2 }),
      });

      const stockBefore = (await mongo.repos.products.findById(SEED.productActive))!.stock;
      const ordersBefore = await rawOrders().countDocuments({ customerId: userId } as never);
      const paymentsBefore = await rawPayments().countDocuments({} as never);

      const result = await harness.request<Envelope<unknown>>('/orders', {
        method: 'POST',
        token,
        body: JSON.stringify(checkout({ idempotencyKey: 'rollback-path' })),
      });
      assert.ok(result.status >= 500, `the injected failure surfaces as a server error, got ${result.status}`);

      // The decisive part: read the outcome back from the server.
      assert.equal(
        (await mongo.repos.products.findById(SEED.productActive))!.stock,
        stockBefore,
        'the stock decrement was rolled back by the transaction, not patched up afterwards',
      );
      assert.equal(await rawOrders().countDocuments({ customerId: userId } as never), ordersBefore, 'no order row survived');
      assert.equal(await rawPayments().countDocuments({} as never), paymentsBefore, 'no payment row survived');
      assert.equal(
        await rawIdempotency().countDocuments({ key: 'rollback-path' } as never),
        0,
        'the failed attempt released its key',
      );
    } finally {
      await harness.close();
    }
  });

  it('lets exactly one of two concurrent claims on the same key win', async () => {
    await mongo.reset();
    await runSeed(mongo.repos);
    const timestamp = new Date().toISOString();
    const record: IdempotencyRecordEntity = {
      id: 'idm_concurrent_a',
      scope: 'checkout',
      ownerId: 'usr_seed_customer_1',
      key: 'concurrent-key',
      requestFingerprint: 'fingerprint-1',
      state: 'in_flight',
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.now() + 60_000),
    };

    // Both claims are in flight at the same moment, so neither can see the
    // other's row. Mutual exclusion therefore has to come from the unique index
    // being enforced by the server, not from a read-then-write in application code.
    const results = await Promise.all([
      mongo.repos.idempotency.claim(record),
      mongo.repos.idempotency.claim({ ...record, id: 'idm_concurrent_b' }),
    ]);

    assert.equal(results.filter((outcome) => outcome !== null).length, 1, 'exactly one claim took the key');
    assert.equal(results.filter((outcome) => outcome === null).length, 1, 'the other was told it lost');
    const rows = await rawIdempotency().find({ key: 'concurrent-key' } as never).toArray();
    assert.equal(rows.length, 1, `one row, not two: ${JSON.stringify(rows)}`);
  });

  it('turns two concurrent checkouts with one key into a single order', async () => {
    await mongo.reset();
    await runSeed(mongo.repos);
    const harness = await serveHarness({ repos: mongo.repos, mail: recordingMail() });
    try {
      const token = await signIn(harness, SEED.customerEmail);
      const userId = await currentUserId(harness, token);
      await harness.request('/cart/items', {
        method: 'POST',
        token,
        body: JSON.stringify({ productId: SEED.productActive, quantity: 1 }),
      });
      const stockBefore = (await mongo.repos.products.findById(SEED.productActive))!.stock;
      // The seed ships one delivered order for this customer, so the count has to
      // be relative to a baseline rather than an absolute 1.
      const ordersBefore = await rawOrders().countDocuments({ customerId: userId } as never);

      const [first, second] = await Promise.all([
        harness.request<Envelope<{ order: { id: string } }>>('/orders', {
          method: 'POST',
          token,
          body: JSON.stringify(checkout({ idempotencyKey: 'concurrent-checkout' })),
        }),
        harness.request<Envelope<{ order: { id: string } }>>('/orders', {
          method: 'POST',
          token,
          body: JSON.stringify(checkout({ idempotencyKey: 'concurrent-checkout' })),
        }),
      ]);

      const statuses = [first.status, second.status].join(',');
      const created = [first, second].filter((response) => response.status === 201);
      assert.equal(created.length, 1, `one request created the order, got statuses ${statuses}`);

      // The loser of the claim race has two legitimate answers, and which one
      // arrives depends on how far the winner had got: replay the stored order
      // (200) if it finished first, or be told to wait (409) if it is still in
      // flight. What is *not* legitimate is a second order, and asserting the
      // specific status would only pin down one interleaving of a race.
      const loser = [first, second].find((response) => response.status !== 201)!;
      assert.ok(loser.status === 200 || loser.status === 409, `the loser answered ${loser.status}, which is neither a replay nor a conflict`);
      if (loser.status === 200) {
        assert.equal(loser.body.data!.order.id, created[0].body.data!.order.id, 'the replay pointed at the same order');
      } else {
        assert.equal(loser.body.error!.code, 'conflict', 'the conflict is a typed one, not a 500');
      }
      assert.equal(await rawOrders().countDocuments({ customerId: userId } as never), ordersBefore + 1, 'exactly one new order row exists');
      assert.equal((await mongo.repos.products.findById(SEED.productActive))!.stock, stockBefore - 1, 'stock moved once, not twice');
    } finally {
      await harness.close();
    }
  });

  it('declares TTL indexes over real BSON dates, so the server can act on them', async () => {
    await mongo.reset();
    for (const model of [SessionModel, IdempotencyRecordModel, PasswordResetTokenModel]) {
      const collection = model.collection.name;
      const collectionRef = mongoose.connection.collection(collection);
      // `reset()` empties the collections, and a rolled-back checkout never
      // creates the idempotency collection at all, so `indexes()` can hit a
      // namespace that is not there. These tests own their preconditions rather
      // than inheriting whatever the test before them happened to write.
      await createCollectionIfMissing(collection);
      const indexes = await collectionRef.indexes();
      const ttl = indexes.find((index) => index.expireAfterSeconds !== undefined);
      assert.ok(ttl, `${collection} declares a TTL index`);
      const field = Object.keys(ttl!.key as Record<string, unknown>)[0];
      assert.equal(field, 'expiresAt', `${collection} hangs its TTL off expiresAt`);

      // A TTL index over a string column is accepted by the server and then
      // silently ignored by the TTL monitor, so the index existing proves nothing.
      // Writing a real Date and reading it back as one is the part that matters.
      const probe = `${collection}_ttl_probe`;
      await collectionRef.insertOne({ _id: probe, expiresAt: new Date(Date.now() + 60_000) } as never);
      const stored = await collectionRef.findOne({ _id: probe } as never);
      assert.ok(stored!.expiresAt instanceof Date, `${collection}.expiresAt is stored as a BSON date`);
      await collectionRef.deleteOne({ _id: probe } as never);
    }
  });

  it('lets the TTL monitor actually remove an expired row', async () => {
    await mongo.reset();
    // The monitor runs about once a minute, so this is the one test in the suite
    // that waits. It is here because "the index is declared" and "documents are
    // reaped" are different claims and only the second one bounds the collection.
    await createCollectionIfMissing('idempotencykeys');
    await rawIdempotency().insertOne({
      _id: 'idm_ttl_probe',
      scope: 'checkout',
      ownerId: 'usr_seed_customer_1',
      key: 'ttl-probe',
      requestFingerprint: 'x',
      state: 'completed',
      resourceId: null,
      responseStatus: 201,
      expiresAt: new Date(Date.now() + 1_000),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    assert.ok(await rawIdempotency().findOne({ _id: 'idm_ttl_probe' } as never), 'the probe row is there to start');

    const deadline = Date.now() + 90_000;
    let remaining = await rawIdempotency().countDocuments({ _id: 'idm_ttl_probe' } as never);
    while (remaining > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      remaining = await rawIdempotency().countDocuments({ _id: 'idm_ttl_probe' } as never);
    }
    assert.equal(remaining, 0, 'the TTL monitor reaped the expired row');
  });

  it('enforces unique indexes on the server, not just in application code', async () => {
    await mongo.reset();
    await runSeed(mongo.repos);
    // Signing in through the real route gives a session that the application
    // actually wrote, rather than a hand-built row that would only prove the
    // index rejects a document this codebase could never have produced.
    const harness = await serveHarness({ repos: mongo.repos, mail: recordingMail() });
    try {
      const signedIn = await signIn(harness, SEED.customerEmail);
      const userId = await currentUserId(harness, signedIn);
      const existing = await rawSessions().findOne({ userId } as never);
      assert.ok(existing, 'signing in persisted a session row');
      assert.ok(typeof existing!.token === 'string' && existing!.token.length > 0, 'the row carries its token');

      await assert.rejects(
        () => rawSessions().insertOne({ ...existing, _id: `${existing!._id}-copy` } as never),
        /E11000|duplicate key/i,
        'a duplicate session token is refused by the server',
      );
    } finally {
      await harness.close();
    }
  });
});

async function createCollectionIfMissing(name: string): Promise<void> {
  const existing = await mongoose.connection.db!.listCollections({ name }).toArray();
  if (existing.length === 0) await mongoose.connection.db!.createCollection(name);
}

async function currentUserId(harness: TestHarness, token: string): Promise<string> {
  const me = await harness.request<Envelope<{ user: { id: string } }>>('/auth/me', { token });
  if (!me.body.data) throw new Error('could not resolve the current user');
  return me.body.data.user.id;
}

/**
 * Builds a bundle that behaves exactly like the production one except that the
 * named write throws the first time it is reached.
 *
 * `createMongoRepositories(session)` is the real factory, so the faulting bundle
 * runs the real Mongoose models inside a real session and a real `withTransaction`.
 * Only one method is replaced, so "the transaction rolled back" is a statement
 * about MongoDB's guarantees, not about a simulation of them.
 */
function faultInjectingBundle(base: RepositoryBundle, target: 'payments'): RepositoryBundle {
  const armed = { armed: true };
  const child = (session: mongoose.ClientSession): RepositoryBundle => {
    const real = createMongoRepositories(session);
    return {
      ...real,
      payments: {
        ...real.payments,
        insert: async (transaction) => {
          if (target === 'payments' && armed.armed) {
            armed.armed = false;
            throw new Error('injected write failure (test)');
          }
          return real.payments.insert(transaction);
        },
      },
    };
  };

  if (!base.supportsTransactions) {
    throw new Error('the fault-injection bundle needs a transaction-capable datastore');
  }

  return {
    ...base,
    transact: async (work) => {
      const session = await mongoose.startSession();
      try {
        let result: unknown;
        await session.withTransaction(
          async () => {
            result = await work(child(session));
          },
          { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
        );
        return result as never;
      } finally {
        await session.endSession();
      }
    },
  };
}
