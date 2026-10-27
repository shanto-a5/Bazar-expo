/**
 * Catalog + cart tests (M7-R).
 *
 * The point of these is that the API's answers come from the same shared rules the
 * device uses: hidden listings stay hidden, prices are the effective price, stock is
 * enforced at the boundary, and a cart is priced by the server rather than trusted.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SEED, signIn, startHarness, type Envelope, type TestHarness } from './harness';
import type { PricedCart } from '../services/cart.service';

interface ProductList {
  items: { id: string; name: string; status: string; salePrice?: number; regularPrice: number }[];
  total: number;
  page: number;
  pageSize: number;
}

describe('catalog + cart', () => {
  let harness: TestHarness;
  let token: string;

  before(async () => {
    harness = await startHarness();
    token = await signIn(harness, SEED.customerEmail);
  });
  after(async () => {
    await harness.close();
  });

  it('lists only active products by default', async () => {
    const result = await harness.request<Envelope<ProductList>>('/catalog/products');
    assert.equal(result.status, 200);
    assert.ok(result.body.data);
    const statuses = new Set(result.body.data.items.map((item) => item.status));
    assert.deepEqual([...statuses], ['active'], 'non-active listings must not be listed');
    assert.ok(!result.body.data.items.some((item) => item.id === SEED.productOutOfStock));
  });

  it('paginates and validates the page bounds', async () => {
    const first = await harness.request<Envelope<ProductList>>('/catalog/products?page=1&pageSize=2');
    assert.equal(first.body.data?.items.length, 2);
    assert.equal(first.body.data?.total, 7, '7 active products in the seed');
    assert.equal(first.body.data?.page, 1);

    const capped = await harness.request<Envelope<ProductList>>('/catalog/products?pageSize=9999');
    assert.ok((capped.body.data?.pageSize ?? 0) <= 60, 'pageSize is clamped');

    const invalid = await harness.request<Envelope<unknown>>('/catalog/products?pageSize=0');
    assert.equal(invalid.status, 422);
  });

  it('searches by name and filters by category', async () => {
    const search = await harness.request<Envelope<ProductList>>('/catalog/products?search=earbuds');
    assert.equal(search.body.data?.items.length, 1);
    assert.equal(search.body.data?.items[0].id, SEED.productActive);

    const category = await harness.request<Envelope<ProductList>>('/catalog/products?categoryId=cat_seed_apparel');
    assert.equal(category.body.data?.items.length, 2);
  });

  it('returns the effective price for a detail lookup', async () => {
    const result = await harness.request<Envelope<{ effectivePrice: number; availableStock: number; visible: boolean }>>(
      `/catalog/products/${SEED.productActive}`,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.data?.effectivePrice, 2190, 'sale price wins over regular');
    assert.equal(result.body.data?.visible, true);
    assert.equal(result.body.data?.availableStock, 40);
  });

  it('hides an out-of-stock listing behind 404 for customers', async () => {
    const result = await harness.request<Envelope<unknown>>(`/catalog/products/${SEED.productOutOfStock}`);
    assert.equal(result.status, 404);
  });

  it('resolves a store by both store id and seller id', async () => {
    const byStore = await harness.request<Envelope<{ name: string; productCount: number }>>('/catalog/stores/sto_seed_1');
    const bySeller = await harness.request<Envelope<{ name: string; productCount: number }>>('/catalog/stores/sel_seed_1');
    assert.equal(byStore.status, 200);
    assert.equal(byStore.body.data?.name, bySeller.body.data?.name);
    assert.equal(byStore.body.data?.productCount, 4);

    assert.equal((await harness.request('/catalog/stores/sto_missing')).status, 404);
  });

  it('returns catalog and store summaries', async () => {
    const summary = await harness.request<Envelope<{ productCount: number; activeCount: number; storeCount: number }>>('/catalog/summary');
    assert.equal(summary.body.data?.productCount, 8);
    assert.equal(summary.body.data?.activeCount, 7);
    assert.equal(summary.body.data?.storeCount, 2);
  });

  it('requires a token for the cart', async () => {
    assert.equal((await harness.request('/cart')).status, 401);
  });

  it('adds an item and prices it with the shared rules', async () => {
    const result = await harness.request<Envelope<PricedCart>>('/cart/items', {
      method: 'POST',
      token,
      body: JSON.stringify({ productId: SEED.productActive, quantity: 2 }),
    });
    // Adding a line mutates the cart resource and returns the new priced view;
    // it does not create a new addressable resource, so 200 is the honest status.
    assert.equal(result.status, 200);
    const line = result.body.data?.items.find((item) => item.productId === SEED.productActive);
    assert.equal(line?.unitPrice, 2190);
    assert.equal(line?.subtotal, 4380);
    assert.equal(line?.available, true);
    assert.equal(result.body.data?.subtotal, 4380);
  });

  it('merges a repeat add into the existing line and still respects stock', async () => {
    await harness.request('/cart/items', { method: 'POST', token, body: JSON.stringify({ productId: SEED.productActive, quantity: 1 }) });
    const merged = await harness.request<Envelope<PricedCart>>('/cart/items', {
      method: 'POST',
      token,
      body: JSON.stringify({ productId: SEED.productActive, quantity: 1 }),
    });
    const count = merged.body.data?.items.filter((item) => item.productId === SEED.productActive).length;
    assert.equal(count, 1, 'same product collapses into one line');
    const line = merged.body.data?.items.find((item) => item.productId === SEED.productActive);
    assert.equal(line?.quantity, 4);

    const overflow = await harness.request<Envelope<unknown>>('/cart/items', {
      method: 'POST',
      token,
      body: JSON.stringify({ productId: SEED.productActive, quantity: 999 }),
    });
    assert.equal(overflow.status, 422, 'stock is enforced server-side');
  });

  it('refuses an out-of-stock or unknown product', async () => {
    const outOfStock = await harness.request<Envelope<unknown>>('/cart/items', {
      method: 'POST',
      token,
      body: JSON.stringify({ productId: SEED.productOutOfStock }),
    });
    assert.equal(outOfStock.status, 422);

    const missing = await harness.request<Envelope<unknown>>('/cart/items', {
      method: 'POST',
      token,
      body: JSON.stringify({ productId: 'prd_does_not_exist' }),
    });
    assert.equal(missing.status, 404);
  });

  it('groups lines per seller with per-seller shipping', async () => {
    await harness.request('/cart/items', { method: 'POST', token, body: JSON.stringify({ productId: SEED.productOtherSeller, quantity: 1 }) });
    const cart = await harness.request<Envelope<PricedCart>>('/cart', { token });
    assert.equal(cart.body.data?.groups.length, 2);
    const urbanfold = cart.body.data?.groups.find((group) => group.storeName === 'Urbanfold');
    assert.equal(urbanfold?.shippingFee, 90, 'under the 2000 threshold means a 90 fee');
    assert.equal(urbanfold?.freeShipping, false);
  });

  it('quotes vouchers and delivery without applying them until checkout', async () => {
    const cart = await harness.request<Envelope<PricedCart>>('/cart', { token });
    const codes = cart.body.data?.vouchers.map((quote) => quote.voucher.code);
    assert.ok(codes?.includes(SEED.voucherPlatform));
    assert.equal(cart.body.data?.voucherDiscount, 0, 'the cart view reports, the order applies');
    assert.equal(cart.body.data?.selectedVoucherCode, null);

    const express = await harness.request<Envelope<PricedCart>>('/cart?deliveryMethod=express', { token });
    assert.ok((express.body.data?.delivery.fee ?? 0) >= (cart.body.data?.delivery.fee ?? 0));
  });

  it('patches quantity and selection, then removes and clears', async () => {
    const cart = await harness.request<Envelope<PricedCart>>('/cart', { token });
    const item = cart.body.data!.items.find((entry) => entry.productId === SEED.productActive)!;

    const patched = await harness.request<Envelope<PricedCart>>(`/cart/items/${item.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ quantity: 3 }),
    });
    assert.equal(patched.body.data?.items.find((entry) => entry.id === item.id)?.quantity, 3);

    const deselected = await harness.request<Envelope<PricedCart>>(`/cart/items/${item.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ selected: false }),
    });
    const afterDeselect = deselected.body.data?.items.find((entry) => entry.id === item.id);
    assert.equal(afterDeselect?.selected, false);
    // The other seller's line is still selected, so the count drops by exactly one.
    assert.equal(deselected.body.data?.itemCount, 1);

    const tooMany = await harness.request<Envelope<unknown>>(`/cart/items/${item.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ quantity: 100000 }),
    });
    assert.equal(tooMany.status, 422);

    await harness.request(`/cart/items/${item.id}`, { method: 'PATCH', token, body: JSON.stringify({ selected: true }) });
    const removed = await harness.request<Envelope<PricedCart>>(`/cart/items/${item.id}`, { method: 'DELETE', token });
    assert.ok(!removed.body.data?.items.some((entry) => entry.id === item.id));

    const cleared = await harness.request<Envelope<PricedCart>>('/cart/items', { method: 'DELETE', token });
    assert.equal(cleared.body.data?.items.length, 0);

    assert.equal((await harness.request(`/cart/items/${item.id}`, { method: 'DELETE', token })).status, 404);
  });

  it('keeps each customer cart separate', async () => {
    const other = await signIn(harness, SEED.otherCustomerEmail);
    const cart = await harness.request<Envelope<PricedCart>>('/cart', { token: other });
    assert.equal(cart.body.data?.items.length, 0, 'a new session starts from an empty cart');
  });
});
