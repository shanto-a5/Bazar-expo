/**
 * Shared voucher rule tests (M9-L).
 *
 * These are the rules BOTH runtimes call, so a regression here shows up as a cart
 * that quotes one discount and a checkout that charges another. The `free_shipping`
 * case had no coverage at all, which is how a quote of ৳0 survived next to a real
 * shipping discount.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateVoucherQuotes, voucherAppliedValue, voucherDisplayValue } from '../../../shared/voucher-rules';
import { computeCartTotals } from '../../../shared/pricing';
import type { SharedSellerGroup, SharedVoucher } from '../../../shared/types';

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

function voucher(overrides: Partial<SharedVoucher> = {}): SharedVoucher {
  return {
    id: 'vch_1',
    code: 'FREESHIP',
    type: 'free_shipping',
    discountValue: 0,
    scope: 'platform',
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

function groups(shippingFees: number[]): SharedSellerGroup[] {
  return shippingFees.map((fee, index) => ({
    sellerId: `sel_${index}`,
    subtotal: 1000,
    shippingFee: fee,
    freeShipping: fee === 0,
  }));
}

describe('shared voucher rules', () => {
  it('quotes a free_shipping voucher as the shipping it actually removes', () => {
    const view = [
      { sellerId: 'sel_0', subtotal: 1000, shippingFee: 60, items: [{ selected: true, sellerId: 'sel_0', productId: 'p1', categoryId: 'c1' }] },
      { sellerId: 'sel_1', subtotal: 1000, shippingFee: 40, items: [{ selected: true, sellerId: 'sel_1', productId: 'p2', categoryId: 'c1' }] },
    ];
    const quotes = evaluateVoucherQuotes([voucher()], view, 2000, 'usr_1', NOW);
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0].valid, true);
    // 60 + 40 — the quote used to be hard-coded to 0 while checkout discounted 100.
    assert.equal(quotes[0].discount, 100);
  });

  it('keeps the quoted free_shipping value equal to the applied one', () => {
    const pricing = groups([60, 40]);
    const quoted = voucherDisplayValue(voucher(), pricing, 2000);
    const applied = voucherAppliedValue(voucher(), pricing, 2000, 100);
    assert.equal(quoted, applied, 'what the cart promises must equal what checkout charges');
  });

  it('discounts shipping exactly once when free_shipping is applied', () => {
    const pricing = groups([60, 40]);
    const totals = computeCartTotals(pricing, voucher(), 4);
    assert.equal(totals.subtotal, 2000);
    assert.equal(totals.shippingTotal, 100);
    assert.equal(totals.voucherDiscount, 100);
    assert.equal(totals.grandTotal, 2000, 'free shipping leaves the subtotal, never less');
  });

  it('is a no-op when the cart already ships free', () => {
    const pricing = groups([0, 0]);
    const totals = computeCartTotals(pricing, voucher(), 2);
    assert.equal(totals.voucherDiscount, 0);
    assert.equal(totals.grandTotal, 2000);
  });

  it('caps a percentage voucher at its maximum', () => {
    const capped = voucher({ type: 'percentage', discountValue: 50, maximumDiscount: 300 });
    const pricing = groups([0]);
    const totals = computeCartTotals(pricing, capped, 1);
    assert.equal(totals.voucherDiscount, 300, '50% of 1000 is capped at 300');
  });

  it('never discounts a fixed voucher below zero', () => {
    const generous = voucher({ type: 'fixed', discountValue: 5000 });
    const pricing = groups([0]);
    const totals = computeCartTotals(pricing, generous, 1);
    assert.equal(totals.voucherDiscount, 1000);
    assert.equal(totals.grandTotal, 0, 'a discount can zero the order but never go negative');
  });

  it('marks a voucher over its usage limit invalid instead of quoting a discount', () => {
    const exhausted = voucher({ usageCount: 5, usageLimit: 5 });
    const quotes = evaluateVoucherQuotes(
      [exhausted],
      [{ sellerId: 'sel_0', subtotal: 1000, shippingFee: 60, items: [{ selected: true, sellerId: 'sel_0', productId: 'p1', categoryId: 'c1' }] }],
      1000,
      'usr_1',
      NOW,
    );
    assert.equal(quotes[0].valid, false);
    assert.equal(quotes[0].reason, 'Usage limit reached');
  });
});
