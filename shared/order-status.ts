/**
 * Order status derivation (M7-E).
 *
 * An order is a roll-up of per-seller fulfilment. Both the order list screen and
 * the API's order repository need the same roll-up, so the rule lives here.
 */
import type { SharedOrderStatus, SharedSellerOrderStatus } from './types';

export const SELLER_STATUS_RANK: Record<string, number> = {
  placed: 0,
  new: 0,
  confirmed: 1,
  processing: 2,
  packed: 3,
  ready_to_ship: 4,
  shipped: 5,
  out_for_delivery: 6,
  delivered: 7,
  return_requested: 8,
  return_approved: 9,
  // Partial returns are a *closed* return step for the units already back, so they
  // rank above `return_approved` and below a full return. Ranking matters because
  // the roll-up takes the highest return state across parts: an order whose last
  // line was fully returned must read `returned`, not `partially_returned`.
  partially_returned: 10,
  returned: 11,
  refunded: 12,
};

/**
 * The seller-driven fulfilment sequence, in order.
 *
 * The API's advance endpoint and the app's seller screens must walk the *same*
 * sequence: a status that exists on one side but not the other is a dead end,
 * because the seller simply stops advancing (the "Mark as…" button vanishes the
 * moment the server moves to an unknown step). The two codebases cannot share a
 * module, so this is the one declared order both sides mirror.
 */
export const SELLER_FULFILLMENT_FLOW: SharedOrderStatus[] = [
  'new',
  'confirmed',
  'processing',
  'packed',
  'ready_to_ship',
  'shipped',
  'out_for_delivery',
  'delivered',
];

export const RETURN_OPEN: SharedOrderStatus[] = ['return_requested', 'return_approved'];
export const RETURN_CLOSED: SharedOrderStatus[] = ['partially_returned', 'returned', 'refunded'];

export function deriveOrderStatus(sellerOrders: SharedSellerOrderStatus[]): SharedOrderStatus {
  if (sellerOrders.length === 0) return 'placed';
  if (sellerOrders.every((sellerOrder) => sellerOrder.status === 'cancelled')) return 'cancelled';
  const live = sellerOrders.filter((sellerOrder) => sellerOrder.status !== 'cancelled');
  if (live.length === 0) return 'cancelled';

  const isReturnStatus = (status: string): boolean =>
    RETURN_OPEN.includes(status as SharedOrderStatus) || RETURN_CLOSED.includes(status as SharedOrderStatus);

  // A return only owns the roll-up once nothing else is still moving. Returning it
  // eagerly let a single returned line mask a sibling seller order that was still
  // `shipped`: the parent never reached `delivered`, so the COD settlement that
  // fires on delivery never ran and the money stayed pending forever.
  const fulfilment = live.filter((sellerOrder) => !isReturnStatus(sellerOrder.status));

  // Bottleneck rule: the order reports the least-advanced live part. `new`/`placed`
  // (rank 0) counts as in flight and rolls up to `placed`.
  const inFlight = fulfilment.filter(
    (sellerOrder) =>
      (SELLER_STATUS_RANK[sellerOrder.status] ?? 0) >= 0 && (SELLER_STATUS_RANK[sellerOrder.status] ?? 0) <= 6,
  );
  if (inFlight.length > 0) {
    const least = inFlight.reduce((min, entry) =>
      (SELLER_STATUS_RANK[entry.status] ?? 0) < (SELLER_STATUS_RANK[min.status] ?? 0) ? entry : min,
    );
    const rank = SELLER_STATUS_RANK[least.status] ?? 0;
    return rank <= 0 ? 'placed' : (least.status as SharedOrderStatus);
  }

  // Nothing outstanding: surface the most advanced return state across the parts.
  const returning = live.filter((sellerOrder) => isReturnStatus(sellerOrder.status));
  if (returning.length > 0) {
    const highest = returning.reduce((max, entry) =>
      (SELLER_STATUS_RANK[entry.status] ?? 0) > (SELLER_STATUS_RANK[max.status] ?? 0) ? entry : max,
    );
    return highest.status as SharedOrderStatus;
  }

  return 'delivered';
}

/**
 * True once every live part has physically arrived with the customer.
 *
 * This is deliberately NOT `deriveOrderStatus(...) === 'delivered'`. A return does
 * not un-deliver goods, so an order whose first line was returned and whose second
 * line has now landed must still count as delivered: cash on delivery was collected
 * and the delivery notification is owed. Gating settlement on the rolled-up status
 * left that COD `pending` forever and the customer was never told it arrived.
 *
 * Return states rank at or above `delivered`, so a part can only reach one by having
 * been delivered first, which is what makes this safe to treat as "arrived".
 */
export function allPartsDelivered(sellerOrders: SharedSellerOrderStatus[]): boolean {
  const live = sellerOrders.filter((sellerOrder) => sellerOrder.status !== 'cancelled');
  if (live.length === 0) return false;
  return live.every((sellerOrder) => (SELLER_STATUS_RANK[sellerOrder.status] ?? 0) >= SELLER_STATUS_RANK.delivered);
}
