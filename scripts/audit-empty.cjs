/**
 * Empty-marketplace and local-data integrity audit.
 *
 * Boots the exported web build in headless Chrome against empty storage and
 * checks two things:
 *
 *   1. Vanta starts EMPTY. No products, sellers, stores, accounts, orders,
 *      payments, reviews, vouchers, promotions, followers, carts, wishlists,
 *      addresses, notifications or inventory movements are written on first
 *      launch. The category taxonomy is the single exception, because a seller
 *      cannot publish a real product without it.
 *   2. What the app DOES write is consistent: unique ids, no orphans, no
 *      negative money, order/seller-order splits that add up, reviews only on
 *      delivered lines, and no live listing a customer could not buy.
 *
 * It also proves emptiness survives a restart and is not re-created after the
 * user deletes data, which is what "the app does not silently re-seed itself"
 * actually means at runtime.
 *
 * Finally it plants a device that looks like it ran the old seeded build and was
 * then used by a real person, and checks the upgrade removes exactly the demo
 * rows and nothing else. Losing a real person's account, order, payment or
 * session to a data migration would be far worse than leaving a demo row behind,
 * so both directions are asserted by id.
 *
 *   node scripts/audit-empty.cjs <distDir> [baseUrl]
 *
 * Exit code 1 means the audit found a real inconsistency.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

// puppeteer-core is a test-only dependency and lives outside the app bundle.
// PUPPETEER_CORE lets the audit reuse the E2E toolchain without adding a
// runtime dependency to the app.
const requireFrom = (id) => {
  const search = (process.env.PUPPETEER_CORE || '').split(';').filter(Boolean);
  for (const base of search) {
    try {
      return createRequire(path.join(base, 'noop.js'))(id);
    } catch {
      /* try the next location */
    }
  }
  return require(id);
};
const puppeteer = requireFrom('puppeteer-core');

const DIST = path.resolve(process.argv[2] || 'dist');
const BASE = process.argv[3] || 'http://127.0.0.1:8100';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const COLLECTIONS = [
  'users',
  'sessions',
  'categories',
  'sellers',
  'stores',
  'products',
  'carts',
  'wishlists',
  'addresses',
  'vouchers',
  'promotions',
  'orders',
  'sellerOrders',
  'payments',
  'reviews',
  'returnRequests',
  'notifications',
  'searchHistory',
  'recentlyViewed',
  'storeFollowers',
  'inventoryAdjustments',
];

/**
 * Everything a first launch must NOT contain. Categories are excluded on
 * purpose: they are the taxonomy a real seller needs in order to publish.
 */
const MUST_BE_EMPTY = COLLECTIONS.filter((name) => name !== 'categories');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const money = (value) => Math.round(value * 100) / 100;

const problems = [];
const fail = (code, message) => problems.push({ code, message });

function checkEmptyBoot(data) {
  for (const name of MUST_BE_EMPTY) {
    if (data[name].length) {
      fail(
        'empty.unexpected_records',
        `A fresh launch wrote ${data[name].length} ${name} record(s). Vanta must start as an empty marketplace.`,
      );
    }
  }
  // The taxonomy itself must still be installed, otherwise no real seller can
  // create a real product.
  if (!data.categories.length) {
    fail('empty.no_taxonomy', 'The category taxonomy was not installed; product creation would be impossible.');
  }
}

/**
 * The demo identities the removed dataset used, and the platform voucher codes
 * it created. These are duplicated here on purpose: the audit must be able to
 * plant the exact rows the old build wrote and then prove they are gone, and it
 * must keep doing that independently of whatever the migration source does.
 */
const DEMO_EMAILS = [
  'seller@vanta.app',
  'trendy@vanta.store',
  'customer@vanta.app',
  'farhan@example.com',
  'mim@example.com',
];
const DEMO_VOUCHER_CODES = ['WELCOME10', 'SAVE50', 'FREECART'];

const stamp = () => new Date().toISOString();

/**
 * Builds a device that looks like it ran the old seeded build and THEN had a
 * real person use it: demo accounts and their products and orders alongside a
 * real account with a real store, product, cart, wishlist, order and payment.
 * Every demo row is reachable from a demo email; every real row is not. The
 * audit asserts the first group disappears and the second survives untouched.
 */
function buildLegacyFixture(categories) {
  const now = stamp();
  const base = (id) => ({ id, createdAt: now, updatedAt: now });

  const demoUser = { ...base('usr_demo'), name: 'Rahim Khan', email: 'seller@vanta.app', phone: '01810000001', passwordHash: 'x', passwordSalt: 'y', avatar: '', roles: ['customer', 'seller'] };
  const demoCustomer = { ...base('usr_democust'), name: 'Ayesha Rahman', email: 'customer@vanta.app', phone: '01820000001', passwordHash: 'x', passwordSalt: 'y', avatar: '', roles: ['customer'] };
  const realUser = { ...base('usr_real'), name: 'Real Person', email: 'real.person@vanta.test', phone: '01700000000', passwordHash: 'x', passwordSalt: 'y', avatar: '', roles: ['customer'] };
  const realSellerUser = { ...base('usr_realseller'), name: 'Real Seller', email: 'real.seller@vanta.test', phone: '01700000001', passwordHash: 'x', passwordSalt: 'y', avatar: '', roles: ['customer', 'seller'] };

  const demoSeller = { ...base('sel_demo'), userId: demoUser.id, storeId: 'sto_demo', fullName: 'Rahim Khan', phone: '01810000001', email: 'seller@vanta.app', nationalId: '1234567890', sellerType: 'business', pickupDivision: 'Dhaka', pickupDistrict: 'Dhaka', pickupArea: 'Banani', pickupAddressLine: 'Road 11', returnDivision: 'Dhaka', returnDistrict: 'Dhaka', returnArea: 'Banani', returnAddressLine: 'Road 11', bank: { bankName: 'bKash Agent', accountName: 'Rahim Khan', accountNumber: '1234567890' }, agreement: { marketplaceTerms: true, sellerPolicies: true, productAuthenticity: true, fulfillmentResponsibility: true }, status: 'active' };
  const realSeller = { ...base('sel_real'), userId: realSellerUser.id, storeId: 'sto_real', fullName: 'Real Seller', phone: '01700000001', email: 'real.seller@vanta.test', nationalId: '9876543210', sellerType: 'individual', pickupDivision: 'Dhaka', pickupDistrict: 'Dhaka', pickupArea: 'Gulshan', pickupAddressLine: 'Road 1', returnDivision: 'Dhaka', returnDistrict: 'Dhaka', returnArea: 'Gulshan', returnAddressLine: 'Road 1', bank: { bankName: 'BRAC Bank', accountName: 'Real Seller', accountNumber: '9876543210' }, agreement: { marketplaceTerms: true, sellerPolicies: true, productAuthenticity: true, fulfillmentResponsibility: true }, status: 'active' };

  const store = (id, sellerId, name, count) => ({ ...base(id), sellerId, name, description: name, logo: '', banner: '', status: 'active', ratingAvg: 0, ratingCount: 0, responseRate: 95, responseTimeMinutes: 30, productCount: count, followerCount: 0, shippingFee: 60, freeShippingThreshold: 999, deliveryEstimateDays: { min: 2, max: 5 }, location: 'Dhaka, Dhaka', verified: false });

  const product = (id, sellerId, storeId, name, price, categoryId) => ({ ...base(id), sellerId, storeId, name, brand: 'Brand', categoryId, subcategoryId: null, description: name, highlights: [], images: [], regularPrice: price, costPrice: Math.round(price * 0.65), sku: `SKU-${id}`, stock: 25, lowStockThreshold: 5, variants: [], hasVariants: false, status: 'active', publishedAt: now, ratingAvg: 0, ratingCount: 0, soldCount: 0, viewCount: 3 });

  const categoryId = categories[0] ? categories[0].id : 'cat_groceries';
  const address = (userId, name, area) => ({ ...base(`adr_${userId}`), userId, label: 'Home', recipientName: name, phone: '01700000000', division: 'Dhaka', district: 'Dhaka', area, addressLine: 'House 5', postalCode: '1213', isDefault: true });

  const orderLine = (id, productId, name, price, status, review) => ({ id, productId, productName: name, brand: 'Brand', image: '', unitPrice: price, discount: 0, quantity: 1, subtotal: price, status, reviewId: review?.id ?? null, hasReview: !!review, returnRequestId: null });

  const demoOrder = { ...base('ord_demo'), customerId: demoCustomer.id, orderCode: 'ORD-SEED-1', status: 'delivered', sellerOrderIds: ['sol_demo'], subtotal: 2500, shippingTotal: 60, vouchersDiscount: 0, total: 2560, paymentMethod: 'cod', paymentStatus: 'paid', deliveryMethod: 'standard', shippingAddress: address(demoCustomer.id, 'Ayesha Rahman', 'Banani'), voucherCodes: [], placedAt: now, deliveredAt: now };
  const realOrder = { ...base('ord_real'), customerId: realUser.id, orderCode: 'ORD-REAL-1', status: 'delivered', sellerOrderIds: ['sol_real'], subtotal: 1500, shippingTotal: 60, vouchersDiscount: 0, total: 1560, paymentMethod: 'bkash', paymentStatus: 'paid', deliveryMethod: 'standard', shippingAddress: address(realUser.id, 'Real Person', 'Gulshan'), voucherCodes: [], placedAt: now, deliveredAt: now };

  const realReview = { ...base('rvw_real'), userId: realUser.id, userName: 'Real Person', productId: 'prd_real', sellerId: realSeller.id, orderItemId: 'oit_real', orderId: realOrder.id, rating: 5, title: 'Genuine', text: 'Exactly what I wanted.', images: [], verifiedPurchase: true, sellerReply: null, helpfulCount: 1 };
  const demoReview = { ...base('rvw_demo'), userId: demoCustomer.id, userName: 'Ayesha Rahman', productId: 'prd_demo', sellerId: demoSeller.id, orderItemId: 'oit_demo', orderId: demoOrder.id, rating: 4, title: 'Seeded', text: 'Seeded review.', images: [], verifiedPurchase: true, sellerReply: null, helpfulCount: 0 };

  return {
    users: [demoUser, demoCustomer, realUser, realSellerUser],
    sessions: [
      { ...base('ses_demo'), userId: demoUser.id, token: 'demo-token', expiresAt: '2099-01-01T00:00:00.000Z' },
      { ...base('ses_real'), userId: realUser.id, token: 'real-token', expiresAt: '2099-01-01T00:00:00.000Z' },
    ],
    sellers: [demoSeller, realSeller],
    stores: [store('sto_demo', demoSeller.id, 'Rahim Electronics', 1), store('sto_real', realSeller.id, 'Real Store', 1)],
    products: [
      product('prd_demo', demoSeller.id, 'sto_demo', 'Seeded Phone', 2500, categoryId),
      product('prd_real', realSeller.id, 'sto_real', 'Real Product', 1500, categoryId),
    ],
    orders: [demoOrder, realOrder],
    sellerOrders: [
      { ...base('sol_demo'), orderId: demoOrder.id, sellerId: demoSeller.id, storeId: 'sto_demo', storeName: 'Rahim Electronics', storeLogo: '', status: 'delivered', items: [orderLine('oit_demo', 'prd_demo', 'Seeded Phone', 2500, 'delivered', demoReview)], subtotal: 2500, shippingFee: 60, vouchersDiscount: 0, total: 2560, shippingAddress: demoOrder.shippingAddress, timeline: [{ status: 'delivered', at: now }], fulfilledAt: now },
      { ...base('sol_real'), orderId: realOrder.id, sellerId: realSeller.id, storeId: 'sto_real', storeName: 'Real Store', storeLogo: '', status: 'delivered', items: [orderLine('oit_real', 'prd_real', 'Real Product', 1500, 'delivered', realReview)], subtotal: 1500, shippingFee: 60, vouchersDiscount: 0, total: 1560, shippingAddress: realOrder.shippingAddress, timeline: [{ status: 'delivered', at: now }], fulfilledAt: now },
    ],
    payments: [
      { ...base('trx_demo'), orderId: demoOrder.id, userId: demoCustomer.id, method: 'cod', amount: 2560, status: 'paid', reference: 'TRX-SEED1', paidAt: now },
      { ...base('trx_real'), orderId: realOrder.id, userId: realUser.id, method: 'bkash', amount: 1560, status: 'paid', reference: 'TRX-REAL1', paidAt: now },
    ],
    reviews: [demoReview, realReview],
    returnRequests: [{ ...base('ret_demo'), orderId: demoOrder.id, sellerOrderId: 'sol_demo', orderItemId: 'oit_demo', userId: demoCustomer.id, sellerId: demoSeller.id, productName: 'Seeded Phone', quantity: 1, reason: 'defective', description: 'x', images: [], preferredResolution: 'refund', status: 'refunded', timeline: [] }],
    addresses: [address(demoCustomer.id, 'Ayesha Rahman', 'Banani'), address(realUser.id, 'Real Person', 'Gulshan')],
    carts: [{ ...base('crt_real'), userId: realUser.id, items: [{ productId: 'prd_real', quantity: 1 }] }],
    wishlists: [{ ...base('wsh_demo'), userId: demoCustomer.id, items: [{ productId: 'prd_demo', addedAt: now }] }],
    notifications: [
      { ...base('ntf_demo'), userId: demoUser.id, type: 'seller_new_order', title: 'Seeded', body: 'x', read: false },
      { ...base('ntf_real'), userId: realUser.id, type: 'order_status', title: 'Real', body: 'x', read: false },
    ],
    searchHistory: [{ ...base('sh_demo'), userId: demoCustomer.id, query: 'phone' }],
    recentlyViewed: [{ ...base('rv_demo'), userId: demoCustomer.id, productId: 'prd_demo' }],
    storeFollowers: [{ ...base('fol_demo'), userId: demoCustomer.id, storeId: 'sto_demo' }],
    inventoryAdjustments: [{ ...base('inv_demo'), productId: 'prd_demo', variantId: null, quantity: -1, reason: 'sale', referenceId: demoOrder.id }],
    vouchers: [
      { ...base('vch_demo1'), code: 'WELCOME10', title: 'Welcome 10% Off', type: 'percentage', discountValue: 10, minimumOrder: 500, maximumDiscount: 300, scope: 'platform', startAt: now, expiry: '2099-01-01T00:00:00.000Z', usageLimit: 10000, usageCount: 1240, perUserLimit: 1, perUserUsed: {}, active: true },
      { ...base('vch_real'), code: 'REALSAVE', title: 'Real Voucher', type: 'fixed', discountValue: 50, minimumOrder: 400, scope: 'platform', startAt: now, expiry: '2099-01-01T00:00:00.000Z', usageLimit: 100, usageCount: 2, perUserLimit: 1, perUserUsed: {}, active: true },
    ],
    promotions: [
      { ...base('prm_demo'), title: 'Flash Sale', type: 'flash_sale', image: '', productIds: ['prd_demo'], discountPercent: 40, startAt: now, endAt: '2099-01-01T00:00:00.000Z', active: true },
      { ...base('prm_real'), title: 'Real Deals', type: 'deal', image: '', productIds: ['prd_real'], discountPercent: 10, startAt: now, endAt: '2099-01-01T00:00:00.000Z', active: true },
    ],
  };
}

/** Ids that must still be present after the migration: everything a real person made. */
const REAL_FIXTURE_IDS = {
  users: ['usr_real', 'usr_realseller'],
  sellers: ['sel_real'],
  stores: ['sto_real'],
  products: ['prd_real'],
  orders: ['ord_real'],
  sellerOrders: ['sol_real'],
  payments: ['trx_real'],
  reviews: ['rvw_real'],
  addresses: ['adr_usr_real'],
  carts: ['crt_real'],
  notifications: ['ntf_real'],
  vouchers: ['vch_real'],
  promotions: ['prm_real'],
};

/** Ids that must be gone: everything the demo dataset wrote. */
const DEMO_FIXTURE_IDS = {
  users: ['usr_demo', 'usr_democust'],
  sellers: ['sel_demo'],
  stores: ['sto_demo'],
  products: ['prd_demo'],
  orders: ['ord_demo'],
  sellerOrders: ['sol_demo'],
  payments: ['trx_demo'],
  reviews: ['rvw_demo'],
  returnRequests: ['ret_demo'],
  wishlists: ['wsh_demo'],
  notifications: ['ntf_demo'],
  searchHistory: ['sh_demo'],
  recentlyViewed: ['rv_demo'],
  storeFollowers: ['fol_demo'],
  inventoryAdjustments: ['inv_demo'],
  vouchers: ['vch_demo1'],
  promotions: ['prm_demo'],
};

function checkLegacyMigration(data) {
  const ids = (list) => new Set(data[list].map((row) => row.id));

  for (const [collection, mustSurvive] of Object.entries(REAL_FIXTURE_IDS)) {
    const present = ids(collection);
    for (const id of mustSurvive) {
      if (!present.has(id)) {
        fail('legacy.data_loss', `The migration removed "${id}" from ${collection}. It belongs to a real person and must survive.`);
      }
    }
  }
  for (const [collection, mustGo] of Object.entries(DEMO_FIXTURE_IDS)) {
    const present = ids(collection);
    for (const id of mustGo) {
      if (present.has(id)) {
        fail('legacy.demo_remains', `Demo record "${id}" is still in ${collection} after the migration.`);
      }
    }
  }

  // Not one row anywhere may still belong to a demo identity, however it got there.
  for (const user of data.users) {
    if (DEMO_EMAILS.includes(user.email)) {
      fail('legacy.demo_user_remains', `Demo account ${user.email} survived the migration.`);
    }
  }
  for (const seller of data.sellers) {
    if (DEMO_EMAILS.includes(seller.email)) {
      fail('legacy.demo_seller_remains', `Demo seller ${seller.email} survived the migration.`);
    }
  }
  for (const voucher of data.vouchers) {
    if (DEMO_VOUCHER_CODES.includes(voucher.code)) {
      fail('legacy.demo_voucher_remains', `Demo voucher ${voucher.code} survived the migration.`);
    }
  }

  // The real person's session must survive, so an upgrade never signs them out.
  const realSession = data.sessions.find((session) => session.id === 'ses_real');
  if (!realSession) {
    fail('legacy.session_lost', 'The upgrade removed a real session; a real person would be signed out by an app update.');
  }
  // The demo session has no account left, so it is correctly dropped.
  if (data.sessions.some((session) => session.id === 'ses_demo')) {
    fail('legacy.session_orphan', 'A session for the removed demo account survived.');
  }
  // The taxonomy is reference data and must not be wiped by the migration.
  if (!data.categories.length) {
    fail('legacy.taxonomy_lost', 'The migration cleared the category taxonomy; real sellers could no longer publish.');
  }
}

function checkIntegrity(data) {
  const byId = (list) => new Map(list.map((row) => [row.id, row]));
  const users = byId(data.users);
  const sellers = byId(data.sellers);
  const stores = byId(data.stores);
  const products = byId(data.products);
  const orders = byId(data.orders);
  const sellerOrders = byId(data.sellerOrders);
  const categories = byId(data.categories);

  // Every id must be unique per collection.
  for (const name of COLLECTIONS) {
    const seen = new Set();
    for (const row of data[name]) {
      if (seen.has(row.id)) fail('id.duplicate', `${name} contains id ${row.id} twice.`);
      seen.add(row.id);
    }
  }

  // Referential integrity across the whole graph.
  for (const seller of data.sellers) {
    if (!stores.has(seller.storeId)) {
      fail('ref.seller_store', `Seller ${seller.id} points at missing store ${seller.storeId}.`);
    }
    if (seller.userId && !users.has(seller.userId)) {
      fail('ref.seller_user', `Seller ${seller.id} points at missing user ${seller.userId}.`);
    }
  }
  for (const store of data.stores) {
    if (!sellers.has(store.sellerId)) {
      fail('ref.store_seller', `Store ${store.id} points at missing seller ${store.sellerId}.`);
    }
  }
  for (const product of data.products) {
    if (!stores.has(product.storeId)) {
      fail('ref.product_store', `Product ${product.id} points at missing store ${product.storeId}.`);
    }
    if (product.categoryId && !categories.has(product.categoryId)) {
      fail('ref.product_category', `Product ${product.id} points at missing category ${product.categoryId}.`);
    }
    if (product.storeId && stores.has(product.storeId)) {
      const store = stores.get(product.storeId);
      if (store.sellerId !== product.sellerId) {
        fail('ref.product_seller', `Product ${product.id} disagrees with its store about the seller.`);
      }
    }
  }
  for (const order of data.orders) {
    if (!users.has(order.customerId)) {
      fail('ref.order_customer', `Order ${order.code || order.id} has no customer.`);
    }
  }

  // Money invariants: nothing negative, splits add up, payments match status.
  for (const product of data.products) {
    const price = product.salePrice ?? product.regularPrice;
    if (!(price >= 0)) fail('money.product_price', `Product ${product.id} has price ${price}.`);
    if (product.regularPrice < 0) fail('money.product_price', `Product ${product.id} has a negative list price.`);
  }
  for (const sellerOrder of data.sellerOrders) {
    if (!orders.has(sellerOrder.orderId)) {
      fail('ref.seller_order_orphan', `Seller order ${sellerOrder.id} has no parent order.`);
      continue;
    }
    if (sellerOrder.total < 0) fail('money.seller_order_total', `Seller order ${sellerOrder.id} is negative.`);
    for (const item of sellerOrder.items || []) {
      if (!products.has(item.productId)) {
        fail('ref.order_item_product', `Seller order ${sellerOrder.id} references removed product ${item.productId}.`);
      }
      if (item.quantity <= 0) fail('money.order_item_qty', `Seller order ${sellerOrder.id} has quantity ${item.quantity}.`);
    }
  }
  for (const order of data.orders) {
    const splits = data.sellerOrders.filter((entry) => entry.orderId === order.id);
    if (order.status !== 'cancelled' && splits.length === 0) {
      fail('order.no_fulfillment', `Order ${order.orderCode} has no seller fulfillment.`);
    }
    if (splits.length) {
      const summed = money(splits.reduce((total, entry) => total + entry.total, 0));
      const expected = money(order.total + (order.vouchersDiscount || 0));
      if (Math.abs(summed - expected) > 1) {
        fail('order.total_mismatch', `Order ${order.orderCode} totals ${summed} but splits to ${expected}.`);
      }
    }
    for (const payment of data.payments.filter((entry) => entry.orderId === order.id)) {
      if (payment.status === 'paid' && !payment.paidAt) {
        fail('payment.paid_without_date', `A payment on ${order.orderCode} is paid without a date.`);
      }
    }
  }

  // A review is a real purchase: it must sit on a delivered order line, have an
  // author, and be flagged on that line so the customer is no longer offered a
  // "write a review" action for an item that is already reviewed.
  for (const review of data.reviews) {
    const line = data.sellerOrders
      .flatMap((entry) => entry.items || [])
      .find((item) => item.id === review.orderItemId);
    if (!line) {
      fail('review.missing_line', `Review ${review.id} does not match any order line.`);
      continue;
    }
    if (line.status !== 'delivered') {
      fail('review.undelivered', `Review ${review.id} sits on a line that is ${line.status}.`);
    }
    if (!users.has(review.userId)) {
      fail('review.missing_user', `Review ${review.id} has no author account.`);
    }
    if (!line.hasReview || line.reviewId !== review.id) {
      fail('review.line_not_flagged', `Order line ${line.id} is reviewed by ${review.id} but is not flagged as reviewed.`);
    }
  }
  const reviewIds = new Set(data.reviews.map((review) => review.id));
  for (const entry of data.sellerOrders) {
    for (const item of entry.items || []) {
      if (item.hasReview && !reviewIds.has(item.reviewId)) {
        fail('review.dangling_flag', `Order line ${item.id} points at missing review ${item.reviewId}.`);
      }
    }
  }

  // A live listing must be buyable: visible store, positive stock, a price.
  for (const product of data.products) {
    if (product.status !== 'active') continue;
    const store = stores.get(product.storeId);
    if (!store) continue;
    if (store.status !== 'active') {
      fail('catalog.hidden_store', `Live product ${product.id} belongs to paused store ${store.id}.`);
    }
    const stock = (product.variants || []).length
      ? Math.max(...product.variants.map((variant) => variant.stock))
      : product.stock;
    if (!(stock > 0)) fail('catalog.no_stock', `Live product ${product.id} has no stock.`);
    if (store.sellerId && sellers.get(store.sellerId)?.status !== 'active') {
      fail('catalog.inactive_seller', `Live product ${product.id} belongs to a non-active seller.`);
    }
  }

  // Cart lines must point at products that still exist.
  for (const cart of data.carts) {
    for (const item of cart.items || []) {
      if (!products.has(item.productId)) {
        fail('cart.missing_product', `Cart ${cart.id} references removed product ${item.productId}.`);
      }
    }
  }

  // Vouchers must belong to a real seller (or the system account).
  for (const voucher of data.vouchers) {
    if (voucher.sellerId && voucher.sellerId !== 'system' && !sellers.has(voucher.sellerId)) {
      fail('voucher.missing_seller', `Voucher ${voucher.code} belongs to unknown seller ${voucher.sellerId}.`);
    }
  }
}

async function readSnapshot(page) {
  return page.evaluate((collections) => {
    const out = {};
    for (const name of collections) {
      const raw = window.localStorage.getItem('vanta.collection.' + name);
      out[name] = raw ? JSON.parse(raw) : [];
    }
    return out;
  }, COLLECTIONS);
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error(`No export found in ${DIST}. Run: npx expo export --platform web --output-dir dist`);
    process.exit(1);
  }

  const { createStaticServer } = (() => {
    const http = require('http');
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ttf': 'font/ttf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ico': 'image/x-icon',
    };
    return {
      createStaticServer: () =>
        http.createServer((req, res) => {
          const clean = decodeURIComponent((req.url || '/').split('?')[0]);
          let file = path.join(DIST, clean);
          if (!file.startsWith(DIST)) {
            res.writeHead(403);
            res.end();
            return;
          }
          if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
          if (!fs.existsSync(file)) file = path.join(DIST, 'index.html');
          res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
          fs.createReadStream(file).pipe(res);
        }),
    };
  })();

  const port = Number(new URL(BASE).port || 8100);
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(port, resolve));

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const failures = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error) => failures.push(String(error).slice(0, 160)));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await page.evaluate(() => window.localStorage.clear());
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => Boolean(window.localStorage.getItem('vanta.collection.categories')),
      { timeout: 30000 },
    );
    await sleep(1200);

    const first = await readSnapshot(page);
    checkEmptyBoot(first);
    // The empty boot has almost no graph to walk, but running the checks anyway
    // keeps one code path: they are what will catch a future re-seed instantly.
    checkIntegrity(first);
    const counts = COLLECTIONS.map((name) => `${name}=${first[name].length}`).join(' ');

    // Empty state must survive a restart: nothing is re-created on the way back.
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);
    const second = await readSnapshot(page);
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      fail('empty.not_stable', 'A plain restart changed the local data; the taxonomy marker guard is not holding.');
    }

    // Simulate the user deleting their own data: emptying the marketplace must
    // stay empty. This is the "does not silently re-seed itself" check — a boot
    // that reinstalls the dataset would repopulate it here.
    await page.evaluate((collections) => {
      for (const name of collections) {
        window.localStorage.setItem('vanta.collection.' + name, '[]');
      }
      window.localStorage.removeItem('vanta.meta.taxonomy');
    }, COLLECTIONS);
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(
      () => Boolean(window.localStorage.getItem('vanta.collection.categories')),
      { timeout: 30000 },
    );
    await sleep(1200);
    const third = await readSnapshot(page);
    checkEmptyBoot(third);

    // Seller Mode must default OFF and must not appear unless it was set.
    const sellerModeDefault = await page.evaluate(() => window.localStorage.getItem('vanta.prefs.sellerMode'));
    if (sellerModeDefault !== null) {
      fail('sellermode.not_off_by_default', `Seller Mode was written on a fresh launch ("${sellerModeDefault}"). It must default to OFF.`);
    }

    // ---- Legacy upgrade path -------------------------------------------------
    // A device that ran the old seeded build and was then used by a real person.
    // The demo rows must go, the real rows must survive, and neither side may
    // leave a dangling reference behind.
    const seededCategories = third.categories;
    await page.evaluate(
      (fixture, categories) => {
        for (const name of Object.keys(fixture)) {
          window.localStorage.setItem('vanta.collection.' + name, JSON.stringify(fixture[name]));
        }
        window.localStorage.setItem('vanta.collection.categories', JSON.stringify(categories));
        window.localStorage.setItem('vanta.meta.seeded', '1');
      },
      buildLegacyFixture(seededCategories),
      seededCategories,
    );
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1800);
    const migrated = await readSnapshot(page);
    checkLegacyMigration(migrated);
    // The graph that is left must still be internally consistent.
    checkIntegrity(migrated);
    const legacyMarker = await page.evaluate(() => window.localStorage.getItem('vanta.meta.seeded'));
    if (legacyMarker !== null) {
      fail('legacy.marker_remains', 'The legacy seed marker was not cleared, so the migration would run on every boot.');
    }
    const legacyCounts = COLLECTIONS.map((name) => `${name}=${migrated[name].length}`).join(' ');
    console.log(`  after the legacy upgrade: ${legacyCounts}`);

    console.log('Empty-marketplace integrity audit');
    console.log(`  ${counts}`);
    console.log(`  page errors: ${failures.length}`);
    for (const failure of failures) console.log(`    ${failure}`);
    if (failures.length) fail('page.errors', `${failures.length} page error(s) during boot.`);

    if (problems.length) {
      console.log(`  problems: ${problems.length}`);
      for (const problem of problems) console.log(`    ${problem.code} | ${problem.message}`);
    } else {
      console.log('  problems: 0 — the app starts empty and what it writes is consistent.');
    }
  } finally {
    await browser.close();
    server.close();
  }

  process.exitCode = problems.length ? 1 : 0;
}

main();