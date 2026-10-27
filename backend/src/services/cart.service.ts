/**
 * Priced cart (M7-J / M7-K).
 *
 * This is the server's answer to "what does this cart cost right now". It
 * resolves cart lines against the catalog, applies the *shared* visibility,
 * grouping, voucher and delivery rules, and returns the same view the cart
 * screen renders. Order creation consumes this same function, which is why a
 * client cannot talk the server into a different total.
 */
import { customerVisibility, effectivePrice, lineAvailability, productStock } from '../../../shared/catalog-rules';
import { computeCartTotals, countSelectedItems, groupLinesBySeller, lineSubtotal } from '../../../shared/pricing';
import {
  DEFAULT_DELIVERY_METHOD,
  checkoutTotals,
  isDeliveryMethod,
  quoteDeliveryForTotals,
  type DeliveryMethodId,
  type DeliveryQuote,
} from '../../../shared/delivery';
import { evaluateVoucherQuotes, type VoucherQuote } from '../../../shared/voucher-rules';
import type { CatalogLookups, ResolvedCartLine, SharedProduct } from '../../../shared/types';
import { AppError } from '../http/errors';
import { newId } from '../lib/identity';
import type {
  CartEntity,
  CartItemEntity,
  ProductEntity,
  StoreEntity,
  VoucherEntity,
} from '../domain/entities';
import type { RepositoryBundle } from '../repositories/contracts';

export interface PricedCartLine {
  id: string;
  productId: string;
  variantId?: string;
  sellerId: string;
  storeId: string;
  name: string;
  image: string;
  quantity: number;
  selected: boolean;
  unitPrice: number;
  subtotal: number;
  available: boolean;
  unavailableReason: string | null;
}

export interface PricedSellerGroup {
  sellerId: string;
  storeId: string;
  storeName: string;
  items: PricedCartLine[];
  subtotal: number;
  shippingFee: number;
  freeShipping: boolean;
}

export interface PricedCart {
  cartId: string;
  userId: string;
  items: PricedCartLine[];
  groups: PricedSellerGroup[];
  subtotal: number;
  shippingTotal: number;
  voucherDiscount: number;
  grandTotal: number;
  itemCount: number;
  delivery: DeliveryQuote;
  checkout: { subtotal: number; voucherDiscount: number; deliveryFee: number; grandTotal: number };
  vouchers: VoucherQuote<VoucherEntity>[];
  selectedVoucherCode: string | null;
}

export class CartService {
  constructor(private readonly repos: RepositoryBundle) {}

  private async resolveLine(
    item: CartItemEntity,
  ): Promise<{ product: ProductEntity; store: StoreEntity | null; line: PricedCartLine; resolved: ResolvedCartLine } | null> {
    const product = await this.repos.products.findById(item.productId);
    if (!product) return null;
    const store = await this.repos.stores.findBySellerId(product.sellerId);
    const variant = item.variantId ? product.variants.find((entry) => entry.id === item.variantId) : undefined;
    const seller = await this.repos.sellers.findById(product.sellerId);
    const lookups: CatalogLookups = {
      getStoreById: () => store as never,
      getStoreBySellerId: () => store as never,
      getSellerById: () => seller as never,
    };
    const availability = lineAvailability(product as SharedProduct, variant, item.quantity, lookups);
    const unitPrice = variant ? variant.price : effectivePrice(product as SharedProduct);
    const line: PricedCartLine = {
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      sellerId: product.sellerId,
      storeId: product.storeId,
      name: product.name,
      image: product.images[0] ?? '',
      quantity: item.quantity,
      selected: item.selected,
      unitPrice,
      subtotal: lineSubtotal(unitPrice, item.quantity),
      available: availability.available,
      unavailableReason: availability.reason,
    };
    return {
      product,
      store,
      line,
      resolved: { product: product as SharedProduct, variant, sellerId: product.sellerId, selected: item.selected, quantity: item.quantity },
    };
  }

  /** Full priced view of a user's cart, with voucher quotes attached. */
  async priceCart(userId: string, options: { deliveryMethod?: DeliveryMethodId } = {}): Promise<PricedCart> {
    const cart = (await this.repos.carts.findByUserId(userId)) ?? buildEmptyCart(userId);
    const resolved = [] as {
      product: ProductEntity;
      store: StoreEntity | null;
      line: PricedCartLine;
      resolved: ResolvedCartLine;
    }[];
    for (const item of cart.items) {
      const entry = await this.resolveLine(item);
      if (entry) resolved.push(entry);
    }

    const items = resolved.map((entry) => entry.line);
    const pricedGroups = groupLinesBySeller(
      resolved.map((entry) => entry.resolved),
      (line) => (line.variant ? line.variant.price : effectivePrice(line.product)),
      (sellerId) => resolved.find((entry) => entry.product.sellerId === sellerId)?.store ?? undefined,
    );

    const groups: PricedSellerGroup[] = [];
    for (const group of pricedGroups) {
      const sellerItems = resolved.filter((entry) => entry.product.sellerId === group.sellerId);
      const first = sellerItems[0];
      groups.push({
        sellerId: group.sellerId,
        storeId: first?.product.storeId ?? '',
        storeName: first?.store?.name ?? '',
        items: sellerItems.map((entry) => entry.line),
        subtotal: group.subtotal,
        shippingFee: group.shippingFee,
        freeShipping: group.freeShipping,
      });
    }

    const voucherInput = groups.map((group) => ({
      sellerId: group.sellerId,
      subtotal: group.subtotal,
      items: group.items.map((line) => ({
        selected: line.selected,
        sellerId: line.sellerId,
        productId: line.productId,
        categoryId: resolved.find((entry) => entry.line.id === line.id)?.product.categoryId ?? '',
      })),
    }));

    const deliveryMethod = isDeliveryMethod(options.deliveryMethod) ? options.deliveryMethod : DEFAULT_DELIVERY_METHOD;
    const baseTotals = computeCartTotals(pricedGroups, null, countSelectedItems(cart.items));
    const vouchers = await this.repos.vouchers.list();
    const quotes = evaluateVoucherQuotes(vouchers, voucherInput, baseTotals.subtotal, userId, Date.now());
    const delivery = quoteDeliveryForTotals(
      { shippingTotal: baseTotals.shippingTotal, groups: groups.map((group) => ({ items: group.items })) },
      deliveryMethod,
    );

    return {
      cartId: cart.id,
      userId,
      items,
      groups,
      subtotal: baseTotals.subtotal,
      shippingTotal: baseTotals.shippingTotal,
      voucherDiscount: 0,
      grandTotal: baseTotals.grandTotal,
      itemCount: baseTotals.itemCount,
      delivery,
      checkout: checkoutTotals(baseTotals, delivery),
      vouchers: quotes,
      selectedVoucherCode: null,
    };
  }

  async addItem(
    userId: string,
    input: { productId: string; quantity: number; variantId?: string },
  ): Promise<PricedCart> {
    const product = await this.repos.products.findById(input.productId);
    if (!product) throw AppError.notFound('This listing is no longer available.');
    const store = await this.repos.stores.findBySellerId(product.sellerId);
    const seller = await this.repos.sellers.findById(product.sellerId);
    const variant = input.variantId ? product.variants.find((entry) => entry.id === input.variantId) : undefined;
    if (input.variantId && !variant) throw AppError.notFound('That option is no longer available.');

    const lookups: CatalogLookups = {
      getStoreById: () => store as never,
      getStoreBySellerId: () => store as never,
      getSellerById: () => seller as never,
    };
    const quantity = Math.max(1, Math.floor(input.quantity));
    const availability = lineAvailability(product as SharedProduct, variant, quantity, lookups);
    if (!availability.available) {
      throw AppError.unprocessable(availability.reason ?? 'This item cannot be added right now.', [
        { field: 'quantity', message: availability.reason ?? 'This item cannot be added right now.' },
      ]);
    }

    const cart = await this.repos.carts.findByUserId(userId);
    const existing = cart?.items.find(
      (item) => item.productId === input.productId && (item.variantId ?? undefined) === (input.variantId ?? undefined),
    );
    if (existing) {
      const nextQuantity = existing.quantity + quantity;
      const recheck = lineAvailability(product as SharedProduct, variant, nextQuantity, lookups);
      if (!recheck.available) {
        throw AppError.unprocessable(recheck.reason ?? 'Only the remaining stock can be added.', [
          { field: 'quantity', message: recheck.reason ?? 'Only the remaining stock can be added.' },
        ]);
      }
      await this.repos.carts.patchItem(userId, existing.id, { quantity: nextQuantity });
    } else {
      const addedAt = new Date().toISOString();
      await this.repos.carts.addItem(userId, {
        id: newId('cti'),
        productId: product.id,
        sellerId: product.sellerId,
        variantId: variant?.id,
        variantAttributes: variant?.attributes,
        quantity,
        selected: true,
        priceSnapshot: variant ? variant.price : effectivePrice(product as SharedProduct),
        addedAt,
        updatedAt: addedAt,
      });
    }
    return this.priceCart(userId);
  }

  async patchItem(
    userId: string,
    itemId: string,
    patch: { quantity?: number; selected?: boolean },
  ): Promise<PricedCart> {
    const cart = await this.repos.carts.findByUserId(userId);
    const existing = cart?.items.find((item) => item.id === itemId);
    if (!existing) throw AppError.notFound('That item is no longer in your cart.');

    if (patch.quantity !== undefined) {
      const product = await this.repos.products.findById(existing.productId);
      if (!product) throw AppError.notFound('That item is no longer in your cart.');
      const store = await this.repos.stores.findBySellerId(product.sellerId);
      const seller = await this.repos.sellers.findById(product.sellerId);
      const variant = existing.variantId
        ? product.variants.find((entry) => entry.id === existing.variantId)
        : undefined;
      const lookups: CatalogLookups = {
        getStoreById: () => store as never,
        getStoreBySellerId: () => store as never,
        getSellerById: () => seller as never,
      };
      const quantity = Math.max(1, Math.floor(patch.quantity));
      const availability = lineAvailability(product as SharedProduct, variant, quantity, lookups);
      if (!availability.available) {
        throw AppError.unprocessable(availability.reason ?? 'That quantity is not available.', [
          { field: 'quantity', message: availability.reason ?? 'That quantity is not available.' },
        ]);
      }
      await this.repos.carts.patchItem(userId, itemId, { quantity });
    } else {
      await this.repos.carts.patchItem(userId, itemId, patch as Partial<CartItemEntity>);
    }
    return this.priceCart(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<PricedCart> {
    const cart = await this.repos.carts.findByUserId(userId);
    if (!cart?.items.some((item) => item.id === itemId)) {
      throw AppError.notFound('That item is no longer in your cart.');
    }
    await this.repos.carts.removeItem(userId, itemId);
    return this.priceCart(userId);
  }

  async clear(userId: string): Promise<PricedCart> {
    await this.repos.carts.clearSelected(userId);
    return this.priceCart(userId);
  }

  /** Shared visibility helper so order creation reuses the exact same gate. */
  async assertOrderable(userId: string, item: CartItemEntity): Promise<ProductEntity> {
    const product = await this.repos.products.findById(item.productId);
    if (!product) throw AppError.unprocessable('A product in your cart is no longer available.');
    const store = await this.repos.stores.findBySellerId(product.sellerId);
    const seller = await this.repos.sellers.findById(product.sellerId);
    const lookups: CatalogLookups = {
      getStoreById: () => store as never,
      getStoreBySellerId: () => store as never,
      getSellerById: () => seller as never,
    };
    const variant = item.variantId ? product.variants.find((entry) => entry.id === item.variantId) : undefined;
    if (!customerVisibility(product as SharedProduct, lookups).visible) {
      throw AppError.unprocessable(`"${product.name}" cannot be ordered right now. Remove it from your cart to continue.`);
    }
    const stock = variant ? variant.stock : productStock(product as SharedProduct);
    if (stock < item.quantity) {
      throw AppError.unprocessable(
        stock <= 0
          ? `"${product.name}" does not have enough stock right now.`
          : `"${product.name}" does not have enough stock — only ${stock} left.`,
      );
    }
    return product;
  }
}

function buildEmptyCart(userId: string): CartEntity {
  const now = new Date().toISOString();
  return { id: `cart_${userId}`, userId, items: [], createdAt: now, updatedAt: now };
}
