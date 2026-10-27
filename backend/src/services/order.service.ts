/**
 * Order service (M7-K / M8-D).
 *
 * The server is the authority for what an order costs and what it contains. It
 * accepts only a shipping address, a payment method, a delivery method and an
 * optional voucher code from the client — never prices, never quantities, never
 * seller ids — then:
 *
 *   1. re-reads the cart,
 *   2. re-validates every line with the shared visibility/stock rules,
 *   3. re-prices the cart with the shared grouping/voucher/delivery rules,
 *   4. re-checks voucher eligibility and records the redemption,
 *   5. decrements stock through the repository's conditional update,
 *   6. writes the order, the per-seller splits, the payment transaction and the
 *      inventory adjustments, then clears the purchased lines from the cart.
 *
 * Any client-supplied total is ignored entirely.
 *
 * M8 — atomicity. Steps 1-6 either all commit or none do. The strategy is chosen
 * from the repository bundle, not from an environment flag a caller can set:
 *
 *   - `repos.supportsTransactions` (Mongo on a replica set): steps 1-6 run inside
 *     one `withTransaction` over a session-bound bundle, so a stock failure, a
 *     voucher race or a crash mid-write leaves no order, no payment row, no
 *     stock movement and no orphaned split. There is no compensation to get
 *     wrong, because there is nothing to compensate.
 *   - otherwise (standalone mongod with `MONGO_TRANSACTIONS=false`, or the
 *     in-memory development driver): the M7 compensating writes still run, and
 *     `/health/ready` reports the weaker guarantee.
 *
 * M8 — idempotency. The M7 process-local `Map` is gone. A key is now claimed by
 * an insert against a unique index, so the guarantee survives a restart and holds
 * across processes; a repeat within the window replays the stored order, and the
 * *same* key with a *different* payload is rejected as a conflict rather than
 * silently answered with the wrong order.
 */
import { createHash } from 'node:crypto';
import { roundMoney } from '../../../shared/money';
import { DEFAULT_DELIVERY_METHOD, checkoutTotals, isDeliveryMethod, quoteDeliveryForTotals } from '../../../shared/delivery';
import { deriveOrderStatus } from '../../../shared/order-status';
import { computeCartTotals, countSelectedItems, groupLinesBySeller, lineSubtotal } from '../../../shared/pricing';
import { effectivePrice } from '../../../shared/catalog-rules';
import { evaluateVoucherQuotes } from '../../../shared/voucher-rules';
import type { ResolvedCartLine, SharedProduct } from '../../../shared/types';
import { AppError } from '../http/errors';
import { newId, nowIso } from '../lib/identity';
import { initialPaymentStatus, isPaymentMethod, paymentReference } from './payment.service';
import type {
  AddressEntity,
  CartItemEntity,
  DeliveryMethodId,
  IdempotencyRecordEntity,
  InventoryAdjustmentEntity,
  NotificationEntity,
  OrderEntity,
  OrderItemSnapshot,
  OrderStatus,
  PaymentMethod,
  PaymentTransactionEntity,
  ProductEntity,
  ProductVariantEntity,
  SellerOrderEntity,
  StoreEntity,
  VoucherEntity,
} from '../domain/entities';
import type { RepositoryBundle } from '../repositories/contracts';
import { CartService, type PricedCart } from './cart.service';
import { config } from '../config/env';

const SELLER_STATUS_FLOW: OrderStatus[] = [
  'new',
  'confirmed',
  'processing',
  'packed',
  'ready_to_ship',
  'shipped',
  'out_for_delivery',
  'delivered',
];

const CANCELLABLE_STATUSES: OrderStatus[] = ['placed', 'new', 'confirmed', 'processing'];

/** M8: namespace for checkout idempotency keys, so no other write can collide. */
const ORDER_IDEMPOTENCY_SCOPE = 'orders';

/** How long an `in_flight` claim without an order may live before it is presumed dead. */
const ABANDONED_CLAIM_MS = 60_000;

interface CheckoutLine {
  item: CartItemEntity;
  product: ProductEntity;
  variant?: ProductVariantEntity;
  resolved: ResolvedCartLine;
}

export interface CreateOrderInput {
  address: AddressEntity;
  paymentMethod: PaymentMethod;
  deliveryMethod?: DeliveryMethodId;
  voucherCode?: string;
  /** Client idempotency key: a repeat inside the window returns the same order. */
  idempotencyKey?: string;
}

export interface OrderReceipt {
  order: OrderEntity;
  sellerOrders: SellerOrderEntity[];
  payment: PaymentTransactionEntity;
  cart: PricedCart;
}

/**
 * M8: the part of a receipt that a transaction can contain. The priced cart is
 * computed after the commit, from the datastore the caller will read next, rather
 * than from session-local state that may not exist by the time it is sent.
 */
interface PlacedOrder {
  order: OrderEntity;
  sellerOrders: SellerOrderEntity[];
  payment: PaymentTransactionEntity;
}

export class OrderService {
  constructor(
    private readonly repos: RepositoryBundle,
    private readonly cartService: CartService,
  ) {}

  /**
   * M8 public entry point: claim-or-replay, then place the order atomically.
   *
   * The claim is deliberately made *outside* the transaction. A record written
   * inside would vanish on rollback and the key would be reusable by a retry that
   * deserves a fresh attempt; instead the claim is a durable insert, and a failed
   * attempt releases it explicitly so the client can retry the same key.
   */
  async createOrder(userId: string, input: CreateOrderInput): Promise<OrderReceipt> {
    if (!isPaymentMethod(input.paymentMethod)) {
      throw AppError.validation('Choose a payment method.', [
        { field: 'paymentMethod', message: 'Choose a payment method.' },
      ]);
    }
    const address = this.resolveAddress(input.address);
    const deliveryMethod = isDeliveryMethod(input.deliveryMethod) ? input.deliveryMethod : DEFAULT_DELIVERY_METHOD;

    const idempotencyKey = input.idempotencyKey?.trim();
    const fingerprint = OrderService.fingerprint(userId, input, address, deliveryMethod);
    // The order id is reserved *before* the claim and written into it. That is
    // what makes a crashed attempt recoverable: the key knows which order it was
    // for, so a later retry can find the committed order and finish the record
    // instead of dead-ending on an `in_flight` row that will never resolve.
    const intendedOrderId = newId('ord');

    if (idempotencyKey) {
      const existing = await this.repos.idempotency.find(ORDER_IDEMPOTENCY_SCOPE, userId, idempotencyKey);
      if (existing) return this.replay(userId, existing, fingerprint);

      const timestamp = nowIso();
      const claimed = await this.repos.idempotency.claim({
        id: newId('idm'),
        scope: ORDER_IDEMPOTENCY_SCOPE,
        ownerId: userId,
        key: idempotencyKey,
        requestFingerprint: fingerprint,
        state: 'in_flight',
        resourceId: intendedOrderId,
        createdAt: timestamp,
        updatedAt: timestamp,
        // A BSON date: the TTL index behind it ignores a string field, which would
        // leave spent keys in the collection forever.
        expiresAt: new Date(Date.now() + config.idempotencyTtlHours * 3_600_000),
      });

      if (!claimed) {
        // Lost the race against a concurrent submit of the same key. Whoever won
        // owns the outcome, so the only correct answers are their order or a
        // conflict — never a second order.
        const winner = await this.repos.idempotency.find(ORDER_IDEMPOTENCY_SCOPE, userId, idempotencyKey);
        if (winner) return this.replay(userId, winner, fingerprint);
        throw AppError.conflict('That submission is already being processed. Try again in a moment.');
      }
    }

    try {
      const placed = await this.placeOrder(userId, { ...input, address, deliveryMethod }, intendedOrderId);
      if (idempotencyKey) {
        await this.repos.idempotency.complete(ORDER_IDEMPOTENCY_SCOPE, userId, idempotencyKey, {
          state: 'completed',
          resourceId: placed.order.id,
          responseStatus: 201,
        });
      }
      // Priced after the write, against the committed cart: the purchased lines
      // are gone, which is exactly what the caller should render next.
      return { ...placed, cart: await this.cartService.priceCart(userId) };
    } catch (error) {
      if (idempotencyKey) {
        // Release so a genuine retry of the same submit is not blocked for the
        // whole window. A *completed* record is never released.
        await this.repos.idempotency.release(ORDER_IDEMPOTENCY_SCOPE, userId, idempotencyKey).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * M8: same key, second time.
   *
   * Four outcomes, all deterministic:
   *   - different payload under the same key → 409, because replaying the stored
   *     order would answer a question the caller did not ask;
   *   - in flight, order not written yet, attempt still young → 409, the first
   *     attempt owns the key;
   *   - in flight but the order it reserved *does* exist → the transaction
   *     committed and the process died before it could mark the key complete, so
   *     the key is finished off here and the customer gets their order back
   *     instead of being locked out of it for the rest of the TTL window;
   *   - completed → the original order, with no second write of anything.
   */
  private async replay(userId: string, record: IdempotencyRecordEntity, fingerprint: string): Promise<OrderReceipt> {
    if (record.requestFingerprint !== fingerprint) {
      throw AppError.conflict('That idempotency key was already used with different order details.');
    }
    if (record.state === 'in_flight' && record.resourceId) {
      // `resourceId` is reserved *before* the order is written, so its presence
      // here is not proof of anything by itself. The order row is the proof.
      const committed = await this.repos.orders.findById(record.resourceId);
      if (committed && committed.customerId === userId) {
        await this.repos.idempotency
          .complete(ORDER_IDEMPOTENCY_SCOPE, userId, record.key, {
            state: 'completed',
            resourceId: committed.id,
            responseStatus: 201,
          })
          .catch(() => undefined);
        return this.receiptFor(userId, committed);
      }
      if (OrderService.isAbandoned(record)) {
        // No order, and the attempt has been running far longer than a checkout
        // can plausibly take. Releasing the key is safe here for the same reason
        // the reservation above is: a live attempt would have written its order
        // long before this threshold.
        await this.repos.idempotency.release(ORDER_IDEMPOTENCY_SCOPE, userId, record.key).catch(() => undefined);
        throw AppError.conflict('That previous submission did not finish. Please submit again.');
      }
    }
    if (record.state !== 'completed' || !record.resourceId) {
      throw AppError.conflict('That submission is already being processed.');
    }
    const existing = await this.repos.orders.findById(record.resourceId);
    if (!existing || existing.customerId !== userId) {
      // The record outlived the order (a `--fresh` reseed, say). Releasing it
      // lets the caller submit again instead of being permanently blocked.
      await this.repos.idempotency.release(ORDER_IDEMPOTENCY_SCOPE, userId, record.key).catch(() => undefined);
      throw AppError.conflict('That submission is no longer replayable. Please submit again.');
    }
    return this.receiptFor(userId, existing);
  }

  /**
   * M8: pick the atomicity the deployment can actually provide. The decision is
   * read off the bundle, so there is no way for a service to assume a transaction
   * the datastore is not offering.
   */
  private placeOrder(userId: string, input: CreateOrderInput, orderId: string): Promise<PlacedOrder> {
    if (this.repos.supportsTransactions) {
      return this.repos.transact((repos) => this.placeOrderWith(repos, userId, input, orderId));
    }
    return this.placeOrderWith(this.repos, userId, input, orderId);
  }

  /**
   * The M7 pipeline, parameterised by the bundle it must write through. When that
   * bundle is session-bound, every statement below is inside one transaction; when
   * it is not, the compensation path runs exactly as it did in M7.
   */
  private async placeOrderWith(
    repos: RepositoryBundle,
    userId: string,
    input: CreateOrderInput,
    orderId: string,
  ): Promise<PlacedOrder> {
    const cartService = new CartService(repos);
    const transactional = repos.supportsTransactions;
    const address = input.address;
    const deliveryMethod = input.deliveryMethod ?? DEFAULT_DELIVERY_METHOD;

    const storedCart = await repos.carts.findByUserId(userId);
    const selected = (storedCart?.items ?? []).filter((item) => item.selected);
    if (selected.length === 0) throw AppError.unprocessable('Your cart is empty.');

    // 1. Re-validate every line against live catalog state.
    const lines: CheckoutLine[] = [];
    const storesBySeller = new Map<string, StoreEntity>();
    for (const item of selected) {
      const product = await cartService.assertOrderable(userId, item);
      const variant = item.variantId ? product.variants.find((entry) => entry.id === item.variantId) : undefined;
      if (!storesBySeller.has(product.sellerId)) {
        const store = await repos.stores.findBySellerId(product.sellerId);
        if (!store) throw AppError.unprocessable('A store in your cart is no longer available.');
        storesBySeller.set(product.sellerId, store);
      }
      lines.push({
        item,
        product,
        variant,
        resolved: {
          product: product as SharedProduct,
          variant,
          sellerId: product.sellerId,
          selected: item.selected,
          quantity: item.quantity,
        },
      });
    }

    // 2. Re-price with the shared rules. Client totals are never read.
    const pricedGroups = groupLinesBySeller(
      lines.map((line) => line.resolved),
      (line) => (line.variant ? line.variant.price : effectivePrice(line.product)),
      (sellerId) => storesBySeller.get(sellerId),
    );
    const baseTotals = computeCartTotals(pricedGroups, null, countSelectedItems(selected));

    // 3. Voucher: re-check eligibility before honouring a submitted code.
    let voucher: VoucherEntity | null = null;
    let voucherCode: string | null = null;
    if (input.voucherCode) {
      const wanted = input.voucherCode.trim();
      const voucherInput = pricedGroups.map((group) => ({
        sellerId: group.sellerId,
        subtotal: group.subtotal,
        // The real fee keeps a `free_shipping` quote equal to what is actually
        // discounted further down, so eligibility and pricing cannot disagree.
        shippingFee: group.shippingFee,
        items: lines
          .filter((line) => line.resolved.sellerId === group.sellerId)
          .map((line) => ({
            selected: line.resolved.selected,
            sellerId: line.resolved.sellerId,
            productId: line.product.id,
            categoryId: line.product.categoryId,
          })),
      }));
      const quotes = evaluateVoucherQuotes(
        await repos.vouchers.list(),
        voucherInput,
        baseTotals.subtotal,
        userId,
        Date.now(),
      );
      const match = quotes.find((quote) => quote.voucher.code.toLowerCase() === wanted.toLowerCase());
      if (!match) throw AppError.unprocessable('That voucher code could not be found.');
      if (!match.valid) throw AppError.unprocessable(match.reason ?? 'This voucher cannot be applied.');
      voucher = match.voucher;
      voucherCode = match.voucher.code;
    }

    const totals = computeCartTotals(pricedGroups, voucher, baseTotals.itemCount);
    const delivery = quoteDeliveryForTotals(
      {
        shippingTotal: totals.shippingTotal,
        groups: pricedGroups.map((group) => ({
          items: lines
            .filter((line) => line.resolved.sellerId === group.sellerId)
            .map((line) => ({ selected: line.resolved.selected })),
        })),
      },
      deliveryMethod,
    );
    const checkout = checkoutTotals(totals, delivery);
    if (totals.itemCount === 0) throw AppError.unprocessable('Select at least one item.');

    // 4. Decrement stock before writing anything. In a transaction the whole unit
    // rolls back on failure; otherwise each earlier decrement is restored.
    const decremented: { productId: string; variantId: string | null; quantity: number }[] = [];
    for (const line of lines) {
      const result = await repos.products.adjustStock(
        line.product.id,
        -line.item.quantity,
        line.item.variantId ?? null,
      );
      if (!result.ok) {
        if (!transactional) await this.restoreStock(repos, decremented);
        throw AppError.unprocessable(`"${line.product.name}" does not have enough stock right now.`);
      }
      decremented.push({
        productId: line.product.id,
        variantId: line.item.variantId ?? null,
        quantity: -line.item.quantity,
      });
    }

    const timestamp = nowIso();
    const committed: { paymentId?: string } = {};
    const order: OrderEntity = {
      id: orderId,
      customerId: userId,
      orderCode: this.orderCode(timestamp),
      status: 'placed',
      sellerOrderIds: [],
      subtotal: totals.subtotal,
      shippingTotal: delivery.fee,
      vouchersDiscount: totals.voucherDiscount,
      total: checkout.grandTotal,
      paymentMethod: input.paymentMethod,
      paymentStatus: initialPaymentStatus(input.paymentMethod),
      deliveryMethod,
      shippingAddress: { ...address, userId },
      voucherCodes: voucherCode ? [voucherCode] : [],
      placedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      const sellerOrders: SellerOrderEntity[] = [];
      // Mirrors the app's split exactly (see `src/services/order-service.ts`): a
      // product discount is allocated by item-subtotal share, a free-shipping
      // concession by shipping share, and each share is subtracted from that
      // seller's total so the splits re-sum to the order total the buyer paid.
      const allocatesShipping = voucher?.type === 'free_shipping';
      const allocateTotal = allocatesShipping ? totals.shippingTotal : totals.subtotal;
      let discountUnallocated = totals.voucherDiscount;
      const lastIndex = pricedGroups.length - 1;
      for (const [groupIndex, group] of pricedGroups.entries()) {
        const store = storesBySeller.get(group.sellerId);
        if (!store) throw AppError.unprocessable('A store in your cart is no longer available.');
        const sellerLines = lines.filter((line) => line.resolved.sellerId === group.sellerId);
        // The final group absorbs the rounding remainder so the shares re-sum
        // exactly, with no stray amount unaccounted for.
        const voucherShare =
          groupIndex === lastIndex
            ? roundMoney(discountUnallocated)
            : roundMoney(
                totals.voucherDiscount *
                  ((allocatesShipping ? group.shippingFee : group.subtotal) / (allocateTotal || 1)),
              );
        discountUnallocated = roundMoney(discountUnallocated - voucherShare);
        const sellerOrder: SellerOrderEntity = {
          id: newId('sor'),
          orderId,
          sellerId: group.sellerId,
          storeId: store.id,
          storeName: store.name,
          storeLogo: store.logo,
          status: 'new',
          items: sellerLines.map((line) => this.snapshot(line)),
          subtotal: group.subtotal,
          shippingFee: group.shippingFee,
          vouchersDiscount: voucherShare,
          total: roundMoney(group.subtotal + group.shippingFee - voucherShare),
          shippingAddress: { ...address, userId },
          timeline: [{ status: 'new', at: timestamp }],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await repos.sellerOrders.insert(sellerOrder);
        sellerOrders.push(sellerOrder);
      }

      order.sellerOrderIds = sellerOrders.map((entry) => entry.id);
      order.status = deriveOrderStatus(sellerOrders);
      await repos.orders.insert(order);

      const payment: PaymentTransactionEntity = {
        id: newId('trx'),
        orderId,
        userId,
        method: input.paymentMethod,
        amount: checkout.grandTotal,
        status: order.paymentStatus,
        reference: paymentReference(input.paymentMethod, orderId, new Date(timestamp)),
        paidAt: order.paymentStatus === 'paid' ? timestamp : undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await repos.payments.insert(payment);
      committed.paymentId = payment.id;

      for (const entry of decremented) {
        const line = lines.find((candidate) => candidate.product.id === entry.productId);
        const adjustment: InventoryAdjustmentEntity = {
          id: newId('adj'),
          productId: entry.productId,
          sellerId: line?.product.sellerId ?? '',
          variantId: entry.variantId,
          quantity: entry.quantity,
          reason: 'sale',
          referenceId: orderId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await repos.inventoryAdjustments.insert(adjustment);
      }

      if (voucher) await repos.vouchers.markUsed(voucher.id, userId, timestamp);

      for (const sellerOrder of sellerOrders) {
        await this.notifySeller(
          repos,
          sellerOrder.sellerId,
          'seller_new_order',
          'New order received',
          `Order ${order.orderCode} needs your confirmation.`,
          { orderId, sellerOrderId: sellerOrder.id },
        );
      }
      await this.notify(
        repos,
        userId,
        'order_placed',
        'Order placed',
        `Order ${order.orderCode} is on its way.`,
        { orderId },
      );

      await repos.carts.clearSelected(userId);

      return { order, sellerOrders, payment };
    } catch (error) {
      // Outside a transaction, undo every write made after the stock decrement,
      // newest first, so a failure halfway through leaves neither stock movement
      // nor a partial order. Inside one, the driver has already rolled back and
      // compensation would be actively wrong.
      if (!transactional) {
        await this.compensate(repos, {
          orderId,
          sellerOrderIds: order.sellerOrderIds,
          paymentId: committed.paymentId,
          decremented,
        });
      }
      throw error;
    }
  }

  /**
   * An `in_flight` claim this old, with no order behind it, is treated as dead.
   *
   * Checkout is a handful of indexed writes; a minute is not a slow checkout, it
   * is a process that died between the claim and the commit. Below this threshold
   * the ambiguity is unresolvable, so the key is left alone and the caller is told
   * to wait — wrongly releasing a live claim would let a second order through.
   */
  private static isAbandoned(record: IdempotencyRecordEntity): boolean {
    const startedAt = Date.parse(record.createdAt);
    if (!Number.isFinite(startedAt)) return false;
    return Date.now() - startedAt > ABANDONED_CLAIM_MS;
  }

  /**
   * M8: a stable hash of everything that defines "the same order".
   *
   * Only fields the server acts on are included — the address as sent, the payment
   * and delivery methods, and the voucher code. A retry that changes nothing
   * replays; a retry that changes the address is a different order and is refused.
   * Sorted address keys keep the hash stable regardless of key order.
   */
  private static fingerprint(
    userId: string,
    input: CreateOrderInput,
    address: AddressEntity,
    deliveryMethod: DeliveryMethodId,
  ): string {
    const canonical = JSON.stringify({
      userId,
      paymentMethod: input.paymentMethod,
      deliveryMethod,
      voucherCode: input.voucherCode?.trim() ?? null,
      address: Object.keys(address)
        .filter((key) => key !== 'userId')
        .sort()
        .map((key) => [key, (address as unknown as Record<string, unknown>)[key] ?? null]),
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  /** Undo a partially-applied checkout. Never throws: it runs on the failure path. */
  private async compensate(
    repos: RepositoryBundle,
    input: {
      orderId: string;
      sellerOrderIds: string[];
      paymentId?: string;
      decremented: { productId: string; variantId: string | null; quantity: number }[];
    },
  ): Promise<void> {
    const safe = async (step: () => Promise<unknown>): Promise<void> => {
      try {
        await step();
      } catch (error) {
        console.error('[orders] compensation step failed:', error instanceof Error ? error.message : error);
      }
    };
    if (input.paymentId) await safe(() => repos.payments.delete(input.paymentId!));
    for (const sellerOrderId of [...input.sellerOrderIds].reverse()) {
      await safe(() => repos.sellerOrders.delete(sellerOrderId));
    }
    await safe(() => repos.orders.delete(input.orderId));
    await safe(() => repos.inventoryAdjustments.deleteForReference(input.orderId));
    await this.restoreStock(repos, input.decremented);
  }

  private snapshot(line: CheckoutLine): OrderItemSnapshot {
    const unitPrice = line.variant ? line.variant.price : effectivePrice(line.product as SharedProduct);
    return {
      id: newId('oit'),
      productId: line.product.id,
      productName: line.product.name,
      brand: line.product.brand,
    image: line.product.images[0] ?? '',
    // The variant actually bought, so cancellation credits the right variant
    // instead of the product-level aggregate.
    variantId: line.variant?.id,
    variantAttributes: line.variant?.attributes,
      unitPrice,
      discount: 0,
      quantity: line.item.quantity,
      subtotal: lineSubtotal(unitPrice, line.item.quantity),
      status: 'pending',
      reviewId: null,
      hasReview: false,
      returnRequestId: null,
    };
  }

  private orderCode(at: string): string {
    const digits = at.replace(/\D/g, '').slice(4, 14);
    const suffix = Math.floor(Math.random() * 90 + 10);
    return `ORD-${digits}${suffix}`;
  }

  private async restoreStock(
    repos: RepositoryBundle,
    entries: { productId: string; variantId: string | null; quantity: number }[],
  ): Promise<void> {
    for (const entry of entries) {
      await repos.products.adjustStock(entry.productId, -entry.quantity, entry.variantId);
    }
  }

  private resolveAddress(incoming: AddressEntity): AddressEntity {
    const required: [keyof AddressEntity, string][] = [
      ['recipientName', 'Recipient name'],
      ['phone', 'Phone number'],
      ['division', 'Division'],
      ['district', 'District'],
      ['addressLine', 'Address'],
    ];
    const fields = required
      .filter(([key]) => {
        const value = incoming[key];
        return typeof value !== 'string' || value.trim() === '';
      })
      .map(([key, message]) => ({ field: String(key), message: `${message} is required.` }));
    if (fields.length > 0) throw AppError.validation('Please fix the highlighted fields.', fields);
    // Ownership is always the authenticated caller, never the request body.
    return { ...incoming, userId: '' };
  }

  private async notify(
    repos: RepositoryBundle,
    userId: string,
    type: NotificationEntity['type'],
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<void> {
    const timestamp = nowIso();
    await repos.notifications.insert({
      id: newId('ntf'),
      userId,
      type,
      title,
      body,
      read: false,
      data,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  /**
   * Notifications are addressed to a user account, not to a seller profile, so the
   * seller id is resolved to its owner first. Without this a seller would never see
   * the notification, because the seller's profile id is not their user id.
   */
  private async notifySeller(
    repos: RepositoryBundle,
    sellerId: string,
    type: NotificationEntity['type'],
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<void> {
    const seller = await repos.sellers.findById(sellerId);
    if (!seller) return;
    await this.notify(repos, seller.userId, type, title, body, data);
  }

  private async receiptFor(userId: string, order: OrderEntity): Promise<OrderReceipt> {
    const sellerOrders = await this.repos.sellerOrders.listForOrder(order.id);
    const [payment] = await this.repos.payments.listForOrder(order.id);
    return { order, sellerOrders, payment, cart: await this.cartService.priceCart(userId) };
  }

  async listForCustomer(userId: string): Promise<OrderEntity[]> {
    return this.repos.orders.listForCustomer(userId);
  }

  /** A customer can only ever read their own order; anyone else gets 404. */
  async getForCustomer(
    userId: string,
    orderId: string,
  ): Promise<{ order: OrderEntity; sellerOrders: SellerOrderEntity[]; payment: PaymentTransactionEntity[] }> {
    const order = await this.repos.orders.findById(orderId);
    if (!order || order.customerId !== userId) throw AppError.notFound('Order not found.');
    return {
      order,
      sellerOrders: await this.repos.sellerOrders.listForOrder(order.id),
      payment: await this.repos.payments.listForOrder(order.id),
    };
  }

  async cancelOrder(userId: string, orderId: string, reason: string): Promise<OrderEntity> {
    if (!reason.trim()) {
      throw AppError.validation('Tell the seller why you cancelled.', [
        { field: 'reason', message: 'Tell the seller why you cancelled.' },
      ]);
    }
    const order = await this.repos.orders.findById(orderId);
    if (!order || order.customerId !== userId) throw AppError.notFound('Order not found.');
    if (!CANCELLABLE_STATUSES.includes(order.status)) {
      throw AppError.unprocessable('This order can no longer be cancelled. Contact the seller for a return.');
    }
    const timestamp = nowIso();
    for (const sellerOrder of await this.repos.sellerOrders.listForOrder(order.id)) {
      await this.repos.sellerOrders.patch(sellerOrder.id, {
        status: 'cancelled',
        timeline: [...sellerOrder.timeline, { status: 'cancelled', at: timestamp }],
        updatedAt: timestamp,
      });
      for (const item of sellerOrder.items) {
        const product = await this.repos.products.findById(item.productId);
        if (!product) continue;
        await this.repos.products.adjustStock(item.productId, item.quantity, item.variantId ?? null);
        await this.repos.inventoryAdjustments.insert({
          id: newId('adj'),
          productId: item.productId,
          sellerId: product.sellerId,
          variantId: item.variantId ?? null,
          quantity: item.quantity,
          reason: 'cancellation',
          referenceId: order.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }
    const updated = await this.repos.orders.patch(order.id, {
      status: 'cancelled',
      cancelledAt: timestamp,
      updatedAt: timestamp,
    });
    if (!updated) throw AppError.notFound('Order not found.');
    return updated;
  }

  /** Seller-side fulfilment advance; ownership-checked against the token. */
  async advanceSellerOrder(sellerId: string, sellerOrderId: string): Promise<SellerOrderEntity> {
    const sellerOrder = await this.repos.sellerOrders.findById(sellerOrderId);
    if (!sellerOrder || sellerOrder.sellerId !== sellerId) throw AppError.notFound('Order not found.');
    const next = SELLER_STATUS_FLOW[SELLER_STATUS_FLOW.indexOf(sellerOrder.status) + 1];
    if (!next) throw AppError.unprocessable('This order can no longer be updated.');
    const timestamp = nowIso();
    const updated = await this.repos.sellerOrders.patch(sellerOrderId, {
      status: next,
      timeline: [...sellerOrder.timeline, { status: next, at: timestamp }],
      fulfilledAt: next === 'delivered' ? timestamp : sellerOrder.fulfilledAt,
      updatedAt: timestamp,
    });
    if (!updated) throw AppError.notFound('Order not found.');
    const siblings = await this.repos.sellerOrders.listForOrder(sellerOrder.orderId);
    await this.repos.orders.patch(sellerOrder.orderId, {
      status: deriveOrderStatus(siblings),
      deliveredAt: siblings.every((entry) => entry.status === 'delivered') ? timestamp : undefined,
      updatedAt: timestamp,
    });
    return updated;
  }
}
