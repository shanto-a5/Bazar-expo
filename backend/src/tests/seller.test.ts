/**
 * Seller authorisation tests (M7-R).
 *
 * The seller surface has exactly one rule worth stating: every operation is scoped
 * to the seller resolved from the bearer token, and a resource belonging to another
 * seller must be indistinguishable from one that does not exist. These tests
 * attempt cross-seller access on every write and read path.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SEED, signIn, startHarness, type Envelope, type TestHarness } from './harness';
import type { ProductEntity } from '../domain/entities';
import type { SellerDashboard, InventorySummary } from '../services/seller.service';

describe('seller authorisation', () => {
  let harness: TestHarness;
  let sellerToken: string;
  let otherSellerToken: string;
  let customerToken: string;

  before(async () => {
    harness = await startHarness();
    sellerToken = await signIn(harness, SEED.sellerEmail);
    otherSellerToken = await signIn(harness, SEED.otherSellerEmail);
    customerToken = await signIn(harness, SEED.customerEmail);
  });
  after(async () => {
    await harness.close();
  });

  it('refuses the seller area without a token', async () => {
    assert.equal((await harness.request('/seller/profile')).status, 401);
  });

  it('refuses a customer account that is not a seller', async () => {
    const result = await harness.request<Envelope<unknown>>('/seller/profile', { token: customerToken });
    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, 'forbidden');
  });

  it('resolves the seller from the token, not from a body field', async () => {
    const result = await harness.request<Envelope<{ profile: { id: string; userId: string }; store: { id: string } }>>(
      '/seller/profile',
      { token: sellerToken, method: 'GET' },
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.data?.profile.id, 'sel_seed_1', 'seller 1 owns Brightloop');
    assert.equal(result.body.data?.profile.userId, 'usr_seed_seller_1');
    assert.equal(result.body.data?.store.id, 'sto_seed_1');
    assert.ok(!JSON.stringify(result.body).includes('VantaPass1!'), 'no credentials in the seller profile');
  });

  it('returns a dashboard scoped to the caller', async () => {
    const mine = await harness.request<Envelope<SellerDashboard>>('/seller/dashboard', { token: sellerToken });
    assert.equal(mine.body.data?.seller.id, 'sel_seed_1');
    assert.equal(mine.body.data?.productCount, 4);
    assert.equal(mine.body.data?.orderCount, 1, 'Brightloop has one seeded split');
    assert.ok((mine.body.data?.revenue ?? 0) > 0, 'delivered orders count towards revenue');

    const theirs = await harness.request<Envelope<SellerDashboard>>('/seller/dashboard', { token: otherSellerToken });
    assert.equal(theirs.body.data?.seller.id, 'sel_seed_2');
    assert.equal(theirs.body.data?.productCount, 4);
  });

  it('lists only the caller listings', async () => {
    const result = await harness.request<Envelope<{ products: ProductEntity[] }>>('/seller/products', { token: sellerToken });
    assert.equal(result.body.data?.products.length, 4);
    assert.ok(result.body.data?.products.every((product) => product.sellerId === 'sel_seed_1'));
  });

  it('lets a seller change the status of their own listing', async () => {
    const paused = await harness.request<Envelope<ProductEntity>>(`/seller/products/${SEED.productPausedStore}/status`, {
      method: 'PATCH',
      token: sellerToken,
      body: JSON.stringify({ status: 'paused' }),
    });
    assert.equal(paused.status, 200);
    assert.equal(paused.body.data?.status, 'paused');

    // A paused store is no longer customer-visible.
    const hidden = await harness.request<Envelope<unknown>>(`/catalog/products/${SEED.productPausedStore}`);
    assert.equal(hidden.status, 404);

    const restored = await harness.request<Envelope<ProductEntity>>(`/seller/products/${SEED.productPausedStore}/status`, {
      method: 'PATCH',
      token: sellerToken,
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(restored.body.data?.status, 'active');
  });

  it('refuses to change another seller listing, and hides that it exists', async () => {
    const result = await harness.request<Envelope<unknown>>(`/seller/products/${SEED.productActive}/status`, {
      method: 'PATCH',
      token: otherSellerToken,
      body: JSON.stringify({ status: 'paused' }),
    });
    assert.equal(result.status, 404);
    assert.equal(result.body.error?.code, 'not_found');

    const untouched = await harness.repos.products.findById(SEED.productActive);
    assert.equal(untouched?.status, 'active', 'the listing was not modified');
  });

  it('refuses to change a listing that does not exist', async () => {
    const result = await harness.request<Envelope<unknown>>('/seller/products/prd_nope/status', {
      method: 'PATCH',
      token: sellerToken,
      body: JSON.stringify({ status: 'active' }),
    });
    assert.equal(result.status, 404);
  });

  it('validates the requested status', async () => {
    const result = await harness.request<Envelope<unknown>>(`/seller/products/${SEED.productActive}/status`, {
      method: 'PATCH',
      token: sellerToken,
      body: JSON.stringify({ status: 'deleted' }),
    });
    assert.equal(result.status, 422);
  });

  it('adjusts stock with a ledger entry', async () => {
    const before = (await harness.repos.products.findById(SEED.productActive))!.stock;
    const result = await harness.request<Envelope<ProductEntity>>(`/seller/products/${SEED.productActive}/stock`, {
      method: 'POST',
      token: sellerToken,
      body: JSON.stringify({ quantity: 5, reason: 'restock' }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.data?.stock, before + 5);

    const ledger = await harness.request<Envelope<{ adjustments: { quantity: number; reason: string }[] }>>('/seller/inventory/adjustments', {
      token: sellerToken,
    });
    assert.ok(ledger.body.data?.adjustments.some((entry) => entry.quantity === 5 && entry.reason === 'restock'));
  });

  it('refuses a stock adjustment that would go negative', async () => {
    const negative = await harness.request<Envelope<unknown>>(`/seller/products/${SEED.productActive}/stock`, {
      method: 'POST',
      token: sellerToken,
      body: JSON.stringify({ quantity: -100000, reason: 'manual' }),
    });
    assert.equal(negative.status, 422);

    const zero = await harness.request<Envelope<unknown>>(`/seller/products/${SEED.productActive}/stock`, {
      method: 'POST',
      token: sellerToken,
      body: JSON.stringify({ quantity: 0, reason: 'manual' }),
    });
    assert.equal(zero.status, 422);
  });

  it('refuses a stock adjustment on another seller listing', async () => {
    const result = await harness.request<Envelope<unknown>>(`/seller/products/${SEED.productOtherSeller}/stock`, {
      method: 'POST',
      token: sellerToken,
      body: JSON.stringify({ quantity: 5, reason: 'manual' }),
    });
    assert.equal(result.status, 404);
  });

  it('summarises inventory with the shared stock levels', async () => {
    const result = await harness.request<Envelope<InventorySummary>>('/seller/inventory/summary', { token: sellerToken });
    assert.equal(result.body.data?.sellerId, 'sel_seed_1');
    assert.equal(result.body.data?.totalProducts, 4);
    assert.equal(result.body.data?.rows.length, 4);
    assert.equal(
      result.body.data?.outOfStock + result.body.data?.lowStock + result.body.data?.healthy,
      4,
      'every row is classified',
    );
  });

  it('lists only the caller order splits and hides another seller split', async () => {
    const mine = await harness.request<Envelope<{ orders: { id: string; sellerId: string }[] }>>('/seller/orders', { token: sellerToken });
    assert.ok((mine.body.data?.orders.length ?? 0) > 0);
    assert.ok(mine.body.data?.orders.every((order) => order.sellerId === 'sel_seed_1'));

    const theirs = await harness.request<Envelope<{ orders: { sellerId: string }[] }>>('/seller/orders', { token: otherSellerToken });
    assert.ok(theirs.body.data?.orders.every((order) => order.sellerId === 'sel_seed_2'));

    const foreign = await harness.request<Envelope<unknown>>(`/seller/orders/${mine.body.data!.orders[0].id}`, { token: otherSellerToken });
    assert.equal(foreign.status, 404, 'another seller cannot read the split');
  });

  it('advances fulfilment only for the caller own split', async () => {
    // The seeded split is already delivered, so place a fresh order to get a split
    // that still has somewhere to advance to.
    await harness.request('/cart/items', { method: 'POST', token: customerToken, body: JSON.stringify({ productId: SEED.productCheap, quantity: 1 }) });
    await harness.request('/orders', {
      method: 'POST',
      token: customerToken,
      body: JSON.stringify({ address: { ...SEED.address }, paymentMethod: 'cod' }),
    });

    const mine = await harness.request<Envelope<{ orders: { id: string; status: string }[] }>>('/seller/orders', { token: sellerToken });
    const split = mine.body.data!.orders.find((order) => order.status === 'new');
    assert.ok(split, 'the new order produced a pending split for the seller');

    const foreign = await harness.request<Envelope<unknown>>(`/seller/orders/${split.id}/advance`, {
      method: 'POST',
      token: otherSellerToken,
    });
    assert.equal(foreign.status, 404, 'another seller cannot advance this split');

    const advanced = await harness.request<Envelope<{ status: string }>>(`/seller/orders/${split.id}/advance`, {
      method: 'POST',
      token: sellerToken,
    });
    assert.equal(advanced.status, 200);
    assert.equal(advanced.body.data?.status, 'confirmed', 'the status moved one step along the flow');

    // A delivered split is terminal.
    const seeded = mine.body.data!.orders.find((order) => order.status === 'delivered')!;
    const terminal = await harness.request<Envelope<unknown>>(`/seller/orders/${seeded.id}/advance`, {
      method: 'POST',
      token: sellerToken,
    });
    assert.equal(terminal.status, 422);
  });

  it('describes the supported payment, delivery and media capabilities', async () => {
    const payments = await harness.request<Envelope<{ methods: { id: string }[]; note: string }>>('/meta/payment-methods');
    const ids = payments.body.data?.methods.map((method) => method.id);
    assert.ok(ids?.includes('cod'));
    assert.match(payments.body.data?.note ?? '', /simulated|settles with the courier/i);

    const delivery = await harness.request<Envelope<{ methods: { id: string }[] }>>('/meta/delivery-methods');
    assert.ok(delivery.body.data?.methods.some((method) => method.id === 'standard'));
    assert.ok(delivery.body.data?.methods.some((method) => method.id === 'express'));

    const media = await harness.request<Envelope<{ providers: { id: string }[] }>>('/meta/media-providers');
    assert.ok(media.body.data?.providers.length, 'media providers are described rather than hardcoded');
  });
});

/**
 * Seller onboarding (M7-R).
 *
 * Runs against a separate harness because it mutates the account's roles, and it
 * covers the three properties that matter: the role is granted *server-side*, a
 * second attempt does not overwrite an existing store, and an unaccepted term is
 * refused.
 */
describe('seller onboarding', () => {
  let harness: TestHarness;
  let token: string;

  before(async () => {
    harness = await startHarness();
    token = await signIn(harness, SEED.customerEmail);
  });
  after(async () => {
    await harness.close();
  });

  it('requires a signed-in customer', async () => {
    const result = await harness.request<Envelope<unknown>>('/seller/register', {
      method: 'POST',
      body: JSON.stringify(SEED.sellerRegistration),
    });
    assert.equal(result.status, 401);
  });

  it('creates the store and profile from the token, and withholds the role until approval', async () => {
    const result = await harness.request<Envelope<{ profile: { id: string; userId: string; status: string; storeId: string }; store: { id: string; sellerId: string; name: string; status: string } }>>(
      '/seller/register',
      { method: 'POST', token, body: JSON.stringify(SEED.sellerRegistration) },
    );
    assert.equal(result.status, 201);

    const profile = result.body.data!.profile;
    const store = result.body.data!.store;
    assert.equal(store.name, 'Ayesha Studio');
    assert.equal(store.id, profile.storeId, 'the store and profile are linked');
    assert.equal(store.sellerId, profile.id);
    assert.equal(profile.status, 'pending', 'a self-registered seller waits for review');
    assert.equal(store.status, 'pending', 'the store is not public before anyone has reviewed it');

    // M8 changed this deliberately: in M7 registration granted the role and the
    // seller area was closed by a separate status check, so the role and the
    // reviewable state could disagree. The role is now granted by the approver.
    const me = await harness.request<Envelope<{ user: { roles: string[] } }>>('/auth/me', { token });
    assert.equal(me.body.data?.user.roles.includes('seller'), false, 'the account does not carry the seller role yet');

    // A pending seller is refused by the seller area until an operator approves.
    const area = await harness.request<Envelope<unknown>>('/seller/profile', { token });
    assert.equal(area.status, 403, 'a pending seller cannot use the seller area yet');
  });

  it('refuses a second registration instead of overwriting the store', async () => {
    const again = await harness.request<Envelope<{ error?: { code: string } }>>('/seller/register', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...SEED.sellerRegistration, storeName: 'Hijacked Store' }),
    });
    assert.equal(again.status, 409);
    assert.equal(again.body.error?.code, 'conflict');
  });

  it('refuses an unaccepted term', async () => {
    const other = await signIn(harness, SEED.otherCustomerEmail);
    const result = await harness.request<Envelope<{ error?: { fields?: { field: string }[] } }>>('/seller/register', {
      method: 'POST',
      token: other,
      body: JSON.stringify({
        ...SEED.sellerRegistration,
        email: SEED.otherCustomerEmail,
        agreement: { ...SEED.sellerRegistration.agreement, productAuthenticity: false },
      }),
    });
    assert.equal(result.status, 422);
    assert.ok(
      result.body.error?.fields?.some((entry) => entry.field.includes('productAuthenticity')),
      'the rejected term is named in the field list',
    );
  });
});
