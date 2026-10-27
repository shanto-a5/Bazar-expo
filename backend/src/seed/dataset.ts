/**
 * Deterministic seed dataset (M7-O).
 *
 * Every id is a fixed string and every derived value is a fixed offset from a
 * day-truncated clock, so a run is reproducible and a voucher window is always
 * live. Anchoring to "today" rather than a hard-coded date is deliberate: a fixed
 * date silently turns every seeded voucher into an expired one and makes the
 * fixture useless for exercising checkout.
 *
 * The Expo app keeps its own, much larger demo seed in `src/seed`; that dataset
 * stays device-local and is deliberately not imported here.
 */
import type {
  AddressEntity,
  CategoryEntity,
  OrderEntity,
  OrderItemSnapshot,
  PaymentTransactionEntity,
  ProductEntity,
  ReviewEntity,
  SellerOrderEntity,
  SellerProfileEntity,
  StoreEntity,
  UserEntity,
  VoucherEntity,
} from '../domain/entities';
import type { RepositoryBundle } from '../repositories/contracts';
import { effectivePrice } from '../../../shared/catalog-rules';
import { roundMoney } from '../../../shared/money';

export const SEED_ACCOUNTS = {
  customers: [
    { id: 'usr_seed_customer_1', name: 'Ayesha Rahman', email: 'ayesha@vanta.test', phone: '+8801700000001', password: 'VantaPass1!' },
    { id: 'usr_seed_customer_2', name: 'Tanvir Hasan', email: 'tanvir@vanta.test', phone: '+8801700000002', password: 'VantaPass1!' },
  ],
  sellers: [
    { id: 'usr_seed_seller_1', name: 'Nadia Islam', email: 'nadia@brightloop.test', phone: '+8801800000001', password: 'VantaPass1!' },
    { id: 'usr_seed_seller_2', name: 'Farhan Kabir', email: 'farhan@urbanfold.test', phone: '+8801800000002', password: 'VantaPass1!' },
  ],
  /**
   * M8: the only seeded account that can read the seller approval queue.
   *
   * The role is granted here and nowhere else — no customer-facing route can add
   * it — which is what makes the `/admin/sellers` gate a server-side property
   * rather than a UI convention. In a real deployment this account would be
   * created by an operator through the seed CLI, not shipped in the dataset.
   */
  approvers: [
    { id: 'usr_seed_approver_1', name: 'Vanta Operations', email: 'operations@vanta.test', phone: '+8801900000001', password: 'VantaPass1!' },
  ],
} as const;

const DAY = 86_400_000;
const CLOCK = new Date();
const ANCHOR = Date.UTC(CLOCK.getUTCFullYear(), CLOCK.getUTCMonth(), CLOCK.getUTCDate());

function iso(offsetDays: number, hours = 0): string {
  return new Date(ANCHOR + offsetDays * DAY + hours * 3_600_000).toISOString();
}

interface CategorySeed {
  id: string;
  name: string;
  icon: string;
  parentId: string | null;
  order: number;
}

const CATEGORIES: CategorySeed[] = [
  { id: 'cat_seed_electronics', name: 'Electronics', icon: '📱', parentId: null, order: 1 },
  { id: 'cat_seed_audio', name: 'Audio', icon: '🎧', parentId: 'cat_seed_electronics', order: 2 },
  { id: 'cat_seed_home', name: 'Home & Living', icon: '🏠', parentId: null, order: 3 },
  { id: 'cat_seed_apparel', name: 'Apparel', icon: '👕', parentId: null, order: 4 },
];

interface SellerSeed {
  sellerId: string;
  storeId: string;
  storeName: string;
  location: string;
  shippingFee: number;
  freeShippingThreshold: number;
  ratingAvg: number;
  ratingCount: number;
}

const SELLERS: SellerSeed[] = [
  {
    sellerId: 'sel_seed_1',
    storeId: 'sto_seed_1',
    storeName: 'Brightloop',
    location: 'Dhaka',
    shippingFee: 60,
    freeShippingThreshold: 1500,
    ratingAvg: 4.7,
    ratingCount: 128,
  },
  {
    sellerId: 'sel_seed_2',
    storeId: 'sto_seed_2',
    storeName: 'Urbanfold',
    location: 'Chattogram',
    shippingFee: 90,
    freeShippingThreshold: 2000,
    ratingAvg: 4.4,
    ratingCount: 64,
  },
];

interface ProductSeed {
  id: string;
  sellerIndex: number;
  name: string;
  brand: string;
  categoryId: string;
  regularPrice: number;
  salePrice?: number;
  stock: number;
  status: ProductEntity['status'];
  ratingAvg: number;
  ratingCount: number;
  soldCount: number;
}

const PRODUCTS: ProductSeed[] = [
  { id: 'prd_seed_1', sellerIndex: 0, name: 'Halo Wireless Earbuds', brand: 'Halo', categoryId: 'cat_seed_audio', regularPrice: 2490, salePrice: 2190, stock: 40, status: 'active', ratingAvg: 4.6, ratingCount: 84, soldCount: 310 },
  { id: 'prd_seed_2', sellerIndex: 0, name: 'Nimbus Bluetooth Speaker', brand: 'Nimbus', categoryId: 'cat_seed_audio', regularPrice: 3890, stock: 18, status: 'active', ratingAvg: 4.4, ratingCount: 41, soldCount: 122 },
  { id: 'prd_seed_3', sellerIndex: 0, name: 'Orbit Smart Watch', brand: 'Orbit', categoryId: 'cat_seed_electronics', regularPrice: 5290, salePrice: 4750, stock: 12, status: 'active', ratingAvg: 4.2, ratingCount: 37, soldCount: 96 },
  { id: 'prd_seed_4', sellerIndex: 0, name: 'Vertex 65W Charger', brand: 'Vertex', categoryId: 'cat_seed_electronics', regularPrice: 1290, stock: 60, status: 'active', ratingAvg: 4.5, ratingCount: 52, soldCount: 210 },
  { id: 'prd_seed_5', sellerIndex: 1, name: 'Everyday Cotton Tee', brand: 'Urbanfold', categoryId: 'cat_seed_apparel', regularPrice: 890, salePrice: 750, stock: 85, status: 'active', ratingAvg: 4.3, ratingCount: 66, soldCount: 402 },
  { id: 'prd_seed_6', sellerIndex: 1, name: 'Studio Desk Lamp', brand: 'Lumen', categoryId: 'cat_seed_home', regularPrice: 2290, stock: 22, status: 'active', ratingAvg: 4.8, ratingCount: 29, soldCount: 74 },
  { id: 'prd_seed_7', sellerIndex: 1, name: 'Linen Throw Pillow', brand: 'Urbanfold', categoryId: 'cat_seed_home', regularPrice: 1150, stock: 0, status: 'out_of_stock', ratingAvg: 4.1, ratingCount: 18, soldCount: 55 },
  { id: 'prd_seed_8', sellerIndex: 1, name: 'Trail Running Shoes', brand: 'Pace', categoryId: 'cat_seed_apparel', regularPrice: 3490, stock: 30, status: 'active', ratingAvg: 4.5, ratingCount: 44, soldCount: 133 },
];

interface VoucherSeed {
  id: string;
  code: string;
  type: VoucherEntity['type'];
  discountValue: number;
  minimumOrder: number;
  maximumDiscount?: number;
  scope: VoucherEntity['scope'];
  sellerId?: string;
  startOffsetDays: number;
  expiryOffsetDays: number;
  perUserLimit?: number;
}

const VOUCHERS: VoucherSeed[] = [
  { id: 'vch_seed_platform', code: 'VANTA10', type: 'percentage', discountValue: 10, minimumOrder: 1000, maximumDiscount: 400, scope: 'platform', startOffsetDays: -30, expiryOffsetDays: 60, perUserLimit: 3 },
  { id: 'vch_seed_brightloop', code: 'BRIGHT150', type: 'fixed', discountValue: 150, minimumOrder: 1200, scope: 'seller', sellerId: 'sel_seed_1', startOffsetDays: -20, expiryOffsetDays: 40 },
  { id: 'vch_seed_shipping', code: 'FREESHIP', type: 'free_shipping', discountValue: 0, minimumOrder: 800, scope: 'platform', startOffsetDays: -10, expiryOffsetDays: 30 },
];

export interface SeedSummary {
  categories: number;
  users: number;
  sellers: number;
  stores: number;
  products: number;
  vouchers: number;
  addresses: number;
  orders: number;
  reviews: number;
  created: number;
  skipped: number;
}

export async function buildDataset(repos: RepositoryBundle): Promise<SeedDataset> {
  // "When the fixture was generated" is the day anchor, not the wall clock, so two
  // runs on the same day produce identical documents.
  const created = iso(0);

  const categories: CategoryEntity[] = CATEGORIES.map((entry) => ({
    id: entry.id,
    name: entry.name,
    icon: entry.icon,
    image: `p:seed:${entry.id}`,
    parentId: entry.parentId,
    order: entry.order,
    createdAt: created,
    updatedAt: created,
  }));

  const customers: UserEntity[] = SEED_ACCOUNTS.customers.map((account, index) => ({
    id: account.id,
    name: account.name,
    email: account.email,
    phone: account.phone,
    passwordHash: '',
    avatar: `p:👤:${account.email}`,
    roles: ['customer' as const],
    createdAt: iso(-90 + index),
    updatedAt: iso(-90 + index),
  }));

  const sellerUsers: UserEntity[] = SEED_ACCOUNTS.sellers.map((account, index) => ({
    id: account.id,
    name: account.name,
    email: account.email,
    phone: account.phone,
    passwordHash: '',
    avatar: `p:👤:${account.email}`,
    roles: ['customer' as const, 'seller' as const],
    createdAt: iso(-120 + index),
    updatedAt: iso(-120 + index),
  }));

  /**
   * M8: staff accounts. Deliberately *not* sellers — an approver reviews other
   * people's applications, so it has no store, and coupling the two roles would
   * make the approval gate testable only by registering a shop first.
   */
  const staffUsers: UserEntity[] = SEED_ACCOUNTS.approvers.map((account, index) => ({
    id: account.id,
    name: account.name,
    email: account.email,
    phone: account.phone,
    passwordHash: '',
    avatar: `p:👤:${account.email}`,
    roles: ['customer' as const, 'seller_approver' as const],
    createdAt: iso(-200 + index),
    updatedAt: iso(-200 + index),
  }));

  const stores: StoreEntity[] = SELLERS.map((seed, index) => ({
    id: seed.storeId,
    sellerId: seed.sellerId,
    name: seed.storeName,
    description: `${seed.storeName} — a seeded Vanta seller.`,
    logo: `p:seed:${seed.storeId}`,
    banner: `p:seed:${seed.storeId}:banner`,
    status: 'active' as const,
    ratingAvg: seed.ratingAvg,
    ratingCount: seed.ratingCount,
    responseRate: 96 - index,
    responseTimeMinutes: 30 + index * 15,
    productCount: PRODUCTS.filter((product) => product.sellerIndex === index).length,
    followerCount: 240 - index * 60,
    shippingFee: seed.shippingFee,
    freeShippingThreshold: seed.freeShippingThreshold,
    deliveryEstimateDays: { min: 2, max: 5 },
    location: seed.location,
    verified: true,
    createdAt: iso(-120),
    updatedAt: created,
  }));

  const sellerProfiles: SellerProfileEntity[] = SELLERS.map((seed, index) => {
    const account = SEED_ACCOUNTS.sellers[index];
    return {
      id: seed.sellerId,
      userId: account.id,
      storeId: seed.storeId,
      fullName: account.name,
      phone: account.phone,
      email: account.email,
      nationalId: `NID-SEED-${index + 1}`,
      sellerType: 'business' as const,
      entityName: `${seed.storeName} Ltd`,
      pickupDivision: seed.location,
      pickupDistrict: seed.location,
      pickupArea: 'Central',
      pickupAddressLine: `Warehouse ${index + 1}, Central Road`,
      returnDivision: seed.location,
      returnDistrict: seed.location,
      returnArea: 'Central',
      returnAddressLine: `Returns desk ${index + 1}, Central Road`,
      bank: {
        bankName: 'Seed Bank',
        accountName: `${seed.storeName} Ltd`,
        accountNumber: `SEED-ACCT-${index + 1}`,
        branch: seed.location,
      },
      agreement: {
        marketplaceTerms: true,
        sellerPolicies: true,
        productAuthenticity: true,
        fulfillmentResponsibility: true,
      },
      status: 'active' as const,
      createdAt: iso(-120),
      updatedAt: created,
    };
  });

  const products: ProductEntity[] = PRODUCTS.map((seed) => {
    const seller = SELLERS[seed.sellerIndex];
    const product: ProductEntity = {
      id: seed.id,
      sellerId: seller.sellerId,
      storeId: seller.storeId,
      name: seed.name,
      brand: seed.brand,
      categoryId: seed.categoryId,
      subcategoryId: null,
      description: `${seed.name} from ${seller.storeName}. Seeded catalogue entry.`,
      highlights: ['1 year brand warranty', 'Cash on delivery available'],
      images: [`p:seed:${seed.id}:1`, `p:seed:${seed.id}:2`],
      regularPrice: seed.regularPrice,
      salePrice: seed.salePrice,
      sku: `SKU-${seed.id.toUpperCase()}`,
      stock: seed.stock,
      lowStockThreshold: 5,
      variants: [],
      hasVariants: false,
      status: seed.status,
      publishedAt: iso(-60),
      ratingAvg: seed.ratingAvg,
      ratingCount: seed.ratingCount,
      soldCount: seed.soldCount,
      viewCount: seed.ratingCount * 9,
      createdAt: iso(-60),
      updatedAt: created,
    };
    return product;
  });

  const vouchers: VoucherEntity[] = VOUCHERS.map((seed) => ({
    id: seed.id,
    code: seed.code,
    title: `${seed.code} — seeded voucher`,
    type: seed.type,
    discountValue: seed.discountValue,
    minimumOrder: seed.minimumOrder,
    maximumDiscount: seed.maximumDiscount,
    scope: seed.scope,
    sellerId: seed.sellerId,
    startAt: iso(seed.startOffsetDays),
    expiry: iso(seed.expiryOffsetDays),
    usageLimit: 500,
    usageCount: 0,
    perUserLimit: seed.perUserLimit,
    perUserUsed: {},
    active: true,
    description: 'Seeded development voucher.',
    createdAt: iso(-30),
    updatedAt: created,
  }));

  const addresses: AddressEntity[] = customers.map((customer, index) => ({
    id: `adr_seed_${index + 1}`,
    userId: customer.id,
    label: 'Home',
    recipientName: customer.name,
    phone: customer.phone,
    division: 'Dhaka',
    district: index === 0 ? 'Dhaka' : 'Gulshan',
    area: 'Banani',
    addressLine: `House ${10 + index}, Road 7, Block C`,
    postalCode: '1213',
    isDefault: true,
    createdAt: iso(-80),
    updatedAt: created,
  }));

  // One delivered order spanning both sellers, priced with the shared rules so the
  // seeded history is internally consistent with the checkout maths and exercises
  // the per-seller split.
  const orderLines = [
    { productId: 'prd_seed_1', quantity: 1 },
    { productId: 'prd_seed_4', quantity: 2 },
    { productId: 'prd_seed_5', quantity: 1 },
  ];
  const orderProducts = orderLines.map((line) => products.find((product) => product.id === line.productId)!).filter(Boolean);
  const subtotal = roundMoney(
    orderLines.reduce((sum, line) => {
      const product = orderProducts.find((entry) => entry.id === line.productId)!;
      return sum + effectivePrice(product) * line.quantity;
    }, 0),
  );
  const sellerSubtotals = new Map<string, number>();
  for (const line of orderLines) {
    const product = orderProducts.find((entry) => entry.id === line.productId)!;
    sellerSubtotals.set(product.sellerId, roundMoney((sellerSubtotals.get(product.sellerId) ?? 0) + effectivePrice(product) * line.quantity));
  }
  const shippingTotal = roundMoney(
    [...sellerSubtotals.entries()].reduce((sum, [sellerId, value]) => {
      const seller = SELLERS.find((entry) => entry.sellerId === sellerId)!;
      return sum + (value >= seller.freeShippingThreshold ? 0 : seller.shippingFee);
    }, 0),
  );

  const orderId = 'ord_seed_1';
  const orderPlacedAt = iso(-14, 3);

  const sellerOrders: SellerOrderEntity[] = [...sellerSubtotals.entries()].map(([sellerId, value], index) => {
    const seller = SELLERS.find((entry) => entry.sellerId === sellerId)!;
    const store = stores.find((entry) => entry.sellerId === sellerId)!;
    const items: OrderItemSnapshot[] = orderLines
      .map((line) => orderProducts.find((entry) => entry.id === line.productId)!)
      .filter((product) => product.sellerId === sellerId)
      .map((product) => {
        const quantity = orderLines.find((line) => line.productId === product.id)!.quantity;
        const unitPrice = effectivePrice(product);
        return {
          id: `oit_seed_${product.id}`,
          productId: product.id,
          productName: product.name,
          brand: product.brand,
          image: product.images[0] ?? '',
          unitPrice,
          discount: 0,
          quantity,
          subtotal: roundMoney(unitPrice * quantity),
          status: 'delivered' as const,
          reviewId: null,
          hasReview: false,
          returnRequestId: null,
        };
      });
    const shippingFee = value >= seller.freeShippingThreshold ? 0 : seller.shippingFee;
    return {
      id: `sor_seed_${index + 1}`,
      orderId,
      sellerId,
      storeId: store.id,
      storeName: store.name,
      storeLogo: store.logo,
      status: 'delivered' as const,
      items,
      subtotal: value,
      shippingFee,
      vouchersDiscount: 0,
      total: roundMoney(value + shippingFee),
      shippingAddress: addresses[0],
      carrier: 'Vanta Express',
      trackingNumber: 'SEED-TRACK-1',
      timeline: [
        { status: 'new', at: orderPlacedAt },
        { status: 'delivered', at: iso(-11, 6) },
      ],
      fulfilledAt: iso(-11, 6),
      createdAt: orderPlacedAt,
      updatedAt: iso(-11, 6),
    };
  });

  // The order is written after the splits so `sellerOrderIds` is derived from the
  // rows that actually exist — a hard-coded list can dangle when the lines change.
  const order: OrderEntity = {
    id: orderId,
    customerId: customers[0].id,
    orderCode: 'ORD-SEED00001',
    status: 'delivered',
    sellerOrderIds: sellerOrders.map((entry) => entry.id),
    subtotal,
    shippingTotal,
    vouchersDiscount: 0,
    total: roundMoney(subtotal + shippingTotal),
    paymentMethod: 'cod',
    paymentStatus: 'paid',
    deliveryMethod: 'standard',
    shippingAddress: addresses[0],
    voucherCodes: [],
    placedAt: orderPlacedAt,
    deliveredAt: iso(-11, 6),
    createdAt: orderPlacedAt,
    updatedAt: iso(-11, 6),
  };

  const payment: PaymentTransactionEntity = {
    id: 'trx_seed_1',
    orderId,
    userId: customers[0].id,
    method: 'cod',
    amount: order.total,
    status: 'paid',
    reference: 'SIM-COD-SEED1',
    paidAt: iso(-11, 6),
    createdAt: orderPlacedAt,
    updatedAt: iso(-11, 6),
  };

  const reviews: ReviewEntity[] = orderLines.map((line, index) => {
    const product = orderProducts.find((entry) => entry.id === line.productId)!;
    return {
      id: `rev_seed_${index + 1}`,
      userId: customers[0].id,
      userName: customers[0].name,
      productId: product.id,
      sellerId: product.sellerId,
      orderItemId: `oit_seed_${product.id}`,
      orderId,
      rating: index === 0 ? 5 : 4,
      title: index === 0 ? 'Exactly as described' : 'Good value',
      text: 'Seeded review used to verify the review endpoints.',
      images: [],
      verifiedPurchase: true,
      sellerReply: null,
      helpfulCount: 3 + index,
      createdAt: iso(-10, 2),
      updatedAt: iso(-10, 2),
    };
  });

  void repos;
  return {
    categories,
    customers,
    sellerUsers,
    staffUsers,
    sellerProfiles,
    stores,
    products,
    vouchers,
    addresses,
    order,
    sellerOrders,
    payment,
    reviews,
  };
}

export interface SeedDataset {
  categories: CategoryEntity[];
  customers: UserEntity[];
  sellerUsers: UserEntity[];
  staffUsers: UserEntity[];
  sellerProfiles: SellerProfileEntity[];
  stores: StoreEntity[];
  products: ProductEntity[];
  vouchers: VoucherEntity[];
  addresses: AddressEntity[];
  order: OrderEntity;
  sellerOrders: SellerOrderEntity[];
  payment: PaymentTransactionEntity;
  reviews: ReviewEntity[];
}
