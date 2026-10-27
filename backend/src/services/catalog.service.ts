/**
 * Catalog read service (M7-I).
 *
 * Visibility rules come from `shared/catalog-rules` — the same code the app runs
 * — with the store/seller lookups bound to this repository bundle. A listing that
 * the device would hide (paused store, suspended seller, non-active product) is
 * therefore also hidden by the API, and `visibleOnly` is applied to every
 * customer-facing listing.
 */
import { customerVisibility, effectivePrice, productStock } from '../../../shared/catalog-rules';
import type { CatalogLookups, SharedProduct } from '../../../shared/types';
import { AppError } from '../http/errors';
import type { CategoryEntity, ProductEntity, ProductStatus, SellerProfileEntity, StoreEntity } from '../domain/entities';
import type { ProductQuery, RepositoryBundle } from '../repositories/contracts';

export interface CatalogSummary {
  productCount: number;
  activeCount: number;
  storeCount: number;
  sellerCount: number;
  categoryCount: number;
}

export interface StoreSummary extends StoreEntity {
  seller: Pick<SellerProfileEntity, 'id' | 'fullName' | 'status' | 'sellerType'>;
  productCount: number;
}

export interface ProductDetail {
  product: ProductEntity;
  store: StoreEntity | null;
  seller: SellerProfileEntity | null;
  effectivePrice: number;
  availableStock: number;
  visible: boolean;
}

export class CatalogService {
  constructor(private readonly repos: RepositoryBundle) {}

  /**
   * The shared visibility contract is synchronous, so the two lookups a product
   * needs are resolved first and captured. Same code path as the device, so the
   * server and the app agree on exactly which listings are orderable.
   */
  private async lookupsFor(product: ProductEntity): Promise<CatalogLookups> {
    const store = (await this.repos.stores.findById(product.storeId)) ?? (await this.repos.stores.findBySellerId(product.sellerId));
    const seller = await this.repos.sellers.findById(product.sellerId);
    return {
      getStoreById: () => store as never,
      getStoreBySellerId: () => store as never,
      getSellerById: () => seller as never,
    };
  }

  async listCategories(): Promise<CategoryEntity[]> {
    return this.repos.categories.list();
  }

  async listProducts(input: {
    sellerId?: string;
    categoryId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    includeHidden?: boolean;
  }): Promise<{ items: ProductEntity[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(Math.max(input.pageSize ?? 20, 1), 60);
    const page = Math.max(input.page ?? 1, 1);
    const query: ProductQuery = {
      sellerId: input.sellerId,
      categoryId: input.categoryId,
      search: input.search?.trim() || undefined,
      offset: (page - 1) * pageSize,
      limit: pageSize,
      statuses: input.includeHidden ? undefined : ['active'],
    };
    const [items, total] = await Promise.all([this.repos.products.query(query), this.repos.products.count(query)]);
    return { items, total, page, pageSize };
  }

  async getProduct(id: string, options: { includeHidden?: boolean } = {}): Promise<ProductDetail> {
    const product = await this.repos.products.findById(id);
    if (!product) throw AppError.notFound('This listing is no longer available.');
    const store = await this.repos.stores.findById(product.storeId);
    const seller = await this.repos.sellers.findById(product.sellerId);
    const visibility = customerVisibility(product as SharedProduct, await this.lookupsFor(product));
    if (!visibility.visible && !options.includeHidden) {
      throw AppError.notFound('This listing is no longer available.');
    }
    return {
      product,
      store,
      seller,
      effectivePrice: effectivePrice(product as SharedProduct),
      availableStock: productStock(product as SharedProduct),
      visible: visibility.visible,
    };
  }

  async getStore(sellerIdOrStoreId: string): Promise<StoreSummary> {
    const store =
      (await this.repos.stores.findById(sellerIdOrStoreId)) ??
      (await this.repos.stores.findBySellerId(sellerIdOrStoreId));
    if (!store) throw AppError.notFound('Store not found.');
    // M8: a store only becomes publicly readable once it is active. Before that it
    // is either awaiting review or paused, and a public endpoint must not be the
    // place a shopper learns either fact.
    if (store.status !== 'active') throw AppError.notFound('Store not found.');
    const seller = await this.repos.sellers.findById(store.sellerId);
    if (!seller) throw AppError.notFound('Store not found.');
    const productCount = await this.repos.products.count({ sellerId: store.sellerId, statuses: ['active'] });
    return {
      ...store,
      seller: { id: seller.id, fullName: seller.fullName, status: seller.status, sellerType: seller.sellerType },
      productCount,
    };
  }

  async summary(): Promise<CatalogSummary> {
    const [products, stores, sellers, categories] = await Promise.all([
      this.repos.products.query({ limit: 1000 }),
      this.repos.stores.list(),
      this.repos.sellers.list(),
      this.repos.categories.list(),
    ]);
    return {
      productCount: products.length,
      activeCount: products.filter((product) => product.status === 'active').length,
      storeCount: stores.length,
      sellerCount: sellers.length,
      categoryCount: categories.length,
    };
  }

  /** Seller-owned listing write. Ownership is checked from the token, not input. */
  async updateProductStatus(
    sellerId: string,
    productId: string,
    status: ProductStatus,
  ): Promise<ProductEntity> {
    const product = await this.repos.products.findById(productId);
    if (!product || product.sellerId !== sellerId) throw AppError.notFound('This listing is no longer available.');
    const updated = await this.repos.products.patch(productId, { status });
    if (!updated) throw AppError.notFound('This listing is no longer available.');
    return updated;
  }
}
