/**
 * Seed tests (M7-O).
 *
 * A seed that is not idempotent is a data-corruption tool: running it twice must
 * not duplicate a product, must not re-hash a password, and must not leave a
 * relationship dangling. These tests run the seed repeatedly against the same
 * bundle and compare the resulting state.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSeed } from '../seed/seed';
import { createMemoryRepositories } from '../repositories/memory/memory-repositories';
import { signInWith } from './helpers';

describe('seed', () => {
  const allProducts = (repos: ReturnType<typeof createMemoryRepositories>) => repos.products.query({ limit: 1000 });
  const allReviews = (repos: ReturnType<typeof createMemoryRepositories>) => repos.reviews.listForUser('usr_seed_customer_1');

  it('reports what it wrote on a fresh bundle', async () => {
    const repos = createMemoryRepositories();
    const summary = await runSeed(repos);

    assert.equal(summary.products, 8);
    assert.equal(summary.sellers, 2);
    assert.equal(summary.stores, 2);
    assert.equal(summary.vouchers, 3);
    assert.equal(summary.orders, 1);
    assert.equal(summary.created > 0, true);
    assert.equal(summary.skipped, 0, 'nothing exists yet on a fresh bundle');

    assert.equal((await allProducts(repos)).length, 8);
    assert.equal((await repos.users.list()).length, 5);
    assert.equal((await repos.categories.list()).length, 4);
  });

  it('seeds exactly one account that can read the approval queue', async () => {
    const repos = createMemoryRepositories();
    await runSeed(repos);
    const users = await repos.users.list();
    const approvers = users.filter((user) => user.roles.includes('seller_approver'));
    assert.equal(approvers.length, 1, 'a single seeded approver keeps the gate reviewable');
    // An approver must not also be a seller: approval is a staff action, and a
    // seller/approver account would make the gate untestable via registration.
    assert.equal(approvers[0].roles.includes('seller'), false);
    assert.equal((await repos.sellers.list()).length, 2, 'the approver has no seller profile');
  });

  it('is a no-op when run again', async () => {
    const repos = createMemoryRepositories();
    await runSeed(repos);
    const second = await runSeed(repos);

    assert.equal(second.created, 0, 'nothing new is written');
    assert.ok(second.skipped > 0, 'every existing document was skipped');

    assert.equal((await allProducts(repos)).length, 8);
    assert.equal((await repos.users.list()).length, 5);
    assert.equal((await repos.categories.list()).length, 4);
    assert.equal((await repos.vouchers.list()).length, 3);
    assert.equal((await allReviews(repos)).length, 3);
  });

  it('produces the same dataset from scratch twice over', async () => {
    const first = createMemoryRepositories();
    const second = createMemoryRepositories();
    await runSeed(first);
    await runSeed(second);

    const strip = (rows: { id: string; createdAt: string; updatedAt: string }[]) =>
      JSON.stringify(rows.map(({ id, createdAt, updatedAt }) => ({ id, createdAt, updatedAt })).sort((a, b) => a.id.localeCompare(b.id)));

    assert.equal(strip(await allProducts(first)), strip(await allProducts(second)), 'products are reproducible');
    assert.equal(strip(await first.users.list()), strip(await second.users.list()), 'users are reproducible');
    assert.equal(strip(await first.vouchers.list()), strip(await second.vouchers.list()), 'vouchers are reproducible');
  });

  it('does not re-hash a password on a second run', async () => {
    const repos = createMemoryRepositories();
    await runSeed(repos);
    const before = await repos.users.findByEmail('ayesha@vanta.test');
    await runSeed(repos);
    const after = await repos.users.findByEmail('ayesha@vanta.test');

    assert.equal(before?.passwordHash, after?.passwordHash, 'the stored hash is untouched');
    assert.ok(before?.passwordHash.startsWith('$2'), 'it is a real bcrypt hash');
    assert.equal(await signInWith(repos, 'ayesha@vanta.test', 'VantaPass1!'), true);
  });

  it('leaves no dangling relationship', async () => {
    const repos = createMemoryRepositories();
    await runSeed(repos);

    const products = await allProducts(repos);
    const productIds = new Set(products.map((product) => product.id));
    const sellerIds = new Set((await repos.sellers.list()).map((seller) => seller.id));
    const userIds = new Set((await repos.users.list()).map((user) => user.id));
    const storeIds = new Set((await repos.stores.list()).map((store) => store.id));

    for (const product of products) {
      assert.ok(sellerIds.has(product.sellerId), `product ${product.id} points at a real seller`);
      assert.ok(storeIds.has(product.storeId), `product ${product.id} points at a real store`);
    }
    for (const seller of await repos.sellers.list()) {
      assert.ok(userIds.has(seller.userId), `seller ${seller.id} points at a real user`);
      assert.ok(storeIds.has(seller.storeId), `seller ${seller.id} points at a real store`);
    }
    for (const user of await repos.users.list()) {
      for (const address of await repos.addresses.listForUser(user.id)) {
        assert.ok(userIds.has(address.userId), `address ${address.id} points at a real user`);
      }
    }

    const orders = [
      ...(await repos.orders.listForCustomer('usr_seed_customer_1')),
      ...(await repos.orders.listForCustomer('usr_seed_customer_2')),
    ];
    assert.equal(orders.length, 1);
    for (const order of orders) {
      assert.ok(userIds.has(order.customerId), `order ${order.id} points at a real customer`);
      const splits = await repos.sellerOrders.listForOrder(order.id);
      assert.equal(order.sellerOrderIds.length, splits.length, `order ${order.id} lists exactly its splits`);
      for (const splitId of order.sellerOrderIds) {
        assert.ok(await repos.sellerOrders.findById(splitId), `order ${order.id} split ${splitId} exists`);
      }
      for (const split of splits) {
        assert.equal(split.orderId, order.id);
        assert.ok(sellerIds.has(split.sellerId));
        for (const item of split.items) {
          assert.ok(productIds.has(item.productId), `split item ${item.id} points at a real product`);
        }
      }
    }

    for (const review of await allReviews(repos)) {
      assert.ok(productIds.has(review.productId), `review ${review.id} points at a real product`);
      assert.ok(userIds.has(review.userId), `review ${review.id} points at a real user`);
    }
  });

  it('seeds vouchers that are actually usable today', async () => {
    const repos = createMemoryRepositories();
    await runSeed(repos);
    const now = Date.now();
    for (const voucher of await repos.vouchers.list()) {
      assert.ok(voucher.active, `${voucher.code} is active`);
      assert.ok(Date.parse(voucher.startAt) <= now, `${voucher.code} has started`);
      assert.ok(Date.parse(voucher.expiry) > now, `${voucher.code} has not expired`);
      assert.ok(voucher.usageCount === 0, `${voucher.code} is unused`);
    }
  });

  it('keeps the seeded order internally consistent with the shared pricing rules', async () => {
    const repos = createMemoryRepositories();
    await runSeed(repos);
    const order = await repos.orders.findById('ord_seed_1');
    assert.ok(order);

    const splitSubtotal = (await repos.sellerOrders.listForOrder(order.id)).reduce((sum, split) => sum + split.subtotal, 0);
    assert.equal(order.subtotal, splitSubtotal, 'the order subtotal is the sum of the seller splits');
    assert.equal(
      order.total,
      Math.round((order.subtotal + order.shippingTotal - order.vouchersDiscount) * 100) / 100,
      'the total is subtotal + shipping - discount',
    );
    assert.equal(order.status, 'delivered');
  });
});
