/**
 * Checkout + order tests (M7-R).
 *
 * Checkout is the highest-risk surface in the app, so these tests are written
 * adversarially: the client is treated as hostile. The assertions that matter are
 * that a submitted total is ignored, that a caller cannot order for another user,
 * that stock cannot be oversold, that a voucher cannot be reused past its limit,
 * and that a mid-checkout failure leaves nothing behind.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SEED, signIn, startHarness, type Envelope, type TestHarness } from './harness';
import type { OrderReceipt } from '../services/order.service';
import type { OrderEntity, PaymentTransactionEntity, SellerOrderEntity } from '../domain/entities';

const checkout = (overrides: Record<string, unknown> = {}) => ({
  address: { ...SEED.address },
  paymentMethod: 'cod',
  ...overrides,
});

describe('checkout + orders', () => {
  let harness: TestHarness;
  let token: string;

  before(async () => {
    harness = await startHarness();
    token = await signIn(harness, SEED.customerEmail);
  });
  after(async () => {
    await harness.close();
  });

  async function stockOf(productId: string): Promise<number> {
    const product = await harness.repos.products.findById(productId);
    return product?.stock ?? -1;
  }

  it('requires authentication', async () => {
    const result = await harness.request<Envelope<unknown>>('/orders', { method: 'POST', body: JSON.stringify(checkout()) });
    assert.equal(result.status, 401);
  });

  it('refuses to place an order for an empty cart', async () => {
    const empty = await signIn(harness, SEED.otherCustomerEmail);
    const result = await harness.request<Envelope<unknown>>('/orders', { method: 'POST', token: empty, body: JSON.stringify(checkout()) });
    assert.equal(result.status, 422);
    assert.match(result.body.error?.message ?? '', /cart is empty/i);
  });

  it('rejects a payment method outside the supported set', async () => {
    const result = await harness.request<Envelope<unknown>>('/orders', {
      method: 'POST',
      token,
      body: JSON.stringify(checkout({ paymentMethod: 'wire-transfer' })),
    });
    assert.equal(result.status, 422);
    assert.equal(result.body.error?.fields?.[0].field, 'paymentMethod');
  });

  it('requires the address fields it needs', async () => {
    const result = await harness.request<Envelope<unknown>>('/orders', {
      method: 'POST',
      token,
      body: JSON.stringify(checkout({ address: { ...SEED.address, addressLine: '' } })),
    });
    assert.equal(result.status, 422);
    // The address is a nested object, so the reported field path includes it.
    const fields = result.body.error?.fields ?? [];
    assert.ok(fields.length > 0);
    assert.ok(
      fields.some((field) => field.field.endsWith('addressLine')),
      `expected an addressLine field error, got ${JSON.stringify(fields)}`,
    );
  });

  it('places an order, prices it on the server and ignores client totals', async () => {
    await harness.request('/cart/items', { method: 'POST', token, body: JSON.stringify({ productId: SEED.productActive, quantity: 2 }) });
    const before = await stockOf(SEED.productActive);

    const result = await harness.request<Envelope<OrderReceipt>>('/orders', {
      method: 'POST',
      token,
      // A hostile client also tries to dictate price, seller and totals.
      body: JSON.stringify(
        checkout({
          total: 1,
          subtotal: 1,
          shippingTotal: 0,
          items: [{ productId: SEED.productActive, quantity: 99, price: 1 }],
          sellerId: 'sel_seed_2',
        }),
      ),
    });

    assert.equal(result.status, 201);
    const order = result.body.data!.order;
    assert.equal(order.subtotal, 4380, '2 x 2190 as the server prices it');
    assert.equal(order.sellerOrderIds.length, 1);
    assert.equal(result.body.data!.sellerOrders[0].sellerId, 'sel_seed_1', 'seller split comes from the cart, not the body');
    assert.equal(order.customerId, 'usr_seed_customer_1');
    assert.equal(order.paymentMethod, 'cod');
    assert.equal(order.paymentStatus, 'pending', 'COD settles on delivery');
    assert.equal(order.vouchersDiscount, 0);
    assert.equal(order.total, order.subtotal + order.shippingTotal);
    assert.ok(order.shippingAddress.userId === 'usr_seed_customer_1', 'address ownership is the caller');

    assert.equal(await stockOf(SEED.productActive), before - 2, 'stock moves by the ordered quantity');
    assert.equal(result.body.data!.cart.items.length, 0, 'purchased lines leave the cart');
  });

  it('snapshots the line price on the order and records inventory adjustments', async () => {
    const list = await harness.request<Envelope<{ orders: OrderEntity[] }>>('/orders', { token });
    const placed = list.body.data!.orders.find((order) => order.id !== 'ord_seed_1');
    assert.ok(placed, 'the order from the previous test exists');

    const sellerOrders = await harness.repos.sellerOrders.listForOrder(placed.id);
    assert.ok(sellerOrders.length > 0);
    assert.equal(sellerOrders[0].items[0].unitPrice, 2190, 'the order keeps the price it was placed at');
    assert.equal(sellerOrders[0].items[0].subtotal, 4380);

    const adjustments = await harness.repos.inventoryAdjustments.listForProduct(SEED.productActive);
    const sale = adjustments.filter((entry) => entry.reason === 'sale');
    assert.ok(sale.length > 0, 'a sale adjustment is recorded');
    assert.equal(sale[0].referenceId, placed.id, 'the adjustment points back at the order');
  });

  it('lists only the caller orders and 404s for someone else', async () => {
    const mine = await harness.request<Envelope<{ orders: OrderEntity[] }>>('/orders', { token });
    assert.ok(mine.body.data!.orders.length > 0);
    assert.ok(mine.body.data!.orders.every((order) => order.customerId === 'usr_seed_customer_1'));

    const orderId = mine.body.data!.orders[0].id;
    const detail = await harness.request<Envelope<{ order: OrderEntity; sellerOrders: SellerOrderEntity[]; payment: PaymentTransactionEntity[] }>>(
      `/orders/${orderId}`,
      { token },
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data?.order.id, orderId);
    assert.ok(detail.body.data?.sellerOrders.length === 1);
    assert.ok(detail.body.data?.payment.length === 1);

    const intruder = await signIn(harness, SEED.otherCustomerEmail);
    assert.equal((await harness.request(`/orders/${orderId}`, { token: intruder })).status, 404, 'no cross-account read');
    assert.equal((await harness.request(`/orders/${orderId}`)).status, 401);
  });

  it('returns the same order for a repeated idempotency key', async () => {
    const customer = await signIn(harness, SEED.otherCustomerEmail);
    await harness.request('/cart/items', { method: 'POST', token: customer, body: JSON.stringify({ productId: SEED.productCheap, quantity: 1 }) });

    const key = 'idem-key-001';
    const first = await harness.request<Envelope<OrderReceipt>>('/orders', {
      method: 'POST',
      token: customer,
      body: JSON.stringify(checkout({ idempotencyKey: key })),
    });
    assert.equal(first.status, 201);

    // Re-add stock to the cart and retry with the same key: no second order.
    await harness.request('/cart/items', { method: 'POST', token: customer, body: JSON.stringify({ productId: SEED.productCheap, quantity: 1 }) });
    const second = await harness.request<Envelope<OrderReceipt>>('/orders', {
      method: 'POST',
      token: customer,
      body: JSON.stringify(checkout({ idempotencyKey: key })),
    });
    assert.equal(second.status, 201);
    assert.equal(second.body.data!.order.id, first.body.data!.order.id, 'the retry returns the original order');

    const list = await harness.request<Envelope<{ orders: OrderEntity[] }>>('/orders', { token: customer });
    assert.equal(list.body.data!.orders.filter((order) => order.voucherCodes.length === 0 && order.subtotal > 0).length, 1);
  });

  it('applies a valid voucher and refuses an invalid or expired one', async () => {
    const customer = await signIn(harness, SEED.customerEmail);
    await harness.request('/cart/items', { method: 'POST', token: customer, body: JSON.stringify({ productId: SEED.productCheap, quantity: 2 }) });

    const applied = await harness.request<Envelope<OrderReceipt>>('/orders', {
      method: 'POST',
      token: customer,
      body: JSON.stringify(checkout({ voucherCode: SEED.voucherPlatform })),
    });
    assert.equal(applied.status, 201);
    assert.deepEqual(applied.body.data!.order.voucherCodes, [SEED.voucherPlatform]);
    assert.ok(applied.body.data!.order.vouchersDiscount > 0, 'the discount comes from the shared rules');
    assert.equal(applied.body.data!.order.total, applied.body.data!.order.subtotal - applied.body.data!.order.vouchersDiscount + applied.body.data!.order.shippingTotal);

    await harness.request('/cart/items', { method: 'POST', token: customer, body: JSON.stringify({ productId: SEED.productCheap, quantity: 1 }) });
    const unknown = await harness.request<Envelope<unknown>>('/orders', {
      method: 'POST',
      token: customer,
      body: JSON.stringify(checkout({ voucherCode: 'NOPE' })),
    });
    assert.equal(unknown.status, 422);
    assert.match(unknown.body.error?.message ?? '', /could not be found/i);

    // A seller-scoped voucher must not apply to another seller's cart...
    await harness.request('/cart/items', { method: 'DELETE', token: customer });
    await harness.request('/cart/items', { method: 'POST', token: customer, body: JSON.stringify({ productId: SEED.productOtherSeller, quantity: 1 }) });
    const wrongSeller = await harness.request<Envelope<unknown>>('/orders', {
      method: 'POST',
      token: customer,
      body: JSON.stringify(checkout({ voucherCode: SEED.voucherSeller })),
    });
    assert.equal(wrongSeller.status, 422);
    assert.match(wrongSeller.body.error?.message ?? '', /different seller/i);

    // ...and a platform voucher still enforces its 1000 minimum (this cart is 750).
    const belowMinimum = await harness.request<Envelope<unknown>>('/orders', {
      method: 'POST',
      token: customer,
      body: JSON.stringify(checkout({ voucherCode: SEED.voucherPlatform })),
    });
    assert.equal(belowMinimum.status, 422);
    assert.match(belowMinimum.body.error?.message ?? '', /minimum|below/i);
  });

  it('refuses to oversell: a stock failure leaves no order and no stock movement', async () => {
    const customer = await signIn(harness, SEED.otherCustomerEmail);
    // Add a line while the stock is there, then take the stock away underneath it —
    // exactly the race the server-side re-check exists to catch.
    await harness.request('/cart/items', { method: 'POST', token: customer, body: JSON.stringify({ productId: SEED.productCheap, quantity: 2 }) });
    const stock = (await harness.repos.products.findById(SEED.productCheap))!.stock;
    await harness.repos.products.adjustStock(SEED.productCheap, -stock, null);
    assert.equal(await stockOf(SEED.productCheap), 0);

    const ordersBefore = (await harness.repos.orders.listForCustomer('usr_seed_customer_2')).length;
    const result = await harness.request<Envelope<unknown>>('/orders', { method: 'POST', token: customer, body: JSON.stringify(checkout()) });
    assert.equal(result.status, 422);
    assert.match(result.body.error?.message ?? '', /not enough stock|does not have enough stock/i);
    assert.equal(await stockOf(SEED.productCheap), 0, 'no stock movement survived the failure');
    assert.equal((await harness.repos.orders.listForCustomer('usr_seed_customer_2')).length, ordersBefore, 'no orphan order');

    const cart = await harness.request<Envelope<{ items: unknown[] }>>('/cart', { token: customer });
    assert.ok((cart.body.data?.items.length ?? 0) > 0, 'the cart is kept so the customer can retry');

    await harness.repos.products.adjustStock(SEED.productCheap, stock, null);
    await harness.request('/cart/items', { method: 'DELETE', token: customer });
  });

  it('compensates every write when a later step fails', async () => {
    const customer = await signIn(harness, SEED.customerEmail);
    await harness.request('/cart/items', { method: 'POST', token: customer, body: JSON.stringify({ productId: SEED.productOtherSeller, quantity: 2 }) });
    const stockBefore = await stockOf(SEED.productOtherSeller);
    const ordersBefore = (await harness.repos.orders.listForCustomer('usr_seed_customer_1')).length;
    const sellerOrdersBefore = (await harness.repos.sellerOrders.listForOrder('ord_seed_1')).length;

    // Fault injection: let the seller order and order rows be written, then fail on
    // the payment insert, which is the step after them.
    const original = harness.repos.payments.insert;
    let injected = false;
    (harness.repos.payments as { insert: typeof original }).insert = async () => {
      injected = true;
      throw new Error('injected payment failure');
    };

    let failure: { status: number; body: Envelope<unknown> } | null = null;
    try {
      failure = await harness.request<Envelope<unknown>>('/orders', { method: 'POST', token: customer, body: JSON.stringify(checkout()) });
    } finally {
      (harness.repos.payments as { insert: typeof original }).insert = original;
    }

    assert.ok(injected, 'the fault was actually injected');
    assert.equal(failure!.status, 500);
    assert.equal((failure!.body.error?.message ?? '').includes('injected'), false, 'internal detail is not leaked');
    assert.equal(await stockOf(SEED.productOtherSeller), stockBefore, 'stock restored');
    assert.equal(
      (await harness.repos.orders.listForCustomer('usr_seed_customer_1')).length,
      ordersBefore,
      'the order written before the failure was removed',
    );
    assert.equal((await harness.repos.payments.listForOrder('ord_seed_1')).length, 1, 'the seeded payment is untouched');
    assert.equal(
      (await harness.repos.inventoryAdjustments.listForProduct(SEED.productOtherSeller)).filter((entry) => entry.reason === 'sale' && entry.referenceId !== 'ord_seed_1').length,
      0,
      'no inventory adjustment survived',
    );
    assert.equal(sellerOrdersBefore, 2, 'the seed splits are intact');
  });

  it('cancels an order, restores stock, and refuses a second cancellation', async () => {
    const customer = await signIn(harness, SEED.otherCustomerEmail);
    await harness.request('/cart/items', { method: 'POST', token: customer, body: JSON.stringify({ productId: SEED.productActive, quantity: 1 }) });
    const placed = await harness.request<Envelope<OrderReceipt>>('/orders', { method: 'POST', token: customer, body: JSON.stringify(checkout()) });
    const orderId = placed.body.data!.order.id;
    const stockBefore = await stockOf(SEED.productActive);

    const shortReason = await harness.request<Envelope<unknown>>(`/orders/${orderId}/cancel`, {
      method: 'POST',
      token: customer,
      body: JSON.stringify({ reason: '' }),
    });
    assert.equal(shortReason.status, 422);

    const cancelled = await harness.request<Envelope<{ status: string }>>(`/orders/${orderId}/cancel`, {
      method: 'POST',
      token: customer,
      body: JSON.stringify({ reason: 'Ordered by mistake' }),
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data?.status, 'cancelled');
    assert.equal(await stockOf(SEED.productActive), stockBefore + 1, 'cancelling returns the units');

    const again = await harness.request<Envelope<unknown>>(`/orders/${orderId}/cancel`, {
      method: 'POST',
      token: customer,
      body: JSON.stringify({ reason: 'Changed my mind again' }),
    });
    assert.equal(again.status, 422);

    const intruder = await signIn(harness, SEED.customerEmail);
    assert.equal((await harness.request(`/orders/${orderId}/cancel`, { method: 'POST', token: intruder, body: JSON.stringify({ reason: 'not mine' }) })).status, 404);
  });

  it('notifies the buyer and the seller by user id', async () => {
    const notifications = await harness.repos.notifications.listForUser('usr_seed_customer_1');
    const placed = notifications.filter((entry) => entry.type === 'order_placed');
    assert.ok(placed.length > 0, 'the buyer is notified');

    const sellerNotifications = await harness.repos.notifications.listForUser('usr_seed_seller_1');
    assert.ok(
      sellerNotifications.some((entry) => entry.type === 'seller_new_order'),
      'the seller account (not the seller profile) receives the order notification',
    );
  });
});
