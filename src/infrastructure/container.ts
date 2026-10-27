import { LocalDatabase } from '@/database/local-database';
import {
  LocalAddressRepository,
  LocalCartRepository,
  LocalCategoryRepository,
  LocalInventoryAdjustmentRepository,
  LocalNotificationRepository,
  LocalOrderRepository,
  LocalPaymentRepository,
  LocalProductRepository,
  LocalPromotionRepository,
  LocalRecentlyViewedRepository,
  LocalReturnRequestRepository,
  LocalReviewRepository,
  LocalSearchHistoryRepository,
  LocalSellerOrderRepository,
  LocalSellerRepository,
  LocalSessionRepository,
  LocalStoreFollowerRepository,
  LocalStoreRepository,
  LocalUserRepository,
  LocalVoucherRepository,
  LocalWishlistRepository,
} from '@/repositories/local/local-repositories';
import { AsyncStorageAdapter, LocalDeviceImageStorage, LocalSessionStorage } from '@/storage/implementations';

export interface RepositoryMap {
  users: LocalUserRepository;
  sessions: LocalSessionRepository;
  categories: LocalCategoryRepository;
  sellers: LocalSellerRepository;
  stores: LocalStoreRepository;
  products: LocalProductRepository;
  carts: LocalCartRepository;
  wishlists: LocalWishlistRepository;
  addresses: LocalAddressRepository;
  vouchers: LocalVoucherRepository;
  promotions: LocalPromotionRepository;
  orders: LocalOrderRepository;
  sellerOrders: LocalSellerOrderRepository;
  payments: LocalPaymentRepository;
  reviews: LocalReviewRepository;
  returnRequests: LocalReturnRequestRepository;
  notifications: LocalNotificationRepository;
  searchHistory: LocalSearchHistoryRepository;
  recentlyViewed: LocalRecentlyViewedRepository;
  storeFollowers: LocalStoreFollowerRepository;
  inventoryAdjustments: LocalInventoryAdjustmentRepository;
}

export class Container {
  readonly db: LocalDatabase;
  readonly imageStorage: LocalDeviceImageStorage;
  readonly sessionStorage: LocalSessionStorage;
  readonly repositories: RepositoryMap;

  constructor() {
    const storage = new AsyncStorageAdapter();
    this.db = new LocalDatabase(storage);
    this.imageStorage = new LocalDeviceImageStorage();
    this.sessionStorage = new LocalSessionStorage(storage);
    this.repositories = {
      users: new LocalUserRepository(this.db),
      sessions: new LocalSessionRepository(this.db),
      categories: new LocalCategoryRepository(this.db),
      sellers: new LocalSellerRepository(this.db),
      stores: new LocalStoreRepository(this.db),
      products: new LocalProductRepository(this.db),
      carts: new LocalCartRepository(this.db),
      wishlists: new LocalWishlistRepository(this.db),
      addresses: new LocalAddressRepository(this.db),
      vouchers: new LocalVoucherRepository(this.db),
      promotions: new LocalPromotionRepository(this.db),
      orders: new LocalOrderRepository(this.db),
      sellerOrders: new LocalSellerOrderRepository(this.db),
      payments: new LocalPaymentRepository(this.db),
      reviews: new LocalReviewRepository(this.db),
      returnRequests: new LocalReturnRequestRepository(this.db),
      notifications: new LocalNotificationRepository(this.db),
      searchHistory: new LocalSearchHistoryRepository(this.db),
      recentlyViewed: new LocalRecentlyViewedRepository(this.db),
      storeFollowers: new LocalStoreFollowerRepository(this.db),
      inventoryAdjustments: new LocalInventoryAdjustmentRepository(this.db),
    };
  }
}

let instance: Container | null = null;

export function getContainer(): Container {
  if (!instance) {
    instance = new Container();
  }
  return instance;
}