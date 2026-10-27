import { getContainer } from '@/infrastructure/container';
import type { OrderItemSnapshot, Review } from '@/domain/types';
import { vantaApi } from '@/api/vanta-api';
import { ApiError } from '@/api/api-client';
import { applyReview, applyReviewRemoval } from '@/api/remote-reviews';

export interface ReviewBreakdown {
  average: number;
  total: number;
  distribution: { rating: number; count: number }[];
  verifiedCount: number;
}

export type ReviewEligibilityReason =
  | 'can_review'
  | 'already_reviewed'
  | 'not_delivered'
  | 'not_found'
  | 'not_yours';

export interface ReviewEligibility {
  can: boolean;
  reason: ReviewEligibilityReason;
  reviewId?: string;
  orderId?: string;
  sellerOrderId?: string;
  productId?: string;
  sellerId?: string;
  item?: OrderItemSnapshot;
}

export interface CreateReviewInput {
  orderItemId: string;
  sellerOrderId: string;
  orderId: string;
  productId: string;
  sellerId: string;
  rating: number;
  title: string;
  text: string;
  images: string[];
}

export interface SellerReviewView {
  review: Review;
  productName: string;
  productId: string;
  rating: number;
  verified: boolean;
  hasReply: boolean;
  replyText: string | null;
  orderCode: string | null;
  listingStatus: 'live' | 'hidden' | 'missing';
}

export interface SellerReviewFilters {
  search?: string;
  rating?: number | 'all';
  reply?: 'all' | 'replied' | 'awaiting';
  verified?: 'all' | 'verified' | 'unverified';
  productId?: string;
}

const MAX_TEXT = 1000;

export class ReviewService {
  eligibility(userId: string, orderItemId: string): ReviewEligibility {
    const { repositories } = getContainer();
    const existing = repositories.reviews.getByOrderItem(orderItemId);
    if (existing) {
      return {
        can: false,
        reason: existing.userId === userId ? 'already_reviewed' : 'not_yours',
        reviewId: existing.id,
      };
    }
    for (const sellerOrder of repositories.sellerOrders.list()) {
      const item = sellerOrder.items.find((entry) => entry.id === orderItemId);
      if (!item) continue;
      const order = repositories.orders.getById(sellerOrder.orderId);
      // An orphaned seller order must not end the search: returning here made one
      // dangling row make every later order item permanently unreviewable.
      if (!order) continue;
      if (order.customerId !== userId) return { can: false, reason: 'not_yours' };
      if (item.status !== 'delivered') {
        return {
          can: false,
          reason: 'not_delivered',
          orderId: order.id,
          sellerOrderId: sellerOrder.id,
          productId: item.productId,
          sellerId: sellerOrder.sellerId,
          item,
        };
      }
      return {
        can: true,
        reason: 'can_review',
        orderId: order.id,
        sellerOrderId: sellerOrder.id,
        productId: item.productId,
        sellerId: sellerOrder.sellerId,
        item,
      };
    }
    return { can: false, reason: 'not_found' };
  }

  canReview(userId: string, orderItemId: string): { can: boolean; reason?: string } {
    const outcome = this.eligibility(userId, orderItemId);
    return { can: outcome.can, reason: outcome.can ? undefined : outcome.reason };
  }

  reviewableForUser(userId: string): ReviewEligibility[] {
    const { repositories } = getContainer();
    const results: ReviewEligibility[] = [];
    for (const order of repositories.orders.listForCustomer(userId)) {
      for (const sellerOrderId of order.sellerOrderIds) {
        const sellerOrder = repositories.sellerOrders.getById(sellerOrderId);
        if (!sellerOrder) continue;
        for (const item of sellerOrder.items) {
          if (item.status !== 'delivered') continue;
          if (repositories.reviews.getByOrderItem(item.id)) continue;
          results.push({
            can: true,
            reason: 'can_review',
            orderId: order.id,
            sellerOrderId: sellerOrder.id,
            productId: item.productId,
            sellerId: sellerOrder.sellerId,
            item,
          });
        }
      }
    }
    return results;
  }

  async create(userId: string, input: CreateReviewInput): Promise<Review> {
    void userId;
    // The server owns the user record, eligibility and the write: it re-checks
    // ownership and the delivered line, and owns the review id.
    try {
      const { review } = await vantaApi.createReview({
        orderItemId: input.orderItemId,
        rating: input.rating,
        title: input.title,
        text: input.text,
        images: input.images,
        orderId: input.orderId,
        sellerOrderId: input.sellerOrderId,
        productId: input.productId,
        sellerId: input.sellerId,
      });
      return applyReview(review);
    } catch (error) {
      throw error instanceof ApiError ? new Error(error.message) : error;
    }
  }

  update(
    _userId: string,
    reviewId: string,
    patch: { rating?: number; title?: string; text?: string; images?: string[] },
  ): Promise<Review> {
    // The server is the author's authority (it 404s a foreign review) and owns
    // the aggregate recompute. Mirror the returned row so every screen that reads
    // the local collection sees the edit immediately.
    return vantaApi
      .updateReview(reviewId, patch)
      .then(({ review }) => applyReview(review))
      .catch((error: unknown) => {
        throw error instanceof ApiError ? new Error(error.message) : error;
      });
  }

  remove(userId: string, reviewId: string): Promise<void> {
    void userId;
    return vantaApi
      .deleteReview(reviewId)
      .then(() => applyReviewRemoval(reviewId))
      .catch((error: unknown) => {
        throw error instanceof ApiError ? new Error(error.message) : error;
      });
  }

  listForProduct(productId: string, limit?: number): Review[] {
    const reviews = getContainer().repositories.reviews.listForProduct(productId);
    const sorted = [...reviews].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  breakdown(productId: string): ReviewBreakdown {
    const reviews = getContainer().repositories.reviews.listForProduct(productId);
    const distribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: reviews.filter((entry) => entry.rating === rating).length,
    }));
    const average = reviews.length
      ? reviews.reduce((sum, entry) => sum + entry.rating, 0) / reviews.length
      : 0;
    return {
      average,
      total: reviews.length,
      distribution,
      verifiedCount: reviews.filter((entry) => entry.verifiedPurchase).length,
    };
  }

  listForUser(userId: string): Review[] {
    const reviews = getContainer().repositories.reviews.listForUser(userId);
    return [...reviews].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  listForStore(storeId: string, limit?: number): Review[] {
    const { repositories } = getContainer();
    const sellerId = repositories.stores.getById(storeId)?.sellerId;
    if (!sellerId) return [];
    const reviews = repositories.reviews.listForSeller(sellerId);
    const sorted = [...reviews].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  forSeller(sellerId: string, filters: SellerReviewFilters = {}): SellerReviewView[] {
    const { repositories } = getContainer();
    const views = repositories.reviews
      .listForSeller(sellerId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((review) => {
        const product = repositories.products.getById(review.productId);
        const order = repositories.orders.getById(review.orderId);
        return {
          review,
          productId: review.productId,
          productName: product?.name ?? 'Removed product',
          rating: review.rating,
          verified: review.verifiedPurchase,
          hasReply: Boolean(review.sellerReply?.text),
          replyText: review.sellerReply?.text ?? null,
          orderCode: order?.orderCode ?? null,
          listingStatus: !product ? 'missing' : product.status === 'active' ? 'live' : 'hidden',
        } satisfies SellerReviewView;
      });

    return this.filterSellerViews(views, filters);
  }

  private filterSellerViews(views: SellerReviewView[], filters: SellerReviewFilters): SellerReviewView[] {
    const search = filters.search?.trim().toLowerCase();
    return views.filter((view) => {
      if (filters.productId && view.productId !== filters.productId) return false;
      if (filters.rating !== undefined && filters.rating !== 'all' && view.rating !== filters.rating) return false;
      if (filters.reply === 'replied' && !view.hasReply) return false;
      if (filters.reply === 'awaiting' && view.hasReply) return false;
      if (filters.verified === 'verified' && !view.verified) return false;
      if (filters.verified === 'unverified' && view.verified) return false;
      if (search) {
        const haystack = `${view.productName} ${view.review.title} ${view.review.text} ${view.review.userName} ${
          view.orderCode ?? ''
        }`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  async reply(sellerId: string, reviewId: string, text: string): Promise<Review> {
    void sellerId;
    const body = text.trim();
    if (body.length < 5) throw new Error('Write a slightly longer reply (at least 5 characters).');
    if (body.length > MAX_TEXT) throw new Error(`Keep the reply under ${MAX_TEXT} characters.`);
    try {
      const { review } = await vantaApi.replySellerReview(reviewId, body);
      return applyReview(review);
    } catch (error) {
      throw error instanceof ApiError ? new Error(error.message) : error;
    }
  }
}

export const reviewService = new ReviewService();
