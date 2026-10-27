/**
 * Remote review bridge (M18).
 *
 * The review screens read the on-device `reviews` collection synchronously
 * (`listForUser`, `listForProduct`, `breakdown`, `forSeller`), so this module
 * mirrors the server's reviews into it. It never recomputes aggregates here:
 * the server owns `ratingAvg`/`ratingCount` on the product, and the product
 * screen's breakdown is derived from the mirrored review rows.
 *
 * The mirror is a cache; the server is the source of truth. `hydrateMyReviews`
 * replaces the caller's rows (a delete made on another device disappears),
 * while product pages only upsert the page they fetched.
 */
import type { Review } from '@/domain/types';
import { getContainer } from '@/infrastructure/container';
import { vantaApi } from './vanta-api';
import { upsertReview, type ReviewDto } from './remote-seller';

const listeners = new Set<() => void>();

/** Re-render hook: the session context subscribes and bumps a revision. */
export function subscribeReviews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyReviews(): void {
  for (const listener of listeners) listener();
}

/** Replace the caller's own reviews, leaving other users' mirrored rows intact. */
export function mirrorMyReviews(userId: string, reviews: ReviewDto[]): void {
  const db = getContainer().db;
  for (const row of db.getCollection<Review>('reviews').filter((review) => review.userId === userId)) {
    db.remove('reviews', row.id);
  }
  for (const dto of reviews) upsertReview(dto);
  notifyReviews();
}

export async function hydrateMyReviews(userId: string): Promise<number> {
  const { reviews } = await vantaApi.myReviews();
  mirrorMyReviews(userId, reviews);
  return reviews.length;
}

/** Upsert a page of public product reviews (keeps other products' rows). */
export function mirrorProductReviews(reviews: ReviewDto[]): void {
  for (const dto of reviews) upsertReview(dto);
  notifyReviews();
}

export async function hydrateProductReviews(productId: string): Promise<number> {
  const { reviews } = await vantaApi.productReviews(productId, { limit: 100 });
  mirrorProductReviews(reviews);
  return reviews.length;
}

const PRODUCT_TTL_MS = 30_000;
const productReads = new Map<string, number>();

/** Refresh a product's public reviews at most once per TTL. */
export function ensureProductReviews(productId: string): void {
  const last = productReads.get(productId);
  if (last && Date.now() - last < PRODUCT_TTL_MS) return;
  productReads.set(productId, Date.now());
  void hydrateProductReviews(productId).catch(() => undefined);
}

const MY_REVIEWS_TTL_MS = 15_000;
const myReviewReads = new Map<string, number>();

/** Refresh the caller's own reviews at most once per TTL. */
export function ensureMyReviews(userId: string): void {
  if (!userId) return;
  const last = myReviewReads.get(userId);
  if (last && Date.now() - last < MY_REVIEWS_TTL_MS) return;
  myReviewReads.set(userId, Date.now());
  void hydrateMyReviews(userId).catch(() => undefined);
}

/** Apply a server review write (create/update/reply) onto the mirror. */
export function applyReview(review: ReviewDto): Review {
  const mapped = upsertReview(review);
  notifyReviews();
  return mapped;
}

/** Drop a review the server confirmed deleted. */
export function applyReviewRemoval(reviewId: string): void {
  getContainer().db.remove('reviews', reviewId);
  notifyReviews();
}
