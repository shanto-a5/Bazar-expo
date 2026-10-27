/**
 * M10 money + order-state regression tests.
 *
 * Every case here is a defect that was actually present and is now fixed. They all
 * exercise the `shared/` money and status core, because that is the code BOTH the
 * app and the API run, so a regression here shows up as a checkout that charges
 * different money from the quote the customer saw.
 *
 * Defects covered:
 *   - a returned line masked a sibling seller order that was still in flight, so the
 *     order never reached `delivered` and its COD never settled
 *   - a seller-scoped `free_shipping` voucher waived the whole cart's delivery
 *   - `voucherAppliedValue` restated the rules and drifted from the authoritative
 *     `computeVoucherDiscount`
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allPartsDelivered, deriveOrderStatus } from '../../../shared/order-status';
import { computeCartTotals, computeVoucherDiscount } from '../../../shared/pricing';
import { voucherAppliedValue } from '../../../shared/voucher-rules';
import type { SharedSellerGroup, SharedSellerOrderStatus, SharedVoucher } from '../../../shared/types';

function part(status: string): SharedSellerOrderStatus {
  return { id: `so_${status}_${Math.random().toString(36).slice(2)}`, status } as SharedSellerOrderStatus;
}

function voucher(overrides: Partial<SharedVoucher> = {}): SharedVoucher {
  return {
    id: 'vch_1',
    code: 'FREESHIP',
    type: 'free_shipping',
    discountValue: 0,
    scope: 'platform',
    sellerId: null,
    minimumOrder: 0,
    startAt: '2026-01-01T00:00:00.000Z',
    expiry: '2026-12-31T00:00:00.000Z',
    usageCount: 0,
    perUserUsed: {},
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as SharedVoucher;
}

function group(sellerId: string, subtotal: number, shippingFee: number): SharedSellerGroup {
  return { sellerId, subtotal, shippingFee, freeShipping: shippingFee === 0 };
}

describe('M10 order status roll-up', () => {
  it('does not let a returned line mask a sibling that is still in flight', () => {
    // Seller A returned their line; seller B is still on the van. The order is NOT
    // delivered, so COD settlement must not fire, and the status must report the
    // bottleneck (shipped) rather than jumping to `returned`.
    const status = deriveOrderStatus([part('returned'), part('shipped')]);
    assert.equal(status, 'shipped', 'an in-flight sibling must outrank a closed return');
  });

  it('does not let an open return mask a sibling that is still in flight', () => {
    assert.equal(deriveOrderStatus([part('return_requested'), part('packed')]), 'packed');
  });

  it('still reports delivered when every live part is delivered', () => {
    assert.equal(deriveOrderStatus([part('delivered'), part('delivered')]), 'delivered');
    assert.equal(deriveOrderStatus([part('delivered')]), 'delivered');
  });

  it('reaches delivered only after the in-flight sibling finishes, so COD settles', () => {
    // Settlement is keyed off `allPartsDelivered`, not the rolled-up status. The
    // first line was returned, so once nothing is in flight the roll-up settles on
    // `returned` and can never itself read `delivered`. COD must still settle when
    // the remaining line actually lands.
    const parts = [part('returned'), part('shipped')];
    assert.equal(deriveOrderStatus(parts), 'shipped', 'the in-flight sibling owns the roll-up');
    assert.equal(allPartsDelivered(parts), false, 'must not settle while one part ships');
    parts[1] = part('delivered');
    assert.equal(deriveOrderStatus(parts), 'returned', 'the return owns the roll-up once nothing ships');
    assert.equal(allPartsDelivered(parts), true, 'COD settles once the last part lands');
  });

  it('treats a returned part as having physically arrived', () => {
    assert.equal(allPartsDelivered([part('returned')]), true, 'a return implies it was delivered first');
    assert.equal(allPartsDelivered([part('refunded')]), true);
    assert.equal(allPartsDelivered([part('delivered'), part('return_approved')]), true);
  });

  it('does not settle a cancelled or undelivered order', () => {
    assert.equal(allPartsDelivered([part('cancelled')]), false);
    assert.equal(allPartsDelivered([part('cancelled'), part('cancelled')]), false);
    assert.equal(allPartsDelivered([part('confirmed')]), false);
    assert.equal(allPartsDelivered([]), false);
  });

  it('settles when the only live part is delivered and the rest were cancelled', () => {
    assert.equal(allPartsDelivered([part('delivered'), part('cancelled')]), true);
  });

  it('rolls a fresh not-yet-started part up to placed', () => {
    assert.equal(deriveOrderStatus([part('new')]), 'placed');
    assert.equal(deriveOrderStatus([part('new'), part('delivered')]), 'placed');
  });

  it('surfaces the most advanced return once nothing is in flight', () => {
    assert.equal(deriveOrderStatus([part('delivered'), part('return_approved')]), 'return_approved');
    assert.equal(deriveOrderStatus([part('returned')]), 'returned');
  });

  it('reports cancelled when every part is cancelled', () => {
    assert.equal(deriveOrderStatus([part('cancelled'), part('cancelled')]), 'cancelled');
    assert.equal(deriveOrderStatus([]), 'placed');
  });
});

describe('M10 seller-scoped free shipping', () => {
  const cart = [group('sel_a', 1000, 60), group('sel_b', 1000, 40)];

  it('waives only the issuing seller delivery for a seller-scoped voucher', () => {
    const discount = computeVoucherDiscount(
      voucher({ scope: 'seller', sellerId: 'sel_a' }),
      cart,
      2000,
      100,
    );
    assert.equal(discount, 60, "seller A's 60 delivery only; seller B keeps its 40");
  });

  it('is 0 when the issuing seller has no delivery fee in the cart', () => {
    const discount = computeVoucherDiscount(
      voucher({ scope: 'seller', sellerId: 'sel_c' }),
      cart,
      2000,
      100,
    );
    assert.equal(discount, 0);
  });

  it('still waives every delivery for a platform-scoped voucher', () => {
    assert.equal(computeVoucherDiscount(voucher(), cart, 2000, 100), 100);
  });

  it('keeps the charged total consistent with the seller-scoped waiver', () => {
    const scoped = voucher({ scope: 'seller', sellerId: 'sel_a' });
    const totals = computeCartTotals(cart, scoped, 4);
    assert.equal(totals.voucherDiscount, 60);
    assert.equal(totals.grandTotal, 2000 + 100 - 60, 'subtotal + shipping - only seller A delivery');
  });

  it('never books a shipping waiver against the item subtotal', () => {
    const totals = computeCartTotals(cart, voucher(), 4);
    assert.equal(totals.subtotal, 2000, 'free shipping must not touch the item subtotal');
    assert.equal(totals.grandTotal, 2000);
  });
});

describe('M10 voucher rule single source of truth', () => {
  const cart = [group('sel_a', 1000, 60), group('sel_b', 1000, 40)];

  it('agrees with the pricing core on every voucher type', () => {
    const cases: SharedVoucher[] = [
      voucher(),
      voucher({ scope: 'seller', sellerId: 'sel_a' }),
      voucher({ type: 'percentage', discountValue: 10 }),
      voucher({ type: 'percentage', discountValue: 10, scope: 'seller', sellerId: 'sel_b' }),
      voucher({ type: 'fixed', discountValue: 250 }),
      voucher({ type: 'fixed', discountValue: 250, scope: 'seller', sellerId: 'sel_a' }),
    ];
    for (const v of cases) {
      assert.equal(
        voucherAppliedValue(v, cart, 2000, 100),
        computeVoucherDiscount(v, cart, 2000, 100),
        `${v.type}/${v.scope ?? 'platform'} must not drift between the two entry points`,
      );
    }
  });
});
