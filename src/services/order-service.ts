import { getContainer } from '@/infrastructure/container';
import type {
  Address,
  DeliveryMethodId,
  Order,
  OrderItemSnapshot,
  OrderStatus,
  PaymentMethod,
  PaymentTransaction,
  ReturnReason,
  ReturnRequest,
  SellerOrder,
} from '@/domain/types';
import { cartService } from './cart-service';
import { productIsVisibleToCustomer } from './catalog-service';
import { DEFAULT_DELIVERY_METHOD } from './delivery-service';
import { notificationService } from './notification-service';
import { newId } from '@/utils/id';
import { formatMoney, roundMoney } from '@/utils/money';
import { deriveOrderStatus as sharedDeriveOrderStatus, allPartsDelivered, SELLER_FULFILLMENT_FLOW } from '@shared/order-status';
import { vantaApi } from '@/api/vanta-api';
import { refreshSellerOrdersAndReturns, upsertReturn, upsertSellerOrderView } from '@/api/remote-seller';
import { upsertOrder, upsertReceipt, upsertReturns } from '@/api/remote-orders';

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export interface OrderMoneyLine {
  label: string;
  amount: number;
  kind: 'paid' | 'refunded' | 'due' | 'discount';
}

export interface OrderMoneySummary {
  orderId: string;
  orderCode: string;
  paymentMethod: PaymentMethod;
  total: number;
  paid: number;
  refunded: number;
  due: number;
  settled: boolean;
  headline: string;
  lines: OrderMoneyLine[];
  note?: string;
}

export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderError';
  }
}

export interface CustomerOrderSummary {
  order: Order;
  sellerOrders: SellerOrder[];
  lineCount: number;
  itemCount: number;
  sellerCount: number;
  preview: OrderItemSnapshot[];
  canCancel: boolean;
}

export interface CustomerOrderDetail {
  order: Order;
  sellerOrders: SellerOrder[];
  returns: ReturnRequest[];
  transactions: PaymentTransaction[];
  canCancel: boolean;
  cancelBlockReason: string | null;
  returnableItems: { sellerOrderId: string; item: OrderItemSnapshot }[];
}

export interface ReorderableItem {
  productId: string;
  name: string;
  quantity: number;
  variantId?: string;
}

export interface SellerOrderSummary {
  sellerOrder: SellerOrder;
  order: Order;
  lineCount: number;
  itemCount: number;
  canAdvance: boolean;
  nextStatus: OrderStatus | null;
}

export interface SellerOrderDetail {
  sellerOrder: SellerOrder;
  order: Order;
  returns: ReturnRequest[];
  canAdvance: boolean;
  nextStatus: OrderStatus | null;
}

export interface SellerReturnEntry {
  request: ReturnRequest;
  sellerOrder?: SellerOrder;
  order?: Order;
}

export interface SellerRefundEvent {
  kind: 'cancellation' | 'return';
  at: string;
  amount: number;
  orderId: string;
  sellerOrderId: string;
}

const CANCEL_ALLOWED_FROM = new Set(['new', 'confirmed', 'processing']);

export const ORDER_FLOW_LABELS: { status: OrderStatus; label: string }[] = [
  { status: 'placed', label: 'Order Placed' },
  { status: 'confirmed', label: 'Confirmed' },
  { status: 'processing', label: 'Processing' },
  { status: 'packed', label: 'Packed' },
  { status: 'ready_to_ship', label: 'Ready to Ship' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'out_for_delivery', label: 'Out for Delivery' },
  { status: 'delivered', label: 'Delivered' },
];

export function deriveOrderStatus(sellerOrders: SellerOrder[]): OrderStatus {
  return sharedDeriveOrderStatus(sellerOrders);
}

export function statusLabel(status: OrderStatus): string {
  const found = ORDER_FLOW_LABELS.find((o) => o.status === status);
  if (found) return found.label;
  const map: Record<string, string> = {
    new: 'New',
    processing: 'Processing',
    ready_to_ship: 'Ready to Ship',
    cancelled: 'Cancelled',
    return_requested: 'Return Requested',
    return_approved: 'Return Approved',
    partially_returned: 'Partially Returned',
    returned: 'Returned',
    refunded: 'Refunded',
  };
  return map[status] ?? status;
}

function stepLabel(status: OrderStatus): string {
  return statusLabel(status);
}

const ADVANCE_FLOW: OrderStatus[] = [...SELLER_FULFILLMENT_FLOW];

/** How long an identical checkout submission is treated as a retry, not a new order. */
const CHECKOUT_RETRY_WINDOW_MS = 45_000;

export interface CreateOrderInput {
  address: Address;
  paymentMethod: PaymentMethod;
  deliveryMethod?: DeliveryMethodId;
  voucherCode?: string;
  customerName?: string;
  paymentSimulate?: boolean;
  /**
   * Reference minted by a payment simulator (the local bKash / Nagad / card
   * sheets). When present it is stored on the payment transaction instead of
   * the generated placeholder, so the order carries the reference the
   * customer actually saw at checkout.
   */
  paymentReference?: string;
  /**
   * Stable key identifying a single checkout attempt. Every callback that
   * belongs to one attempt — including a payment-success signal that fires more
   * than once — reuses it, so the server's idempotency contract replays the
   * already-created order instead of creating a duplicate.
   */
  idempotencyKey?: string;
}

export class OrderService {
  /**
   * A retried "Place order" tap must never create two orders. The fingerprint
   * covers the cart, the money inputs and the address, so a genuine second
   * order (even identical) is still allowed once the window has passed.
   */
  private lastSubmission: { fingerprint: string; orderId: string; at: number } | null = null;
  /** In-flight remote submissions keyed by idempotency key, so a duplicate
   * callback awaiting the same attempt shares one request instead of two. */
  private inflightSubmissions = new Map<string, Promise<Order>>();

  // Remote customer-order mirror (M15-B): one load per signed-in user, primed at
  // boot. Orders/splits/payments are written into the device repositories so the
  // synchronous customer reads keep working unchanged.
  private static readonly REMOTE_ORDERS_TTL_MS = 15_000;
  private remoteOrders = new Map<string, { loaded: boolean; updatedAt: number; inflight: boolean }>();

  private remoteOrderState(userId: string): { loaded: boolean; updatedAt: number; inflight: boolean } {
    let state = this.remoteOrders.get(userId);
    if (!state) {
      state = { loaded: false, updatedAt: 0, inflight: false };
      this.remoteOrders.set(userId, state);
    }
    return state;
  }

  // Remote seller mirror (M17.1). The seller surfaces read orders and returns
  // synchronously from the device, but in remote mode the server owns them. The
  // seller reads prime this once per seller (and again after the TTL), and each
  // hydrate reconciles the return set so a stale local id is never actioned.
  private static readonly REMOTE_SELLER_TTL_MS = 15_000;
  private remoteSeller = new Map<string, { loaded: boolean; updatedAt: number; inflight: boolean }>();

  private ensureSellerOrdersAndReturns(sellerId: string): void {
    if (!sellerId) return;
    let state = this.remoteSeller.get(sellerId);
    if (!state) {
      state = { loaded: false, updatedAt: 0, inflight: false };
      this.remoteSeller.set(sellerId, state);
    }
    const stale = !state.loaded || Date.now() - state.updatedAt > OrderService.REMOTE_SELLER_TTL_MS;
    if (!stale || state.inflight) return;
    state.inflight = true;
    void refreshSellerOrdersAndReturns(sellerId)
      .then(() => {
        state!.loaded = true;
        state!.updatedAt = Date.now();
      })
      .catch(() => undefined)
      .finally(() => {
        state!.inflight = false;
      });
  }

  private submissionFingerprint(
    userId: string,
    input: {
      address: Address;
      paymentMethod: PaymentMethod;
      deliveryMethod?: DeliveryMethodId;
      voucherCode?: string;
    },
  ): string {
    const cart = cartService.getCart(userId);
    const parts = [
      userId,
      input.paymentMethod,
      input.deliveryMethod ?? DEFAULT_DELIVERY_METHOD,
      (input.voucherCode ?? '').trim().toLowerCase(),
      input.address.addressLine,
      input.address.district,
      input.address.postalCode,
      (cart?.items ?? [])
        .filter((item) => item.selected)
        .map((item) => `${item.productId}:${item.variantId ?? '-'}:${item.quantity}`)
        .sort()
        .join(','),
    ];
    return parts.join('#');
  }

  async createOrder(userId: string, input: CreateOrderInput): Promise<Order> {
    return this.createRemoteOrder(userId, input);
  }

  /**
   * Remote checkout. The server re-resolves the cart, re-prices with the shared
   * rules, validates stock, applies the voucher and reserves it — the client
   * never sends a total. The receipt is mirrored locally so the confirmation and
   * detail screens resolve synchronously, and the cart mirror is refreshed to
   * reflect the lines the server just emptied.
   */
  private async createRemoteOrder(userId: string, input: CreateOrderInput): Promise<Order> {
    // The server owns the cart and re-reads it on every request, so checkout is
    // never gated on a locally cached cart: a cold mirror must not be able to
    // declare the cart empty. `idempotencyKey` names this checkout attempt; when
    // absent the payload fingerprint is used as the dedupe key.
    const key = input.idempotencyKey ?? this.submissionFingerprint(userId, input);

    // Double-submit guard: when the same attempt is replayed inside the retry
    // window (a payment sheet firing onSuccess twice), return the order already
    // mirrored from the first, successful submission without a second server
    // call — the server cart may already have been cleared by then.
    const previous = this.lastSubmission;
    if (previous && previous.fingerprint === key && Date.now() - previous.at < CHECKOUT_RETRY_WINDOW_MS) {
      const existing = this.getOrder(previous.orderId);
      if (existing) return existing;
    }

    // A duplicate callback that arrives while the first request is still in
    // flight shares its promise, so exactly one order request reaches the server.
    const pending = this.inflightSubmissions.get(key);
    if (pending) return pending;

    const run = this.submitRemoteOrder(userId, input, key);
    this.inflightSubmissions.set(key, run);
    try {
      return await run;
    } finally {
      this.inflightSubmissions.delete(key);
    }
  }

  private async submitRemoteOrder(userId: string, input: CreateOrderInput, key: string): Promise<Order> {
    try {
      const receipt = await vantaApi.createOrder({
        address: {
          label: input.address.label,
          recipientName: input.address.recipientName,
          phone: input.address.phone,
          division: input.address.division,
          district: input.address.district,
          area: input.address.area,
          addressLine: input.address.addressLine,
          postalCode: input.address.postalCode,
          instructions: input.address.instructions,
          isDefault: input.address.isDefault,
        },
        paymentMethod: input.paymentMethod,
        deliveryMethod: input.deliveryMethod,
        voucherCode: input.voucherCode,
        idempotencyKey: key,
      });
      const order = upsertReceipt(receipt);
      // The server cleared the purchased lines; force a fresh read so the mirror
      // (and every cart screen) reflects the emptied server cart immediately.
      cartService.syncCart(userId, true);
      this.lastSubmission = { fingerprint: key, orderId: order.id, at: Date.now() };
      return order;
    } catch (error) {
      throw error instanceof OrderError
        ? error
        : new OrderError(error instanceof Error ? error.message : 'We could not place your order. Please try again.');
    }
  }

  /**
   * Prime the customer-order mirror from `GET /orders`, then pull each order's
   * splits/payment so the list previews and detail screens have real data. Called
   * by the session context at boot and on sign-in/refresh; a no-op in local mode.
   */
  async hydrateCustomerOrders(userId: string, force = false): Promise<void> {
    if (!userId) return;
    const state = this.remoteOrderState(userId);
    if (!force && state.loaded && Date.now() - state.updatedAt < OrderService.REMOTE_ORDERS_TTL_MS) return;
    if (state.inflight) return;
    state.inflight = true;
    try {
      const [{ orders }, { returns }] = await Promise.all([vantaApi.orders(), vantaApi.myReturns()]);
      for (const summary of orders) upsertOrder(summary);
      // The server owns return state. Prime the mirror from `GET /returns` so a
      // return the customer filed on another device (or before a reinstall) still
      // shows on the order detail/history screens, instead of only on the device
      // that happened to submit it.
      upsertReturns(returns);
      await Promise.all(
        orders.map(async (summary) => {
          try {
            upsertReceipt(await vantaApi.order(summary.id));
          } catch {
            // Keep the summary row even if one detail fetch fails.
          }
        }),
      );
      state.loaded = true;
      state.updatedAt = Date.now();
    } finally {
      state.inflight = false;
    }
  }

  private ensureCustomerOrders(userId: string): void {
    if (!userId) return;
    const state = this.remoteOrderState(userId);
    const stale = !state.loaded || Date.now() - state.updatedAt > OrderService.REMOTE_ORDERS_TTL_MS;
    if (stale && !state.inflight) void this.hydrateCustomerOrders(userId).catch(() => undefined);
  }

  /**
   * Force a customer-order refresh (bypassing the TTL) and resolve once it has
   * landed, rejecting on failure so a pull-to-refresh can report the outcome.
   */
  refreshCustomerOrders(userId: string): Promise<void> {
    return this.hydrateCustomerOrders(userId, true);
  }

  /**
   * Drops one customer's in-memory order state and the orders/returns mirrored
   * for them, so a later account on the same device cannot read them. Called on
   * sign-out via the listing cache.
   */
  resetUser(userId: string): void {
    if (!userId) return;
    this.remoteOrders.delete(userId);
    const { db } = getContainer();
    const orderIds = new Set(
      db
        .getCollection<Order>('orders')
        .filter((order) => order.customerId === userId)
        .map((order) => order.id),
    );
    for (const orderId of orderIds) db.remove('orders', orderId);
    for (const sellerOrder of [...db.getCollection<SellerOrder>('sellerOrders')]) {
      if (orderIds.has(sellerOrder.orderId)) db.remove('sellerOrders', sellerOrder.id);
    }
    for (const request of [...db.getCollection<ReturnRequest>('returnRequests')]) {
      if (request.userId === userId) db.remove('returnRequests', request.id);
    }
  }

  getOrder(orderId: string): Order | undefined {
    return getContainer().repositories.orders.getById(orderId);
  }

  sellerOrdersFor(orderId: string): SellerOrder[] {
    return getContainer().repositories.sellerOrders.listForOrder(orderId);
  }

  customerOrders(userId: string): Order[] {
    const orders = getContainer().repositories.orders.listForCustomer(userId);
    this.ensureCustomerOrders(userId);
    // The server lists newest-first; the mirror is insertion-ordered.
    return [...orders].sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
  }

  reorderableItems(userId: string, orderId: string): ReorderableItem[] {
    const { repositories } = getContainer();
    const order = repositories.orders.getById(orderId);
    if (!order || order.customerId !== userId) throw new Error('Order not found.');
    const result: ReorderableItem[] = [];
    for (const sellerOrder of repositories.sellerOrders.listForOrder(orderId)) {
      for (const item of sellerOrder.items) {
        // Only a fully-returned line is excluded. A partly-returned line still
        // leaves the customer holding the remaining units, which they may reorder.
        if (['cancelled', 'returned', 'refunded'].includes(item.status)) continue;
        const product = repositories.products.getById(item.productId);
        if (!product || !productIsVisibleToCustomer(product)) continue;
        if (product.hasVariants && product.variants.length) {
          const variant = product.variants.find((candidate) =>
            Object.entries(item.variantAttributes ?? {}).every(
              ([key, value]) => candidate.attributes[key] === value,
            ),
          );
          if (!variant || variant.stock <= 0) continue;
          result.push({
            productId: product.id,
            name: item.productName,
            quantity: item.quantity,
            variantId: variant.id,
          });
          continue;
        }
        if (product.stock <= 0) continue;
        result.push({ productId: product.id, name: item.productName, quantity: item.quantity });
      }
    }
    return result;
  }

  timeLineFor(order: Order, sellerOrders: SellerOrder[]) {
    const events: { status: OrderStatus; label: string; at: string }[] = [];
    events.push({ status: 'placed', label: 'Order Placed', at: order.placedAt });
    for (const so of sellerOrders) {
      for (const entry of so.timeline) {
        if (['new', 'placed'].includes(entry.status)) continue;
        const label = stepLabel(entry.status as OrderStatus);
        events.push({ status: entry.status as OrderStatus, label, at: entry.at });
      }
    }
    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return events;
  }

  transactionsFor(orderId: string): PaymentTransaction[] {
    return getContainer().repositories.payments.getByOrderId(orderId);
  }

  /**
   * Money view for one order, from the buyer's side. It only sums the payment
   * transactions and refunds the local payment/return flows actually recorded,
   * so a screen never has to guess what was paid or is still owed (M6-J).
   */
  orderMoneySummary(order: Order): OrderMoneySummary {
    const transactions = this.transactionsFor(order.id);
    // "Paid" is money that was actually received, so it keys off `paidAt` rather
    // than the transaction status. A refund flips the status to `refunded`, which
    // used to drop the collected amount to zero and made a part-refunded order
    // report that the customer still owed the order total *plus* the refund.
    const paid = sum(transactions.filter((t) => t.paidAt).map((t) => t.amount));
    const refunded = sum(
      transactions
        .filter((t) => t.status === 'refunded' || (t.refundedAmount ?? 0) > 0)
        .map((t) => t.refundedAmount ?? t.amount),
    );
    const cancelled = order.status === 'cancelled';
    // A refund returns money the customer already paid; it never creates a new
    // balance to collect. Adding `refunded` back into `due` is what produced
    // "৳1,300 due on delivery" on a ৳1,000 order that had ৳300 returned.
    const due = cancelled ? 0 : roundMoney(Math.max(0, order.total - paid));
    const lines: OrderMoneyLine[] = [
      { label: 'Order total', amount: order.total, kind: 'paid' },
    ];
    if (order.vouchersDiscount > 0) {
      lines.push({ label: 'Voucher discount', amount: -order.vouchersDiscount, kind: 'discount' });
    }
    if (paid > 0) lines.push({ label: 'Paid', amount: paid, kind: 'paid' });
    if (refunded > 0) lines.push({ label: 'Refunded', amount: -refunded, kind: 'refunded' });
    if (due > 0) {
      lines.push({
        label: order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Still to pay',
        amount: due,
        kind: 'due',
      });
    }

    const settled = cancelled || due === 0;
    return {
      orderId: order.id,
      orderCode: order.orderCode,
      paymentMethod: order.paymentMethod,
      total: order.total,
      paid,
      refunded,
      due,
      settled,
      headline: cancelled
        ? refunded > 0
          ? `Cancelled · ${formatMoney(refunded)} refunded`
          : 'Cancelled · nothing was charged'
        : due === 0
          ? refunded > 0
            ? refunded >= order.total
              ? `Fully refunded ${formatMoney(refunded)}`
              : `${formatMoney(refunded)} refunded · nothing left to pay`
            : 'Paid in full'
          : order.paymentMethod === 'cod'
            ? `${formatMoney(due)} due on delivery`
            : `${formatMoney(due)} still to pay`,
      lines,
    };
  }

  /** Money view for the seller's share of one seller order (M6-J). */
  sellerOrderMoneySummary(sellerOrder: SellerOrder, order: Order): OrderMoneySummary {
    const ownRefunds = sum(
      this.sellerRefundEvents(sellerOrder.sellerId)
        .filter((event) => event.sellerOrderId === sellerOrder.id)
        .map((event) => event.amount),
    );
    const net = roundMoney(Math.max(0, sellerOrder.total - ownRefunds));
    const cancelled = sellerOrder.status === 'cancelled';
    // Nothing is ever transferred to the seller inside this build, so the app
    // only reports what is left to collect: cash on delivery is still due,
    // an online capture is already held by the app.
    const dueToCollect = cancelled || order.paymentMethod !== 'cod' ? 0 : net;
    return {
      ...this.orderMoneySummary(order),
      total: sellerOrder.total,
      paid: 0,
      refunded: ownRefunds,
      due: dueToCollect,
      settled: cancelled || sellerOrder.status === 'refunded' || dueToCollect === 0,
      headline: cancelled
        ? ownRefunds > 0
          ? `Cancelled · ${formatMoney(ownRefunds)} returned to you`
          : 'Cancelled · nothing to collect'
        : ownRefunds > 0
          ? `${formatMoney(net)} left after ${formatMoney(ownRefunds)} refunded`
          : `${formatMoney(net)} to collect ${sellerOrder.status === 'delivered' ? 'now' : 'on delivery'}`,
      note:
        order.paymentMethod === 'cod'
          ? 'Collected in cash on delivery. This build records orders and returns only, it does not move money.'
          : 'Paid online, so the buyer already settled. This build does not track payouts to your account.',
      lines: [
        { label: 'Your items', amount: sellerOrder.subtotal, kind: 'paid' },
        ...(sellerOrder.shippingFee > 0
          ? [{ label: 'Delivery fee', amount: sellerOrder.shippingFee, kind: 'paid' as const }]
          : []),
        ...(sellerOrder.vouchersDiscount > 0
          ? [{ label: 'Voucher discount', amount: -sellerOrder.vouchersDiscount, kind: 'discount' as const }]
          : []),
        ...(ownRefunds > 0
          ? [{ label: 'Refunded to customer', amount: -ownRefunds, kind: 'refunded' as const }]
          : []),
        ...(cancelled ? [] : [{ label: 'Net to you', amount: net, kind: 'paid' as const }]),
      ],
    };
  }

  // ---------- Customer views ----------

  customerOrderList(userId: string): CustomerOrderSummary[] {
    return this.customerOrders(userId).map((order) => {
      const sellerOrders = this.sellerOrdersFor(order.id);
      const items = sellerOrders.flatMap((entry) => entry.items);
      return {
        order,
        sellerOrders,
        lineCount: items.length,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        sellerCount: sellerOrders.length,
        preview: items.slice(0, 3),
        canCancel: this.canCancel(order),
      };
    });
  }

  customerOrderDetail(userId: string, orderId: string): CustomerOrderDetail | null {
    if (userId) {
      this.ensureCustomerOrders(userId);
      // A deep link to an order outside the primed set still resolves after one
      // fetch; `useFocusRefresh` re-renders the screen when it lands. Its returns
      // are pulled alongside so the order never shows "delivered" while a return
      // request is still open against one of its lines.
      if (!this.getOrder(orderId)) {
        void vantaApi.order(orderId).then(upsertReceipt).catch(() => undefined);
        void vantaApi.orderReturns(orderId).then(({ returns }) => upsertReturns(returns)).catch(() => undefined);
      }
    }
    const order = this.getOrder(orderId);
    if (!order || order.customerId !== userId) return null;
    const sellerOrders = this.sellerOrdersFor(order.id);
    const canCancel = this.canCancel(order);
    return {
      order,
      sellerOrders,
      returns: this.returnRequestsForOrder(order.id),
      transactions: this.transactionsFor(order.id),
      canCancel,
      cancelBlockReason: canCancel ? null : this.cancelBlockReason(order, sellerOrders),
      returnableItems: sellerOrders.flatMap((entry) =>
        entry.items
          .filter(
            (item) =>
              (item.status === 'delivered' || item.status === 'partially_returned') &&
              this.remainingReturnableQuantity(item) > 0,
          )
          .map((item) => ({ sellerOrderId: entry.id, item })),
      ),
    };
  }

  private cancelBlockReason(order: Order, sellerOrders: SellerOrder[]): string {
    if (sellerOrders.length === 0) return 'This order has no fulfillment records.';
    if (sellerOrders.every((entry) => entry.status === 'cancelled')) return 'This order was already cancelled.';
    if (order.status === 'cancelled') return 'This order was already cancelled.';
    return 'This order can no longer be cancelled because fulfillment has already started.';
  }

  // ---------- Seller views ----------

  sellerOrderList(sellerId: string): SellerOrderSummary[] {
    this.ensureSellerOrdersAndReturns(sellerId);
    const { repositories } = getContainer();
    return repositories.sellerOrders
      .listForSeller(sellerId)
      .map((sellerOrder) => {
        const order = repositories.orders.getById(sellerOrder.orderId);
        return {
          sellerOrder,
          order,
          lineCount: sellerOrder.items.length,
          itemCount: sellerOrder.items.reduce((sum, item) => sum + item.quantity, 0),
          canAdvance: this.sellerOrderCanAdvance(sellerOrder),
          nextStatus: this.nextSellerStatus(sellerOrder),
        };
      })
      .filter((entry): entry is SellerOrderSummary & { order: Order } => !!entry.order);
  }

  sellerOrderDetail(sellerId: string, sellerOrderId: string): SellerOrderDetail | null {
    this.ensureSellerOrdersAndReturns(sellerId);
    const { repositories } = getContainer();
    const sellerOrder = repositories.sellerOrders.getById(sellerOrderId);
    if (!sellerOrder || sellerOrder.sellerId !== sellerId) return null;
    const order = repositories.orders.getById(sellerOrder.orderId);
    if (!order) return null;
    return {
      sellerOrder,
      order,
      returns: repositories.returnRequests.listForSeller(sellerId).filter((r) => r.sellerOrderId === sellerOrder.id),
      canAdvance: this.sellerOrderCanAdvance(sellerOrder),
      nextStatus: this.nextSellerStatus(sellerOrder),
    };
  }

  nextSellerStatus(sellerOrder: SellerOrder): OrderStatus | null {
    if (!this.sellerOrderCanAdvance(sellerOrder)) return null;
    const idx = ADVANCE_FLOW.indexOf(sellerOrder.status);
    if (idx === -1 || idx >= ADVANCE_FLOW.length - 1) return null;
    return ADVANCE_FLOW[idx + 1];
  }

  // ---------- Return views ----------

  returnRequestsForUser(userId: string): ReturnRequest[] {
    return getContainer().repositories.returnRequests.listForUser(userId);
  }

  returnRequestsForSeller(sellerId: string): ReturnRequest[] {
    return getContainer().repositories.returnRequests.listForSeller(sellerId);
  }

  returnRequestsForOrder(orderId: string): ReturnRequest[] {
    return getContainer()
      .repositories.returnRequests.list()
      .filter((request) => request.orderId === orderId);
  }

  sellerReturnList(sellerId: string): SellerReturnEntry[] {
    this.ensureSellerOrdersAndReturns(sellerId);
    const { repositories } = getContainer();
    return this.returnRequestsForSeller(sellerId).map((request) => ({
      request,
      sellerOrder: repositories.sellerOrders.getById(request.sellerOrderId),
      order: repositories.orders.getById(request.orderId),
    }));
  }

  /**
   * Units of a line the customer still holds.
   *
   * `returnedQuantity` is cumulative, so this is the honest denominator for
   * "how many can I still send back". Clamped to 0 because a snapshot written by an
   * older build, or a double-processed return, must never yield a negative count.
   */
  remainingReturnableQuantity(item: OrderItemSnapshot): number {
    const returned = Math.max(0, item.returnedQuantity ?? 0);
    return Math.max(0, item.quantity - returned);
  }

  /**
   * The quantity a return request covers.
   *
   * Defaults to whatever is still returnable rather than the full ordered
   * quantity: a line already partly returned cannot hand back the same unit twice.
   */
  returnQuantity(request: ReturnRequest, item?: OrderItemSnapshot): number {
    if (request.quantity !== undefined) return request.quantity;
    if (item) return this.remainingReturnableQuantity(item);
    return 1;
  }

  refundEstimateForItem(item: OrderItemSnapshot, quantity: number): number {
    const safeQuantity = Math.max(0, Math.min(Math.floor(quantity), item.quantity));
    return roundMoney(item.unitPrice * safeQuantity);
  }

  returnRefundAmount(request: ReturnRequest, item: OrderItemSnapshot): number {
    return this.refundEstimateForItem(item, this.returnQuantity(request, item));
  }

  /**
   * Money events that reduce a seller's realised revenue, in the exact amounts
   * the local refund flow recorded (M6-A). `order-service` owns refund maths, so
   * analytics aggregates these events instead of recomputing them.
   *
   * - `cancellation` refunds the seller's own part of a cancelled order, dated
   *   by the order's cancellation time.
   * - `return` refunds the item value the customer actually got back, dated by
   *   the request reaching `refunded`.
   */
  sellerRefundEvents(sellerId: string): SellerRefundEvent[] {
    const { repositories } = getContainer();
    const events: SellerRefundEvent[] = [];

    for (const sellerOrder of repositories.sellerOrders.listForSeller(sellerId)) {
      if (sellerOrder.status !== 'cancelled') continue;
      const order = repositories.orders.getById(sellerOrder.orderId);
      if (!order) continue;
      const transaction = repositories.payments.getByOrderId(order.id)[0];
      const refunded = transaction?.status === 'refunded';
      if (!refunded) continue;
      events.push({
        kind: 'cancellation',
        at: order.cancelledAt ?? sellerOrder.updatedAt,
        amount: sellerOrder.total,
        orderId: order.id,
        sellerOrderId: sellerOrder.id,
      });
    }

    for (const request of this.returnRequestsForSeller(sellerId)) {
      if (request.status !== 'refunded') continue;
      const sellerOrder = repositories.sellerOrders.getById(request.sellerOrderId);
      const item = sellerOrder?.items.find((entry) => entry.id === request.orderItemId);
      if (!sellerOrder || !item) continue;
      const at = [...request.timeline].reverse().find((entry) => entry.status === 'refunded')?.at ?? request.updatedAt;
      events.push({
        kind: 'return',
        at,
        amount: this.returnRefundAmount(request, item),
        orderId: request.orderId,
        sellerOrderId: sellerOrder.id,
      });
    }

    return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }

  // ---------- Cancellation ----------

  canCancel(order: Order): boolean {
    const sellerOrders = this.sellerOrdersFor(order.id);
    return sellerOrders.length > 0 && sellerOrders.every((s) => CANCEL_ALLOWED_FROM.has(s.status));
  }

  async cancelOrder(userId: string, orderId: string, reason: string): Promise<void> {
    void userId;
    try {
      upsertOrder(await vantaApi.cancelOrder(orderId, reason));
      // Pull the refreshed splits/payment so stock-release and refund state show.
      await vantaApi.order(orderId).then(upsertReceipt).catch(() => undefined);
      return;
    } catch (error) {
      throw error instanceof OrderError
        ? error
        : new OrderError(error instanceof Error ? error.message : 'We could not cancel this order.');
    }
  }

  // ---------- Seller fulfillment ----------

  async advanceSellerOrder(sellerId: string, sellerOrderId: string): Promise<SellerOrder> {
    void sellerId;
    const view = await vantaApi.advanceSellerOrder(sellerOrderId);
    return upsertSellerOrderView(view);
  }

  sellerOrderCanAdvance(sellerOrder: SellerOrder): boolean {
    const idx = ADVANCE_FLOW.indexOf(sellerOrder.status);
    return idx > -1 && idx < ADVANCE_FLOW.length - 1;
  }

  // ---------- Returns ----------

  /**
   * Remote customer return (M17). The server is the source of truth: the request
   * is POSTed, the server's answer is mirrored, and the parent order/splits are
   * re-pulled so the item reads `return_requested` everywhere. A duplicate submit
   * is reconciled from `GET /orders/:id/returns` first, so the caller can surface
   * the request the server already holds instead of a bare "already exists".
   */
  private async requestRemoteReturn(
    userId: string,
    sellerOrderId: string,
    orderItemId: string,
    input: {
      reason: ReturnReason;
      description: string;
      images: string[];
      preferredResolution: 'refund' | 'replacement';
      quantity?: number;
    },
  ): Promise<void> {
    const orderId = getContainer().repositories.sellerOrders.getById(sellerOrderId)?.orderId;
    if (!orderId) throw new OrderError('Order not found.');
    try {
      const { returns } = await vantaApi.requestOrderReturn(orderId, {
        items: [
          {
            lineId: orderItemId,
            reason: input.reason,
            description: input.description,
            images: input.images,
            preferredResolution: input.preferredResolution,
            quantity: input.quantity ?? null,
          },
        ],
      });
      upsertReturns(returns);
      // Re-pull the order so the mirrored item/split status is the server's, not a
      // locally-assumed `return_requested`.
      await vantaApi.order(orderId).then(upsertReceipt).catch(() => undefined);
      const state = this.remoteOrderState(userId);
      state.loaded = true;
      state.updatedAt = Date.now();
    } catch (error) {
      // Reconcile before surfacing the failure: a repeat submit (or a stale
      // mirror) must show the existing request and its status.
      await vantaApi.orderReturns(orderId).then(({ returns }) => upsertReturns(returns)).catch(() => undefined);
      throw error instanceof OrderError
        ? error
        : new OrderError(error instanceof Error ? error.message : 'We could not submit this return.');
    }
  }

  async requestReturn(
    userId: string,
    sellerOrderId: string,
    orderItemId: string,
    input: {
      reason: ReturnReason;
      description: string;
      images: string[];
      preferredResolution: 'refund' | 'replacement';
      quantity?: number;
    },
  ): Promise<void> {
    return this.requestRemoteReturn(userId, sellerOrderId, orderItemId, input);
  }

  async decideReturn(sellerId: string, returnId: string, approve: boolean): Promise<void> {
    const dto = approve
      ? await vantaApi.approveSellerReturn(returnId)
      : await vantaApi.rejectSellerReturn(returnId);
    upsertReturn(dto);
    await refreshSellerOrdersAndReturns(sellerId).catch(() => undefined);
  }

  async markReturned(sellerId: string, returnId: string): Promise<void> {
    const dto = await vantaApi.markSellerReturnReturned(returnId);
    upsertReturn(dto);
    await refreshSellerOrdersAndReturns(sellerId).catch(() => undefined);
  }

  // ---------- Internals ----------

  private afterSellerOrderChange(sellerOrder: SellerOrder): void {
    const { repositories } = getContainer();
    const order = repositories.orders.getById(sellerOrder.orderId);
    if (!order) return;
    const allSellerOrders = this.sellerOrdersFor(order.id);
    const status = deriveOrderStatus(allSellerOrders);
    // Settlement and the arrival notice key off "every live part physically
    // arrived", not off the rolled-up status. A return on one line leaves the
    // status as `returned` forever, which used to keep that line's COD `pending`
    // and skip the delivery notification even after the rest of the order landed.
    const goodsArrived = allPartsDelivered(allSellerOrders);
    const firstArrival = goodsArrived && !order.deliveredAt;
    const now2 = new Date().toISOString();
    const patch: Partial<Order> = { status, updatedAt: now2 };
    if (goodsArrived) {
      patch.deliveredAt = order.deliveredAt ?? now2;
      if (order.paymentMethod === 'cod' && order.paymentStatus === 'pending') {
        const transaction = repositories.payments.getByOrderId(order.id)[0];
        if (transaction && transaction.status === 'pending') {
          repositories.payments.update(transaction.id, {
            status: 'paid',
            paidAt: now2,
            updatedAt: now2,
          });
        }
        patch.paymentStatus = 'paid';
      }
    }
    const owner = repositories.users.getById(order.customerId);
    repositories.orders.update(order.id, patch);

    const seller = repositories.sellers.getById(sellerOrder.sellerId);
    // Customer notifications. `firstArrival` keeps the delivery notice to one per
    // order: this block runs on every seller-order write, so keying it off
    // `status === 'delivered'` re-sent it on each later change (a return decision,
    // for instance) and inflated the unread count.
    if (owner) {
      if (firstArrival) {
        notificationService.create(order.customerId, 'order_delivered', 'Order Delivered', `Order ${order.orderCode} has been delivered. Rate your products!`, { orderId: order.id });
      } else if (sellerOrder.status === 'shipped') {
        notificationService.create(order.customerId, 'order_shipped', 'Order Shipped', `An item from order ${order.orderCode} is on its way.`, { orderId: order.id, sellerOrderId: sellerOrder.id });
      } else if (sellerOrder.status === 'confirmed') {
        notificationService.create(order.customerId, 'order_confirmed', 'Order Confirmed', `Seller confirmed part of order ${order.orderCode}.`, { orderId: order.id });
      }
    }
    // Ensure the seller sees stock statuses
    if (seller) {
      for (const item of sellerOrder.items) {
        const product = repositories.products.getById(item.productId);
        if (product && product.stock <= product.lowStockThreshold && product.stock > 0) {
          notificationService.create(
            seller.userId,
            'seller_low_stock',
            'Low Stock',
            `"${product.name}" is running low (${product.stock} left).`,
            { productId: product.id },
          );
        }
      }
    }
  }

  private deriveSellerStatusFromItems(so: SellerOrder): OrderStatus {
    const statuses = so.items.map((i) => i.status);
    // Highest return state wins, so a line that is fully returned and a sibling that
    // is only partly returned read as `returned`, and one partly-returned line does
    // not make the whole seller order look fully returned.
    if (statuses.includes('refunded')) return 'refunded';
    if (statuses.includes('returned')) return 'returned';
    if (statuses.includes('partially_returned')) return 'partially_returned';
    if (statuses.includes('return_approved')) return 'return_approved';
    if (statuses.includes('return_requested')) return 'return_requested';
    if (statuses.includes('cancelled')) return 'cancelled';
    if (statuses.includes('pending')) return 'new';
    return 'delivered';
  }

  private restockItem(
    so: SellerOrder,
    item: OrderItemSnapshot,
    reason: 'cancellation' | 'return',
    quantity?: number,
  ): void {
    const { repositories } = getContainer();
    const product = repositories.products.getById(item.productId);
    if (!product) return;
    const count = Math.max(1, Math.min(quantity ?? item.quantity, item.quantity));
    const now = new Date().toISOString();
    let nextStock = product.stock + count;
    let restockedVariantId: string | null = null;
    if (item.variantAttributes && product.variants.length) {
      // Prefer the stored id. Falling back to attribute equality alone credited the
      // wrong variant whenever two variants shared an attribute value.
      const variant = item.variantId
        ? product.variants.find((v) => v.id === item.variantId)
        : product.variants.find((v) =>
            Object.entries(item.variantAttributes ?? {}).every(([k, value]) => v.attributes[k] === value),
          );
      if (variant) {
        const nextVariants = product.variants.map((v) =>
          v.id === variant.id ? { ...v, stock: v.stock + count } : v,
        );
        repositories.products.update(product.id, { variants: nextVariants });
        nextStock = nextVariants.reduce((sum, v) => sum + v.stock, 0);
        restockedVariantId = variant.id;
      }
    }
    repositories.products.update(product.id, { stock: nextStock });
    repositories.inventoryAdjustments.create({
      id: newId('inv'),
      productId: product.id,
      variantId: restockedVariantId,
      quantity: count,
      reason,
      referenceId: so.orderId,
      createdAt: now,
      updatedAt: now,
    });
    const updated = repositories.products.getById(product.id)!;
    repositories.products.update(product.id, {
      status: updated.stock > 0 ? (updated.status === 'out_of_stock' ? 'active' : updated.status) : updated.status,
    });
  }

  private pickCarrier(): string {
    const carriers = ['SA Paribahan', 'Paperfly', 'Pathao', 'RedX', 'Sundarban Courier'];
    return carriers[Math.floor(Math.random() * carriers.length)];
  }
}

export const orderService = new OrderService();
