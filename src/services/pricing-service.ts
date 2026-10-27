import type { Product, ProductVariant, Store, Voucher, CartItem } from '@/domain/types';
import { getContainer } from '@/infrastructure/container';
import { effectivePrice } from './catalog-service';
import { roundMoney } from '@/utils/money';
import {
  countSelectedItems,
  computeCartTotals,
  groupLinesBySeller,
} from '@shared/pricing';
import { lineAvailability as sharedLineAvailability } from '@shared/catalog-rules';
import type { CatalogLookups, ResolvedCartLine } from '@shared/types';

export interface CartLineView {
  id: string;
  cart: CartItem;
  product: Product;
  variant?: ProductVariant;
  store: Store;
  quantity: number;
  selected: boolean;
  unitPrice: number;
  subtotal: number;
  available: boolean;
  unavailableReason: string | null;
}

function catalogLookups(): CatalogLookups {
  const { repositories } = getContainer();
  return {
    getStoreById: (id) => repositories.stores.getById(id),
    getStoreBySellerId: (sellerId) => repositories.stores.getBySellerId(sellerId),
    getSellerById: (id) => repositories.sellers.getById(id),
  };
}

export function lineAvailability(
  product: Product,
  variant: ProductVariant | undefined,
  quantity: number,
): { available: boolean; reason: string | null } {
  return sharedLineAvailability(product, variant, quantity, catalogLookups());
}

export interface SellerGroupView {
  sellerId: string;
  store: Store;
  items: CartLineView[];
  subtotal: number;
  shippingFee: number;
  freeShipping: boolean;
}

export interface CartTotals {
  groups: SellerGroupView[];
  subtotal: number;
  shippingTotal: number;
  voucherDiscount: number;
  grandTotal: number;
  itemCount: number;
  voucher: Voucher | null;
}

const FREE_SHIPPING_BELOW_FEE = 0;

export function buildGroups(items: CartItem[]): SellerGroupView[] {
  const { repositories } = getContainer();
  const lines: ResolvedCartLine<Product>[] = [];
  const views: CartLineView[] = [];

  for (const item of items) {
    const product = repositories.products.getById(item.productId);
    if (!product) continue;
    const store = repositories.stores.getBySellerId(product.sellerId);
    if (!store) continue;
    const variant = item.variantId
      ? product.variants.find((v) => v.id === item.variantId)
      : undefined;
    const unitPrice = variant ? variant.price : effectivePrice(product);
    const availability = lineAvailability(product, variant, item.quantity);
    views.push({
      id: item.id,
      cart: item,
      product,
      variant,
      store,
      quantity: item.quantity,
      selected: item.selected,
      unitPrice,
      subtotal: roundMoney(unitPrice * item.quantity),
      available: availability.available,
      unavailableReason: availability.reason,
    });
    lines.push({
      product,
      variant,
      sellerId: product.sellerId,
      selected: item.selected,
      quantity: item.quantity,
    });
  }

  const priced = groupLinesBySeller(
    lines,
    (line) => (line.variant ? line.variant.price : effectivePrice(line.product)),
    (sellerId) => repositories.stores.getBySellerId(sellerId),
  );
  const pricingBySeller = new Map(priced.map((group) => [group.sellerId, group]));

  const bySeller = new Map<string, CartLineView[]>();
  for (const view of views) {
    const group = bySeller.get(view.product.sellerId);
    if (group) group.push(view);
    else bySeller.set(view.product.sellerId, [view]);
  }

  const groups: SellerGroupView[] = [];
  for (const [sellerId, sellerLines] of bySeller) {
    const store = sellerLines[0].store;
    const pricing = pricingBySeller.get(sellerId);
    const subtotal = roundMoney(
      sellerLines.filter((l) => l.selected).reduce((sum, l) => sum + l.subtotal, 0),
    );
    const freeShipping = pricing?.freeShipping ?? false;
    groups.push({
      sellerId,
      store,
      items: sellerLines,
      subtotal,
      shippingFee: pricing?.shippingFee ?? FREE_SHIPPING_BELOW_FEE,
      freeShipping,
    });
  }
  return groups;
}

export function computeTotals(items: CartItem[], voucher: Voucher | null = null): CartTotals {
  const groups = buildGroups(items);
  const totals = computeCartTotals(groups, voucher, countSelectedItems(items));
  return { groups, ...totals, voucher };
}
