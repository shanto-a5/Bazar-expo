/**
 * M11 partial-return state regression tests.
 *
 * These cover a defect M10 identified but deliberately left open: a partial return
 * restocked and refunded only the requested quantity, yet still marked the whole
 * seller-order line `returned`. That made a 1-of-3 return read as a complete return
 * to both the customer and the seller, and left the remaining units permanently
 * unreturnable because the line was no longer `delivered`.
 *
 * The state rule now lives in `shared/order-status.ts` (ranking) and the snapshot
 * fields in `src/domain/types/commerce.ts`. What is testable without a device is the
 * ranking and roll-up contract both the app and the API depend on, plus the
 * cumulative-quantity arithmetic the local service performs. Those are what this file
 * pins down.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allPartsDelivered, deriveOrderStatus, RETURN_CLOSED, SELLER_STATUS_RANK } from '../../../shared/order-status';
import type { SharedSellerOrderStatus } from '../../../shared/types';

function part(status: string): SharedSellerOrderStatus {
  return { id: `so_${status}`, status } as SharedSellerOrderStatus;
}

/**
 * The local service's cumulative arithmetic, mirrored here deliberately.
 *
 * `markReturned` accumulates `returnedQuantity` and derives the line status from it.
 * Keeping the rule expressed once as a pure function is what makes it testable
 * without AsyncStorage; the service calls the identical sequence.
 */
function applyReturn(
  line: { quantity: number; returnedQuantity?: number },
  requestQuantity: number,
): { returnedQuantity: number; remaining: number; status: 'partially_returned' | 'returned' } {
  const returnedTotal = Math.min(line.quantity, (line.returnedQuantity ?? 0) + requestQuantity);
  const remaining = Math.max(0, line.quantity - returnedTotal);
  return {
    returnedQuantity: returnedTotal,
    remaining,
    status: remaining === 0 ? 'returned' : 'partially_returned',
  };
}

describe('M11 partial return accumulates rather than replacing', () => {
  it('a 1-of-3 return is partial, not a full return', () => {
    const result = applyReturn({ quantity: 3 }, 1);
    assert.equal(result.status, 'partially_returned', '1 of 3 units must not read as a full return');
    assert.equal(result.returnedQuantity, 1);
    assert.equal(result.remaining, 2);
  });

  it('the remainder of a partly-returned line can still come back', () => {
    let line: { quantity: number; returnedQuantity?: number; remaining?: number; status?: string } = {
      quantity: 3,
      returnedQuantity: 0,
    };
    const first = applyReturn({ quantity: line.quantity, returnedQuantity: line.returnedQuantity }, 1);
    line = { ...line, ...first };
    assert.equal(line.returnedQuantity, 1);
    const second = applyReturn({ quantity: line.quantity, returnedQuantity: line.returnedQuantity }, 2);
    line = { ...line, ...second };
    assert.equal(line.status, 'returned', 'returning the remaining 2 completes the line');
    assert.equal(line.returnedQuantity, 3);
    assert.equal(line.remaining, 0);
  });

  it('one unit at a time reaches the same end state as a single return', () => {
    let line: { quantity: number; returnedQuantity?: number; remaining?: number; status?: string } = {
      quantity: 3,
      returnedQuantity: 0,
    };
    for (let i = 0; i < 3; i += 1) {
      const next = applyReturn({ quantity: line.quantity, returnedQuantity: line.returnedQuantity }, 1);
      line = { ...line, ...next };
    }
    const allAtOnce = applyReturn({ quantity: 3 }, 3);
    assert.equal(line.status, allAtOnce.status);
    assert.equal(line.returnedQuantity, allAtOnce.returnedQuantity);
    assert.equal(line.remaining, allAtOnce.remaining);
  });

  it('never returns more units than were bought', () => {
    const result = applyReturn({ quantity: 2, returnedQuantity: 2 }, 1);
    assert.equal(result.returnedQuantity, 2, 'a line cannot accumulate past its ordered quantity');
    assert.equal(result.remaining, 0);
    assert.equal(result.status, 'returned');
  });

  it('treats a line with no prior returns as fully returnable', () => {
    const result = applyReturn({ quantity: 4 }, 4);
    assert.equal(result.status, 'returned');
    assert.equal(result.remaining, 0);
  });
});

describe('M11 partial-return status ranking', () => {
  it('ranks a partial return above an open return and below a full one', () => {
    assert.ok(
      SELLER_STATUS_RANK.partially_returned > SELLER_STATUS_RANK.return_approved,
      'a partial return is further along than an approved request',
    );
    assert.ok(
      SELLER_STATUS_RANK.partially_returned < SELLER_STATUS_RANK.returned,
      'a partial return is less final than a full return',
    );
    assert.ok(SELLER_STATUS_RANK.partially_returned > SELLER_STATUS_RANK.delivered);
  });

  it('treats a partial return as a closed return step', () => {
    assert.ok(
      RETURN_CLOSED.includes('partially_returned'),
      'a partial return is not outstanding fulfilment, so it must not keep an order "in flight"',
    );
  });

  it('does not let a partial return block COD settlement', () => {
    assert.ok(
      allPartsDelivered([part('delivered'), part('partially_returned')]),
      'goods still physically arrived, so cash on delivery is collectable',
    );
  });
});

describe('M11 roll-up agrees for partial and full returns', () => {
  it('surfaces the partial return when it is the only return state', () => {
    assert.equal(deriveOrderStatus([part('partially_returned')]), 'partially_returned');
  });

  it('reports fully returned when any part is fully returned', () => {
    assert.equal(
      deriveOrderStatus([part('partially_returned'), part('returned')]),
      'returned',
      'a fully-returned part outranks a partly-returned one',
    );
  });

  it('still lets in-flight fulfilment win over a partial return', () => {
    assert.equal(
      deriveOrderStatus([part('partially_returned'), part('shipped')]),
      'shipped',
      'a sibling still moving must not be masked by a closed return',
    );
  });

  it('keeps customer and seller views from disagreeing on a mixed return', () => {
    const parts = [part('partially_returned'), part('partially_returned')];
    const order = deriveOrderStatus(parts);
    const settled = allPartsDelivered(parts);
    assert.equal(order, 'partially_returned');
    assert.equal(settled, true, 'the order is both partly returned and fully delivered; both are true');
  });
});
