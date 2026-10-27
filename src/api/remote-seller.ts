/**
 * Remote seller workspace bridge (M14-remote).
 *
 * In remote mode the API is the datastore, but the seller screens read the
 * on-device database synchronously (products, orders, returns, reviews,
 * vouchers, inventory). This module closes that gap the same way
 * `remote-hydration` does for the public catalogue: it maps the server's seller
 * DTOs onto the device entities and writes them into the local mirror, so every
 * existing seller screen keeps working unchanged.
 *
 * It also exposes single-record upserts, which the seller write paths use after
 * a successful API mutation so the mirror reflects the server's answer without a
 * full round trip.
 *
 * The mirror is a cache; the server is the source of truth. Nothing here invents
 * seller state — every field comes from a `/seller/*` response.
 */
import type {
  Address,
  CollectionKey,
  InventoryAdjustment,
  Order,
  OrderItemSnapshot,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Product,
  ProductVariant,
  ReturnReason,
  ReturnRequest,
  Review,
  SellerOrder,
  SellerOrderTimelineEntry,
  SellerProfile,
  SellerStatus,
  SellerType,
  Store,
  Voucher,
} from '@/domain/types';
import { getContainer } from '@/infrastructure/container';
import { vantaApi } from './vanta-api';

export interface SellerProfileDto {
  id: string;
  userId: string;
  storeId: string | null;
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  sellerType: SellerType;
  entityName: string;
  pickupDivision: string;
  pickupDistrict: string;
  pickupArea: string;
  pickupAddressLine: string;
  returnDivision: string;
  returnDistrict: string;
  returnArea: string;
  returnAddressLine: string;
  bank: { bankName: string; accountName: string; accountNumber: string; branch?: string };
  agreement: {
    marketplaceTerms: boolean;
    sellerPolicies: boolean;
    productAuthenticity: boolean;
    fulfillmentResponsibility: boolean;
  };
  status: SellerStatus;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StoreDto {
  id: string;
  sellerId: string;
  name: string;
  description: string;
  logo: string;
  banner: string;
  status: Store['status'];
  ratingAvg: number;
  ratingCount: number;
  responseRate: number;
  responseTimeMinutes: number;
  productCount: number;
  followerCount: number;
  shippingFee: number;
  freeShippingThreshold: number;
  deliveryEstimateDays: { min: number; max: number };
  location: string;
  verified: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface VariantDto {
  id: string;
  productId: string;
  sku: string;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  stock: number;
  image: string;
}

export interface ProductDto {
  id: string;
  sellerId: string;
  storeId: string;
  name: string;
  brand: string;
  categoryId: string;
  subcategoryId: string | null;
  description: string;
  highlights: string[];
  images: string[];
  video: { placeholder?: string; uri?: string } | null;
  regularPrice: number;
  salePrice: number | null;
  costPrice: number | null;
  sku: string;
  stock: number;
  lowStockThreshold: number;
  hasVariants: boolean;
  variants: VariantDto[];
  status: Product['status'];
  publishedAt: string | null;
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
  viewCount: number;
  isNewArrival: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AdjustmentDto {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  reason: string;
  referenceId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AddressDto {
  label?: string;
  recipientName?: string;
  phone?: string;
  division?: string;
  district?: string;
  area?: string;
  addressLine?: string;
  postalCode?: string;
  instructions?: string;
  isDefault?: boolean;
}

export interface SellerOrderItemDto {
  id: string;
  productId: string;
  productName: string;
  brand: string;
  image: string;
  variantId: string | null;
  variantAttributes: Record<string, string> | null;
  unitPrice: number;
  discount: number;
  quantity: number;
  subtotal: number;
  status: OrderItemSnapshot['status'];
  reviewId: string | null;
  hasReview: boolean;
  returnRequestId: string | null;
}

export interface SellerOrderViewDto {
  id: string;
  orderId: string;
  sellerId: string;
  storeId: string;
  storeName: string;
  storeLogo: string;
  status: string;
  items: SellerOrderItemDto[];
  subtotal: number;
  shippingFee: number;
  vouchersDiscount: number;
  total: number;
  shippingAddress: AddressDto | null;
  carrier: string;
  trackingNumber: string;
  timeline: { status: string; at: string | null }[];
  fulfilledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  order: {
    id: string;
    orderCode: string;
    status: string;
    paymentMethod: string;
    paymentStatus: string;
    total: number;
    placedAt: string | null;
    shippingAddress: AddressDto | null;
  } | null;
}

export interface ReturnDto {
  id: string;
  orderId: string;
  sellerOrderId: string;
  orderItemId: string;
  userId: string;
  sellerId: string;
  productName: string;
  quantity: number | null;
  reason: string;
  description: string;
  images: string[];
  preferredResolution: ReturnRequest['preferredResolution'];
  status: ReturnRequest['status'];
  timeline: { status: string; at: string | null }[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ReviewDto {
  id: string;
  userId: string;
  userName: string;
  productId: string;
  sellerId: string;
  orderId: string;
  orderItemId: string;
  rating: number;
  title: string;
  text: string;
  images: string[];
  verifiedPurchase: boolean;
  sellerReply: { text: string; at: string | null } | null;
  helpfulCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface VoucherDto {
  id: string;
  code: string;
  title: string;
  type: Voucher['type'];
  discountValue: number;
  minimumOrder: number;
  maximumDiscount: number | null;
  scope: Voucher['scope'];
  sellerId: string | null;
  categoryId: string | null;
  productIds: string[];
  startAt: string;
  expiry: string;
  usageLimit: number | null;
  usageCount: number;
  perUserLimit: number | null;
  active: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
}

const nowIso = (): string => new Date().toISOString();

function upsert(key: CollectionKey, entity: object & { id: string }): void {
  getContainer().db.upsert(key, entity as { id: string } & Record<string, unknown>);
}

// ---------------------------------------------------------------- mappers

export function mapSellerProfile(dto: SellerProfileDto): SellerProfile {
  const stamp = dto.createdAt ?? nowIso();
  return {
    id: dto.id,
    userId: dto.userId,
    storeId: dto.storeId ?? '',
    fullName: dto.fullName,
    phone: dto.phone,
    email: dto.email,
    nationalId: dto.nationalId,
    sellerType: dto.sellerType,
    entityName: dto.entityName || undefined,
    pickupDivision: dto.pickupDivision,
    pickupDistrict: dto.pickupDistrict,
    pickupArea: dto.pickupArea,
    pickupAddressLine: dto.pickupAddressLine,
    returnDivision: dto.returnDivision,
    returnDistrict: dto.returnDistrict,
    returnArea: dto.returnArea,
    returnAddressLine: dto.returnAddressLine,
    bank: {
      bankName: dto.bank?.bankName ?? '',
      accountName: dto.bank?.accountName ?? '',
      accountNumber: dto.bank?.accountNumber ?? '',
      branch: dto.bank?.branch || undefined,
    },
    agreement: {
      marketplaceTerms: dto.agreement?.marketplaceTerms === true,
      sellerPolicies: dto.agreement?.sellerPolicies === true,
      productAuthenticity: dto.agreement?.productAuthenticity === true,
      fulfillmentResponsibility: dto.agreement?.fulfillmentResponsibility === true,
    },
    status: dto.status,
    createdAt: stamp,
    updatedAt: dto.updatedAt ?? stamp,
  };
}

export function mapStore(dto: StoreDto): Store {
  const stamp = dto.createdAt ?? nowIso();
  return {
    id: dto.id,
    sellerId: dto.sellerId,
    name: dto.name,
    description: dto.description,
    logo: dto.logo,
    banner: dto.banner,
    status: dto.status,
    ratingAvg: dto.ratingAvg,
    ratingCount: dto.ratingCount,
    responseRate: dto.responseRate,
    responseTimeMinutes: dto.responseTimeMinutes,
    productCount: dto.productCount,
    followerCount: dto.followerCount,
    shippingFee: dto.shippingFee,
    freeShippingThreshold: dto.freeShippingThreshold,
    deliveryEstimateDays: {
      min: dto.deliveryEstimateDays?.min ?? 2,
      max: dto.deliveryEstimateDays?.max ?? 4,
    },
    location: dto.location,
    verified: dto.verified,
    createdAt: stamp,
    updatedAt: dto.updatedAt ?? stamp,
  };
}

export function mapProduct(dto: ProductDto): Product {
  const stamp = dto.createdAt ?? nowIso();
  const variants: ProductVariant[] = (dto.variants ?? []).map((variant) => ({
    id: variant.id,
    productId: variant.productId || dto.id,
    sku: variant.sku,
    attributes: { ...variant.attributes },
    price: variant.price,
    compareAtPrice: variant.compareAtPrice ?? undefined,
    stock: variant.stock,
    image: variant.image || undefined,
    createdAt: stamp,
    updatedAt: dto.updatedAt ?? stamp,
  }));
  return {
    id: dto.id,
    sellerId: dto.sellerId,
    storeId: dto.storeId,
    name: dto.name,
    brand: dto.brand,
    categoryId: dto.categoryId,
    subcategoryId: dto.subcategoryId,
    description: dto.description,
    highlights: [...(dto.highlights ?? [])],
    images: [...(dto.images ?? [])],
    video: dto.video ?? null,
    regularPrice: dto.regularPrice,
    salePrice: dto.salePrice ?? undefined,
    costPrice: dto.costPrice ?? undefined,
    sku: dto.sku,
    stock: dto.stock,
    lowStockThreshold: dto.lowStockThreshold,
    variants,
    hasVariants: dto.hasVariants,
    status: dto.status,
    publishedAt: dto.publishedAt ?? undefined,
    ratingAvg: dto.ratingAvg,
    ratingCount: dto.ratingCount,
    soldCount: dto.soldCount,
    viewCount: dto.viewCount,
    isNewArrival: dto.isNewArrival,
    createdAt: stamp,
    updatedAt: dto.updatedAt ?? stamp,
  };
}

export function mapAdjustment(dto: AdjustmentDto): InventoryAdjustment {
  const stamp = dto.createdAt ?? nowIso();
  return {
    id: dto.id,
    productId: dto.productId,
    variantId: dto.variantId ?? null,
    quantity: dto.quantity,
    reason: dto.reason as InventoryAdjustment['reason'],
    referenceId: dto.referenceId ?? undefined,
    createdAt: stamp,
    updatedAt: dto.updatedAt ?? stamp,
  };
}

function mapAddress(dto: AddressDto | null, owner: string, stamp: string): Address {
  return {
    id: `addr_${owner}`,
    userId: '',
    label: dto?.label ?? '',
    recipientName: dto?.recipientName ?? '',
    phone: dto?.phone ?? '',
    division: dto?.division ?? '',
    district: dto?.district ?? '',
    area: dto?.area ?? '',
    addressLine: dto?.addressLine ?? '',
    postalCode: dto?.postalCode ?? '',
    instructions: dto?.instructions ?? '',
    isDefault: dto?.isDefault === true,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/**
 * A seller order view becomes two device rows: the `SellerOrder` itself, and a
 * synthetic parent `Order` so `sellerOrderDetail` / return / review reads that
 * call `orders.getById(sellerOrder.orderId)` keep resolving. The parent order is
 * a summary only — its `sellerOrderIds` names just this split — but no seller
 * screen reads the sibling splits.
 */
export function mapSellerOrderView(view: SellerOrderViewDto): { sellerOrder: SellerOrder; order: Order } {
  const stamp = view.createdAt ?? nowIso();
  const items: OrderItemSnapshot[] = view.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    productName: item.productName,
    brand: item.brand,
    image: item.image,
    variantId: item.variantId ?? undefined,
    variantAttributes: item.variantAttributes ?? undefined,
    unitPrice: item.unitPrice,
    discount: item.discount,
    quantity: item.quantity,
    subtotal: item.subtotal,
    status: item.status,
    reviewId: item.reviewId ?? null,
    hasReview: item.hasReview,
    returnRequestId: item.returnRequestId ?? null,
  }));

  const shippingAddress = mapAddress(view.shippingAddress ?? view.order?.shippingAddress ?? null, view.id, stamp);
  const timeline: SellerOrderTimelineEntry[] = view.timeline.map((entry) => ({
    status: entry.status as SellerOrderTimelineEntry['status'],
    at: entry.at ?? stamp,
  }));

  const sellerOrder: SellerOrder = {
    id: view.id,
    orderId: view.orderId,
    sellerId: view.sellerId,
    storeId: view.storeId,
    storeName: view.storeName,
    storeLogo: view.storeLogo,
    status: view.status as OrderStatus,
    items,
    subtotal: view.subtotal,
    shippingFee: view.shippingFee,
    vouchersDiscount: view.vouchersDiscount,
    total: view.total,
    shippingAddress,
    carrier: view.carrier || undefined,
    trackingNumber: view.trackingNumber || undefined,
    timeline,
    fulfilledAt: view.fulfilledAt ?? undefined,
    createdAt: stamp,
    updatedAt: view.updatedAt ?? stamp,
  };

  const summary = view.order;
  const order: Order = {
    id: summary?.id ?? view.orderId,
    customerId: '',
    orderCode: summary?.orderCode ?? view.orderId,
    status: (summary?.status || view.status) as OrderStatus,
    sellerOrderIds: [view.id],
    subtotal: view.subtotal,
    shippingTotal: view.shippingFee,
    vouchersDiscount: view.vouchersDiscount,
    total: summary?.total ?? view.total,
    paymentMethod: (summary?.paymentMethod || 'cod') as PaymentMethod,
    paymentStatus: (summary?.paymentStatus || 'pending') as PaymentStatus,
    deliveryMethod: 'standard',
    shippingAddress,
    voucherCodes: [],
    placedAt: summary?.placedAt ?? stamp,
    createdAt: stamp,
    updatedAt: view.updatedAt ?? stamp,
  };

  return { sellerOrder, order };
}

export function mapReturnRequest(dto: ReturnDto): ReturnRequest {
  const stamp = dto.createdAt ?? nowIso();
  return {
    id: dto.id,
    orderId: dto.orderId,
    sellerOrderId: dto.sellerOrderId,
    orderItemId: dto.orderItemId,
    userId: dto.userId,
    sellerId: dto.sellerId,
    productName: dto.productName,
    quantity: dto.quantity ?? undefined,
    reason: dto.reason as ReturnReason,
    description: dto.description,
    images: [...(dto.images ?? [])],
    preferredResolution: dto.preferredResolution,
    status: dto.status,
    timeline: dto.timeline.map((entry) => ({ status: entry.status, at: entry.at ?? stamp })),
    createdAt: stamp,
    updatedAt: dto.updatedAt ?? stamp,
  };
}

export function mapReview(dto: ReviewDto): Review {
  const stamp = dto.createdAt ?? nowIso();
  return {
    id: dto.id,
    userId: dto.userId,
    userName: dto.userName,
    productId: dto.productId,
    sellerId: dto.sellerId,
    orderItemId: dto.orderItemId,
    orderId: dto.orderId,
    rating: dto.rating,
    title: dto.title,
    text: dto.text,
    images: [...(dto.images ?? [])],
    verifiedPurchase: dto.verifiedPurchase,
    sellerReply: dto.sellerReply ? { text: dto.sellerReply.text, at: dto.sellerReply.at ?? stamp } : null,
    helpfulCount: dto.helpfulCount,
    createdAt: stamp,
    updatedAt: dto.updatedAt ?? stamp,
  };
}

export function mapVoucher(dto: VoucherDto): Voucher {
  return {
    id: dto.id,
    code: dto.code,
    title: dto.title,
    type: dto.type,
    discountValue: dto.discountValue,
    minimumOrder: dto.minimumOrder,
    maximumDiscount: dto.maximumDiscount ?? undefined,
    scope: dto.scope,
    sellerId: dto.sellerId ?? undefined,
    categoryId: dto.categoryId ?? undefined,
    productIds: [...(dto.productIds ?? [])],
    startAt: dto.startAt,
    expiry: dto.expiry,
    usageLimit: dto.usageLimit ?? undefined,
    usageCount: dto.usageCount,
    perUserLimit: dto.perUserLimit ?? undefined,
    perUserUsed: {},
    active: dto.active,
    description: dto.description || undefined,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

// ------------------------------------------------------------- upserts

export function upsertSellerProfile(dto: SellerProfileDto): SellerProfile {
  const mapped = mapSellerProfile(dto);
  upsert('sellers', mapped);
  return mapped;
}

export function upsertStore(dto: StoreDto): Store {
  const mapped = mapStore(dto);
  upsert('stores', mapped);
  return mapped;
}

export function upsertProduct(dto: ProductDto): Product {
  const mapped = mapProduct(dto);
  upsert('products', mapped);
  return mapped;
}

export function upsertAdjustment(dto: AdjustmentDto): InventoryAdjustment {
  const mapped = mapAdjustment(dto);
  upsert('inventoryAdjustments', mapped);
  return mapped;
}

export function upsertSellerOrderView(view: SellerOrderViewDto): SellerOrder {
  const { sellerOrder, order } = mapSellerOrderView(view);
  upsert('sellerOrders', sellerOrder);
  upsert('orders', order);
  return sellerOrder;
}

export function upsertReturn(dto: ReturnDto): ReturnRequest {
  const mapped = mapReturnRequest(dto);
  upsert('returnRequests', mapped);
  return mapped;
}

export function upsertReview(dto: ReviewDto): Review {
  const mapped = mapReview(dto);
  upsert('reviews', mapped);
  return mapped;
}

export function upsertVoucher(dto: VoucherDto): Voucher {
  const mapped = mapVoucher(dto);
  upsert('vouchers', mapped);
  return mapped;
}

export function removeVoucher(id: string): void {
  getContainer().db.remove('vouchers', id);
}

// ------------------------------------------------------------ hydration

export interface SellerWorkspaceSnapshot {
  profile: SellerProfile | null;
  store: Store | null;
}

/** Profile + store for any signed-in user — this works before approval. */
export async function hydrateSellerIdentity(): Promise<SellerWorkspaceSnapshot> {
  const { profile, store } = await vantaApi.sellerProfile();
  const mappedProfile = profile ? upsertSellerProfile(profile) : null;
  const mappedStore = store ? upsertStore(store) : null;
  return { profile: mappedProfile, store: mappedStore };
}

export async function refreshSellerProducts(): Promise<void> {
  const { products } = await vantaApi.sellerProducts();
  for (const dto of products) upsertProduct(dto);
}

export async function refreshSellerInventory(): Promise<void> {
  const { adjustments } = await vantaApi.inventoryAdjustments();
  for (const dto of adjustments) upsertAdjustment(dto);
}

/**
 * Refreshes the seller's orders and returns from the server.
 *
 * When the seller id is known the returns are reconciled, not merely merged:
 * any local return for this seller that the server did not return is dropped.
 * The seller's returns endpoint is the whole truth for that seller, so a stale
 * row (for example a `ret_…` id a previous local-mode session wrote) must not
 * survive to be shown and then actioned — that is what answered
 * `Return request not found.` even though the customer's request existed.
 */
export async function refreshSellerOrdersAndReturns(sellerId?: string): Promise<void> {
  const [{ orders }, { returns }] = await Promise.all([vantaApi.sellerOrders(), vantaApi.sellerReturns()]);
  for (const view of orders) upsertSellerOrderView(view);
  for (const dto of returns) upsertReturn(dto);

  if (sellerId) {
    const db = getContainer().db;
    const serverIds = new Set(returns.map((dto) => dto.id));
    for (const local of [...db.getCollection<ReturnRequest>('returnRequests')]) {
      if (local.sellerId === sellerId && !serverIds.has(local.id)) {
        db.remove('returnRequests', local.id);
      }
    }
  }
}

export async function refreshSellerReviews(): Promise<void> {
  const { reviews } = await vantaApi.sellerReviews();
  for (const dto of reviews) upsertReview(dto);
}

export async function refreshSellerVouchers(): Promise<void> {
  const { vouchers } = await vantaApi.sellerVouchers();
  for (const dto of vouchers) upsertVoucher(dto);
}

/**
 * Pull the whole seller workspace into the local mirror.
 *
 * Always hydrates the profile and store so settings can show a pending or
 * rejected status. The rest is seller-gated server-side, so it is only fetched
 * once the profile is active; a failure in one section never blocks the others.
 */
export async function hydrateSellerWorkspace(): Promise<SellerProfile | null> {
  const { profile } = await hydrateSellerIdentity();
  if (!profile || profile.status !== 'active') return profile;

  const sections: (() => Promise<void>)[] = [
    refreshSellerProducts,
    refreshSellerInventory,
    () => refreshSellerOrdersAndReturns(profile.id),
    refreshSellerReviews,
    refreshSellerVouchers,
  ];
  for (const section of sections) {
    try {
      await section();
    } catch {
      /* The mirror keeps whatever it had; the screen reports its own read failure. */
    }
  }
  return profile;
}
