/**
 * Seller service (M7-I).
 *
 * Every entry point takes the *authenticated* seller id. No method accepts a
 * seller id from the request, so a caller cannot read or mutate another seller's
 * profile, listings, orders or inventory even by guessing ids. An id that is not
 * owned returns 404 rather than 403, so the API does not confirm that the
 * resource exists.
 */
import { productStock, stockLevelOf } from '../../../shared/catalog-rules';
import type { SharedProduct } from '../../../shared/types';
import { AppError } from '../http/errors';
import { newId, nowIso } from '../lib/identity';
import type {
  AuditLogEntity,
  InventoryAdjustmentEntity,
  OrderEntity,
  ProductEntity,
  ProductStatus,
  SellerOrderEntity,
  SellerProfileEntity,
  StoreEntity,
  UserEntity,
} from '../domain/entities';
import type { RepositoryBundle } from '../repositories/contracts';

export interface InventoryRow {
  productId: string;
  name: string;
  status: ProductStatus;
  stock: number;
  lowStockThreshold: number;
  level: 'out' | 'low' | 'healthy';
}

export interface InventorySummary {
  sellerId: string;
  storeId: string;
  totalProducts: number;
  activeProducts: number;
  totalUnits: number;
  outOfStock: number;
  lowStock: number;
  healthy: number;
  rows: InventoryRow[];
}

export interface SellerDashboard {
  seller: SellerProfileEntity;
  store: StoreEntity;
  productCount: number;
  orderCount: number;
  pendingFulfilment: number;
  revenue: number;
}

export interface SellerRegistrationInput {
  fullName: string;
  phone: string;
  email: string;
  nationalId: string;
  sellerType: 'individual' | 'business';
  entityName?: string;
  storeName: string;
  storeDescription: string;
  storeLogo?: string;
  storeBanner?: string;
  shippingFee?: number;
  freeShippingThreshold?: number;
  deliveryEstimateDays?: { min: number; max: number };
  pickupDivision: string;
  pickupDistrict: string;
  pickupArea?: string;
  pickupAddressLine: string;
  returnDivision: string;
  returnDistrict: string;
  returnArea?: string;
  returnAddressLine: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch?: string;
  agreement: {
    marketplaceTerms: boolean;
    sellerPolicies: boolean;
    productAuthenticity: boolean;
    fulfillmentResponsibility: boolean;
  };
}

/**
 * M8: audit action names, spelled out rather than derived.
 *
 * Deriving them (`${decision}d`) produced `rejectd` and `suspendd`, which are
 * useless to anyone reading the trail or writing a query against it.
 */
const SELLER_DECISION_ACTIONS = {
  approve: 'seller_application_approved',
  reject: 'seller_application_rejected',
  suspend: 'seller_suspended',
} as const;

export class SellerService {
  constructor(private readonly repos: RepositoryBundle) {}

  /**
   * Resolves the seller behind the token, or 403 when the account may not act as
   * one.
   *
   * Only `active` sellers get through. A `pending` profile — what self-registration
   * creates — is refused, because letting an unreviewed account publish products
   * and fulfil orders is exactly what the review step exists to prevent. A
   * `suspended` seller is refused for the obvious reason.
   */
  async sellerForUser(userId: string): Promise<SellerProfileEntity> {
    const seller = await this.repos.sellers.findByUserId(userId);
    if (!seller) throw AppError.forbidden('This account is not registered as a seller.');
    if (seller.status === 'suspended') {
      throw AppError.forbidden('This seller account is suspended. Contact support.');
    }
    if (seller.status !== 'active') {
      throw AppError.forbidden('This seller account is awaiting approval.');
    }
    return seller;
  }

  async profile(sellerId: string): Promise<SellerProfileEntity> {
    const seller = await this.repos.sellers.findById(sellerId);
    if (!seller) throw AppError.notFound('Seller not found.');
    return seller;
  }

  /**
   * Seller onboarding (M7-R).
   *
   * Creates the store, the seller profile and the `seller` role for the
   * *authenticated* account. The role is granted here, server-side, because a
   * client that granted it to itself would only be editing its own local record —
   * every `/seller/*` route authorises from the token's user, so the role has to
   * exist in the datastore the API reads.
   *
   * One account can only be a seller once; a second attempt is a conflict rather
   * than a silent overwrite of the existing store.
   */
  async registerSeller(userId: string, input: SellerRegistrationInput): Promise<{ profile: SellerProfileEntity; store: StoreEntity }> {
    const existing = await this.repos.sellers.findByUserId(userId);
    if (existing) throw AppError.conflict('This account already has a seller profile.');

    const user = await this.repos.users.findById(userId);
    if (!user) throw AppError.unauthorized('Sign in to continue.');

    const now = nowIso();
    const sellerId = newId('sel');
    const storeId = newId('sto');

    const store: StoreEntity = {
      id: storeId,
      sellerId,
      name: input.storeName,
      description: input.storeDescription,
      logo: input.storeLogo || '',
      banner: input.storeBanner || '',
      // M8: a store exists the moment it is applied for, but it is not public
      // until an approver activates the seller. Marking it `active` here would
      // publish an unreviewed shop to anyone who guessed or leaked its id.
      status: 'pending',
      ratingAvg: 0,
      ratingCount: 0,
      responseRate: 0,
      responseTimeMinutes: 0,
      productCount: 0,
      followerCount: 0,
      shippingFee: input.shippingFee ?? 60,
      freeShippingThreshold: input.freeShippingThreshold ?? 2000,
      deliveryEstimateDays: input.deliveryEstimateDays ?? { min: 2, max: 5 },
      location: [input.pickupArea, input.pickupDistrict, input.pickupDivision].filter(Boolean).join(', '),
      verified: false,
      createdAt: now,
      updatedAt: now,
    };

    const seller: SellerProfileEntity = {
      id: sellerId,
      userId,
      storeId,
      fullName: input.fullName,
      phone: input.phone,
      email: input.email,
      nationalId: input.nationalId,
      sellerType: input.sellerType,
      entityName: input.entityName,
      pickupDivision: input.pickupDivision,
      pickupDistrict: input.pickupDistrict,
      pickupArea: input.pickupArea ?? '',
      pickupAddressLine: input.pickupAddressLine,
      returnDivision: input.returnDivision,
      returnDistrict: input.returnDistrict,
      returnArea: input.returnArea ?? '',
      returnAddressLine: input.returnAddressLine,
      bank: {
        bankName: input.bankName,
        accountName: input.accountName,
        accountNumber: input.accountNumber,
        branch: input.branch,
      },
      agreement: input.agreement,
      // A self-registered seller is not trusted until reviewed, so it starts
      // pending and `sellerForUser` refuses it until an operator activates it.
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await this.repos.stores.insert(store);
    await this.repos.sellers.insert(seller);
    // M8: the `seller` role is deliberately NOT granted here. It is granted by
    // `decideApplication` on approval and removed on rejection or suspension, so
    // the role and the reviewable state can never drift apart. The applicant's own
    // endpoints authorise from the token and read the profile status directly.

    return { profile: seller, store };
  }

  async store(sellerId: string): Promise<StoreEntity> {
    const store = await this.repos.stores.findBySellerId(sellerId);
    if (!store) throw AppError.notFound('Store not found.');
    return store;
  }

  // ------------------------------------------------------------------ M8
  /**
   * M8: the applicant's own view of their application.
   *
   * Deliberately separate from `sellerForUser`, which refuses anything that is not
   * `active`. Without this, a correctly-refused seller area would leave a pending
   * applicant with no way to learn *why* — the 403 is correct, the silence is not.
   */
  async applicationForUser(userId: string): Promise<{
    profile: SellerProfileEntity;
    store: StoreEntity;
    canUseSellerArea: boolean;
  }> {
    const profile = await this.repos.sellers.findByUserId(userId);
    if (!profile) throw AppError.notFound('No seller application exists for this account.');
    const store = await this.repos.stores.findBySellerId(profile.id);
    if (!store) throw AppError.notFound('Store not found.');
    return { profile, store, canUseSellerArea: profile.status === 'active' };
  }

  /** M8: the approval queue. Guarded by `requireRole` in the router, not here. */
  async listApplications(status: SellerProfileEntity['status']): Promise<SellerProfileEntity[]> {
    return this.repos.sellers.listByStatus(status);
  }

  /**
   * M8: an approver's decision on an application.
   *
   * Three properties matter and each is enforced here rather than trusted to the
   * caller:
   *   1. only an `active` profile may be re-activated from `rejected`;
   *   2. a decision is idempotent — deciding `pending` twice is a no-op, not a
   *      second write, so a retried request cannot silently rewrite a review;
   *   3. the applicant is notified, and the decision is written to the audit log
   *      with the approver's id, so "who approved this" is answerable later.
   */
  async decideApplication(
    approver: UserEntity,
    sellerId: string,
    decision: 'approve' | 'reject' | 'suspend',
    note?: string,
  ): Promise<SellerProfileEntity> {
    if (!approver.roles.includes('seller_approver')) {
      throw AppError.forbidden('Only a seller approver can decide an application.');
    }
    const seller = await this.repos.sellers.findById(sellerId);
    if (!seller) throw AppError.notFound('Seller not found.');

    const nextStatus: SellerProfileEntity['status'] =
      decision === 'approve' ? 'active' : decision === 'reject' ? 'rejected' : 'suspended';

    // M8: a decision that changes nothing is a conflict, not a silent success.
    // Returning the profile unchanged would let a UI show "approved" for a seller
    // that was never reviewed, and would hide a repeated submit from the audit log.
    if (seller.status === nextStatus) {
      throw AppError.conflict(`This application is already ${nextStatus}.`);
    }
    if (decision === 'suspend' && seller.status !== 'active') {
      throw AppError.unprocessable('Only an active seller can be suspended.');
    }
    if (decision === 'approve' && seller.status === 'suspended') {
      throw AppError.unprocessable('A suspended seller must be reinstated, not approved.');
    }

    const timestamp = nowIso();
    const noteText = note?.trim();
    const updated = await this.repos.sellers.patch(sellerId, {
      status: nextStatus,
      reviewedBy: approver.id,
      reviewedAt: timestamp,
      reviewNote: noteText ? noteText : undefined,
    });
    if (!updated) throw AppError.notFound('Seller not found.');

    // The store follows the seller: activating the seller without the store would
    // leave an approved seller owning a shop the catalog still hides, and vice
    // versa. Doing it here — in one place, next to the status write — is what
    // keeps the two in step.
    await this.repos.stores.patch(seller.storeId, {
      status: nextStatus === 'active' ? 'active' : 'paused',
    });

    // The role is the third thing that has to move together with the status.
    if (nextStatus === 'active') {
      await this.repos.users.addRole(seller.userId, 'seller');
    } else {
      await this.repos.users.removeRole(seller.userId, 'seller');
    }

    await this.repos.audit.insert({
      id: newId('aud'),
      action: SELLER_DECISION_ACTIONS[decision],
      actorId: approver.id,
      subjectId: sellerId,
      subjectType: 'seller',
      data: { from: seller.status, to: nextStatus, note: noteText ?? '' },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const title =
      nextStatus === 'active' ? 'Seller account approved' : nextStatus === 'rejected' ? 'Seller application not approved' : 'Seller account suspended';
    const body =
      nextStatus === 'active'
        ? 'Your store is now active and the Seller Center is unlocked.'
        : noteText
          ? noteText
          : 'Open a support request if you think this is a mistake.';
    await this.repos.notifications.insert({
      id: newId('ntf'),
      userId: seller.userId,
      type: 'seller_account_status',
      title,
      body,
      read: false,
      data: { sellerId, status: nextStatus },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return updated;
  }

  /** M8: the review trail for one application, for an approver. */
  async applicationHistory(sellerId: string): Promise<AuditLogEntity[]> {
    return this.repos.audit.listForSubject('seller', sellerId);
  }

  async dashboard(sellerId: string): Promise<SellerDashboard> {
    const seller = await this.profile(sellerId);
    const store = await this.store(sellerId);
    const [products, sellerOrders] = await Promise.all([
      this.repos.products.query({ sellerId, limit: 1000 }),
      this.repos.sellerOrders.listForSeller(sellerId),
    ]);
    const pendingStatuses = new Set(['new', 'confirmed', 'processing', 'packed', 'ready_to_ship']);
    return {
      seller,
      store,
      productCount: products.length,
      orderCount: sellerOrders.length,
      pendingFulfilment: sellerOrders.filter((order) => pendingStatuses.has(order.status)).length,
      revenue: sellerOrders
        .filter((order) => order.status === 'delivered')
        .reduce((sum, order) => sum + order.total, 0),
    };
  }

  async listProducts(sellerId: string, statuses?: ProductStatus[]): Promise<ProductEntity[]> {
    return this.repos.products.query({ sellerId, statuses, limit: 200 });
  }

  async setProductStatus(sellerId: string, productId: string, status: ProductStatus) {
    const product = await this.repos.products.findById(productId);
    if (!product || product.sellerId !== sellerId) throw AppError.notFound('This listing is no longer available.');
    const updated = await this.repos.products.patch(productId, { status, updatedAt: nowIso() });
    if (!updated) throw AppError.notFound('This listing is no longer available.');
    if (status === 'paused' || status === 'out_of_stock') {
      const stock = productStock(updated as SharedProduct);
      if (stock <= 0) {
        await this.repos.products.patch(productId, { status: 'out_of_stock' });
      }
    }
    return updated;
  }

  async adjustStock(
    sellerId: string,
    productId: string,
    input: { quantity: number; variantId?: string; reason: InventoryAdjustmentEntity['reason'] },
  ) {
    const product = await this.repos.products.findById(productId);
    if (!product || product.sellerId !== sellerId) throw AppError.notFound('This listing is no longer available.');
    const quantity = Math.trunc(input.quantity);
    if (quantity === 0) {
      throw AppError.validation('Enter a non-zero quantity.', [{ field: 'quantity', message: 'Enter a non-zero quantity.' }]);
    }
    const result = await this.repos.products.adjustStock(productId, quantity, input.variantId ?? null);
    if (!result.ok || !result.product) {
      throw AppError.unprocessable('That adjustment would take stock below zero.');
    }
    const timestamp = nowIso();
    await this.repos.inventoryAdjustments.insert({
      id: newId('adj'),
      productId,
      sellerId,
      variantId: input.variantId ?? null,
      quantity,
      reason: input.reason,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return result.product;
  }

  async inventorySummary(sellerId: string): Promise<InventorySummary> {
    const store = await this.store(sellerId);
    const products = await this.repos.products.query({ sellerId, limit: 1000 });
    const rows: InventoryRow[] = products.map((product) => {
      const stock = productStock(product as SharedProduct);
      return {
        productId: product.id,
        name: product.name,
        status: product.status,
        stock,
        lowStockThreshold: product.lowStockThreshold,
        level: stockLevelOf(product as SharedProduct),
      };
    });
    return {
      sellerId,
      storeId: store.id,
      totalProducts: products.length,
      activeProducts: products.filter((product) => product.status === 'active').length,
      totalUnits: rows.reduce((sum, row) => sum + row.stock, 0),
      outOfStock: rows.filter((row) => row.level === 'out').length,
      lowStock: rows.filter((row) => row.level === 'low').length,
      healthy: rows.filter((row) => row.level === 'healthy').length,
      rows: rows.sort((a, b) => a.stock - b.stock),
    };
  }

  async inventoryAdjustments(sellerId: string, productId?: string): Promise<InventoryAdjustmentEntity[]> {
    if (productId) {
      const product = await this.repos.products.findById(productId);
      if (!product || product.sellerId !== sellerId) throw AppError.notFound('This listing is no longer available.');
      return this.repos.inventoryAdjustments.listForProduct(productId);
    }
    return this.repos.inventoryAdjustments.listForSeller(sellerId);
  }

  async listOrders(sellerId: string): Promise<SellerOrderEntity[]> {
    return this.repos.sellerOrders.listForSeller(sellerId);
  }

  async getOrder(sellerId: string, sellerOrderId: string): Promise<SellerOrderEntity> {
    const sellerOrder = await this.repos.sellerOrders.findById(sellerOrderId);
    if (!sellerOrder || sellerOrder.sellerId !== sellerId) throw AppError.notFound('Order not found.');
    return sellerOrder;
  }

  async ordersForCustomerOrders(sellerId: string, orderId: string): Promise<OrderEntity[]> {
    const sellerOrders = await this.repos.sellerOrders.listForOrder(orderId);
    if (sellerOrders.length === 0 || sellerOrders[0].sellerId !== sellerId) throw AppError.notFound('Order not found.');
    const order = await this.repos.orders.findById(orderId);
    return order ? [order] : [];
  }
}
