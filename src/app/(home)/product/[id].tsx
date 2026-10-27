import * as React from 'react';

import { FlatList, Pressable, Text, View } from 'react-native';

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Logo, ProductImage, Screen, SectionHeader, taka } from '@/components/ui';
import { colors, radius, spacing, type } from '@/theme/tokens';
import {
  catalogService,
  customerVisibility,
  effectivePrice,
  productIsAvailable,
  VISIBILITY_MESSAGES,
} from '@/services/catalog-service';
import { cartService } from '@/services/cart-service';
import { wishlistService } from '@/services/wishlist-service';
import { reviewService } from '@/services/review-service';
import { ensureProductReviews } from '@/api/remote-reviews';
import { ProductRail } from '@/modules/discovery/discovery-filters';
import { TrustChip, TrustChipRow } from '@/components/trust-chip';
import { Stars } from '@/modules/reviews/review-form';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { formatDate } from '@/utils/time';
import { useSession } from '@/modules/session/session-context';

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}): React.JSX.Element {
  const canDecrease = value > min;
  const canIncrease = value < max;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Pressable
        onPress={() => canDecrease && onChange(value - 1)}
        disabled={!canDecrease}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        style={[styles.stepper, !canDecrease && styles.stepperOff]}
      >
        <Text style={styles.stepperText}>−</Text>
      </Pressable>
      <Text style={{ ...type.h3, minWidth: 28, textAlign: 'center' }}>{value}</Text>
      <Pressable
        onPress={() => canIncrease && onChange(value + 1)}
        disabled={!canIncrease}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        style={[styles.stepper, !canIncrease && styles.stepperOff]}
      >
        <Text style={styles.stepperText}>+</Text>
      </Pressable>
    </View>
  );
}

function Chip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      accessibilityLabel={`${label}${disabled ? ' (out of stock)' : ''}`}
    >
      <View style={[styles.chip, active && styles.chipActive, disabled && styles.chipOff]}>
        <Text
          style={{
            ...type.label,
            color: active ? colors.textInverse : colors.text,
            textDecorationLine: disabled && !active ? 'line-through' : 'none',
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function TrustRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 3 }}
    >
      <Text style={{ ...type.caption }}>{label}</Text>
      <Text style={{ ...type.label, color: colors.text, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

export default function ProductDetailScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ id?: string | string[]; reviews?: string | string[] }>();
  const { user, cartOwnerId } = useSession();
  const productId = Array.isArray(params.id) ? params.id[0] : params.id;
  const showAllReviews = (Array.isArray(params.reviews) ? params.reviews[0] : params.reviews) === '1';

  const [, setTick] = React.useState(0);
  const [quantity, setQuantity] = React.useState(1);
  const [picked, setPicked] = React.useState<{ id: string; sel: Record<string, string> } | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);
  const [savingWishlist, setSavingWishlist] = React.useState(false);
  const [wishlistError, setWishlistError] = React.useState<string | null>(null);

  const product = productId ? catalogService.getProduct(productId) : undefined;

  useFocusEffect(
    React.useCallback(() => {
      if (productId) catalogService.recordView(productId, user?.id);
      if (productId) ensureProductReviews(productId);
      setQuantity(1);
      setAdding(false);
      setSavingWishlist(false);
    }, [productId, user?.id]),
  );

  const attributeKeys = React.useMemo(() => {
    const keys: string[] = [];
    for (const variant of product?.variants ?? []) {
      for (const key of Object.keys(variant.attributes)) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    return keys;
  }, [product]);

  const selection = React.useMemo<Record<string, string>>(() => {
    if (!product?.hasVariants || product.variants.length === 0) return {};
    if (picked && picked.id === product.id) return picked.sel;
    const first = product.variants.find((v) => v.stock > 0) ?? product.variants[0];
    return first ? first.attributes : {};
  }, [product, picked]);

  const chooseAttribute = React.useCallback(
    (key: string, value: string) => {
      if (!product) return;
      setQuantity(1);
      setPicked((prev) => {
        const base = prev && prev.id === product.id ? prev.sel : selection;
        const next = { ...base, [key]: value };
        const viable = product.variants.filter((variant) =>
          attributeKeys.every((k) => !next[k] || variant.attributes[k] === next[k]),
        );
        if (viable.length) return { id: product.id, sel: next };
        const fallback =
          product.variants.find((v) => v.attributes[key] === value && v.stock > 0) ??
          product.variants.find((v) => v.attributes[key] === value);
        return fallback ? { id: product.id, sel: { ...fallback.attributes } } : { id: product.id, sel: next };
      });
    },
    [product, attributeKeys, selection],
  );

  const selectedVariant = React.useMemo(() => {
    if (!product?.hasVariants) return undefined;
    const matches = product.variants.filter((variant) =>
      attributeKeys.every((k) => !selection[k] || variant.attributes[k] === selection[k]),
    );
    return matches.find((v) => v.stock > 0) ?? matches[0];
  }, [product, selection, attributeKeys]);

  const store = React.useMemo(
    () => (product ? catalogService.getStore(product.sellerId) : undefined),
    [product],
  );
  const trust = React.useMemo(
    () => (product ? catalogService.productTrust(product.id) : null),
    [product],
  );
  const breakdown = React.useMemo(
    () => (product ? reviewService.breakdown(product.id) : undefined),
    [product],
  );
  const reviews = React.useMemo(
    () => (product ? reviewService.listForProduct(product.id, showAllReviews ? undefined : 3) : []),
    [product, showAllReviews],
  );
  const myReviewableItem = React.useMemo(() => {
    if (!user || !product) return undefined;
    return reviewService
      .reviewableForUser(user.id)
      .find((entry) => entry.productId === product.id)?.item;
  }, [user, product]);
  const related = React.useMemo(
    () => (product ? catalogService.related(product, 6) : []),
    [product],
  );
  const moreFromStore = React.useMemo(
    () =>
      product
        ? catalogService.query({
            sellerId: product.sellerId,
            customerVisibleOnly: true,
            inStockOnly: true,
            excludeIds: [product.id],
            sort: 'popularity',
            limit: 6,
          })
        : [],
    [product],
  );
  const saved = user && product ? wishlistService.contains(user.id, product.id) : false;

  if (!product) {
    return (
      <Screen padded>
        <Text style={{ ...type.h1, color: colors.text, marginBottom: spacing.md }}>Product unavailable</Text>
        <Text style={{ ...type.body, color: colors.textMuted, marginBottom: spacing.lg }}>
          This item is no longer listed in the catalogue.
        </Text>
        {/* Real history is popped when it exists; `/browse` is the catalogue a
            shopper would go to looking for a product, so it is the truthful
            destination when this screen was opened cold. */}
        <BackButton fallbackHref="/browse" />
      </Screen>
    );
  }

  const visibility = customerVisibility(product);
  if (!visibility.visible) {
    return (
      <Screen padded>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md }}>
          <Logo size={64} />
          <Text style={{ ...type.h2, color: colors.text, textAlign: 'center' }}>Not available right now</Text>
          <Text style={{ ...type.h3, color: colors.textMuted, textAlign: 'center' }}>
            {visibility.blocker ? VISIBILITY_MESSAGES[visibility.blocker] : 'This item cannot be ordered.'}
          </Text>
          <BackButton fallbackHref="/browse" />
        </View>
      </Screen>
    );
  }

  const valueAvailable = (key: string, value: string): boolean => {
    if (!product.hasVariants) return true;
    return product.variants.some(
      (variant) =>
        variant.stock > 0 &&
        variant.attributes[key] === value &&
        attributeKeys.every((k) => k === key || !selection[k] || variant.attributes[k] === selection[k]),
    );
  };

  const available = productIsAvailable(product);
  const stock = selectedVariant ? selectedVariant.stock : product.stock;
  const unitPrice = selectedVariant ? selectedVariant.price : effectivePrice(product);
  const compareAt = selectedVariant
    ? selectedVariant.compareAtPrice
    : product.salePrice && product.salePrice < product.regularPrice
      ? product.regularPrice
      : undefined;
  const maxQuantity = Math.max(1, stock);
  const lowStock = available && stock > 0 && stock <= product.lowStockThreshold;

  // Derived from the live cart (not a one-shot flag), so the button stays honest
  // across navigation: a mutation that finishes after this screen unmounts still
  // shows as "View cart" when the user comes back.
  const selectedVariantId = selectedVariant?.id;
  const inCart = cartService
    .items(cartOwnerId)
    .some(
      (item) =>
        item.productId === product.id && (item.variantId ?? undefined) === (selectedVariantId ?? undefined),
    );

  const addToCart = async (): Promise<void> => {
    if (!available || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await cartService.addItemAsync(cartOwnerId, product.id, Math.min(quantity, maxQuantity), selectedVariant?.id);
    } catch (error) {
      // The server refused (or the network dropped) — leave the button as
      // "Add to cart" so the user can retry, and say what happened.
      setAddError(error instanceof Error ? error.message : 'We could not add that to your cart.');
    } finally {
      setAdding(false);
    }
  };

  const toggleWishlist = async (): Promise<void> => {
    if (!user) {
      // Carry a valid `next` so the pushed login treats this as a real guarded
      // flow and pops back to this product page after sign-in. Without it the
      // login screen redirects to Home, dropping the visitor exactly where they
      // stood (M11: wishlist intent must not abandon the screen).
      router.push({ pathname: '/login', params: { next: '/wishlist' } });
      return;
    }
    if (savingWishlist) return;
    setSavingWishlist(true);
    setWishlistError(null);
    try {
      await wishlistService.setSaved(user.id, product.id, !saved);
      setTick((t) => t + 1);
    } catch (error) {
      setWishlistError(error instanceof Error ? error.message : 'Unable to update your wishlist.');
    } finally {
      setSavingWishlist(false);
    }
  };

  return (
    <Screen padded>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
        <BackButton fallbackHref="/browse" />
        <View style={{ flex: 1 }} />
        <Button
          title={saved ? 'Saved' : 'Save'}
          variant={saved ? 'secondary' : 'ghost'}
          loading={savingWishlist}
          onPress={toggleWishlist}
        />
        <Button title="Cart" variant="secondary" onPress={() => router.push('/cart')} />
      </View>

      {wishlistError ? (
        <Text style={{ ...type.caption, color: colors.danger, marginBottom: spacing.sm }}>{wishlistError}</Text>
      ) : null}

      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={product.images?.length ? product.images : [null]}
        keyExtractor={(uri, index) => `${index}-${uri ?? 'none'}`}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}
        renderItem={({ item }) => <ProductImage uri={item} size={220} cornerRadius={radius.lg} />}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
        <Text style={{ ...type.label, color: colors.textMuted, flex: 1 }}>{product.brand}</Text>
        {product.ratingCount > 0 ? (
          <Text style={{ ...type.label, color: colors.accent }}>
            ★ {product.ratingAvg.toFixed(1)} ({product.ratingCount})
          </Text>
        ) : null}
      </View>
      <Text style={{ ...type.h1, color: colors.text, marginBottom: spacing.sm }}>{product.name}</Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
        <Text style={{ ...type.display, color: colors.primary }}>{taka(unitPrice)}</Text>
        {compareAt ? <Text style={{ ...type.body, color: colors.textMuted, textDecorationLine: 'line-through' }}>{taka(compareAt)}</Text> : null}
      </View>

      {available ? (
        lowStock ? (
          <Text style={{ ...type.label, color: colors.danger, marginBottom: spacing.md }}>Only {stock} left in stock</Text>
        ) : (
          <Text style={{ ...type.label, color: colors.success, marginBottom: spacing.md }}>In stock</Text>
        )
      ) : (
        <Text style={{ ...type.label, color: colors.danger, marginBottom: spacing.md }}>Out of stock</Text>
      )}

      {store ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Pressable
            onPress={() => router.push({ pathname: '/store/[id]', params: { id: store.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Open store ${store.name}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}
          >
            <ProductImage uri={store.logo} size={44} cornerRadius={radius.md} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.h3, color: colors.text }}>{store.name}</Text>
              <Text style={{ ...type.caption }}>
                {store.location} · {store.deliveryEstimateDays.min}–{store.deliveryEstimateDays.max} days
                {store.verified ? ' · Verified' : ''}
              </Text>
            </View>
            <Text style={{ ...type.caption, color: colors.primary }}>View store</Text>
          </Pressable>
        </Card>
      ) : null}

      {trust ? (
        <View style={{ marginBottom: spacing.lg }}>
          <SectionHeader title="Why shop here" caption="Facts taken from this store's real records" />
          <TrustChipRow>
            {trust.store?.verified ? <TrustChip label="Verified seller" tone="success" /> : null}
            {trust.ratingCount > 0 ? (
              <TrustChip label={`${trust.ratingAvg.toFixed(1)}★ · ${trust.ratingCount} review(s)`} />
            ) : (
              <TrustChip label="No reviews yet" />
            )}
            {trust.verifiedReviewCount > 0 ? (
              <TrustChip label={`${trust.verifiedReviewCount} verified purchase(s)`} tone="success" />
            ) : null}
            {trust.unitsSold > 0 ? <TrustChip label={`${trust.unitsSold} sold from this store`} /> : null}
            {trust.store && trust.store.followerCount > 0 ? (
              <TrustChip label={`${trust.store.followerCount} follower(s)`} />
            ) : null}
            {trust.isNewArrival ? <TrustChip label="New arrival" tone="success" /> : null}
            {trust.discounted ? <TrustChip label="Discounted" tone="warning" /> : null}
          </TrustChipRow>
          <Card>
            <TrustRow
              label="Return policy"
              value={trust.returnEligible ? '7 days after delivery' : 'Not available for this item'}
            />
            {trust.store ? (
              <>
                <TrustRow
                  label="Response"
                  value={`${trust.store.responseRate}% · replies in about ${trust.store.responseTimeMinutes} min`}
                />
                <TrustRow
                  label="Delivery"
                  value={`${taka(trust.store.shippingFee)} fee, free above ${taka(
                    trust.store.freeShippingThreshold,
                  )} · ${trust.store.deliveryEstimate.min}–${trust.store.deliveryEstimate.max} days`}
                />
                <TrustRow
                  label="Selling since"
                  value={new Date(trust.store.joinedAt).toLocaleDateString('en-GB', {
                    month: 'short',
                    year: 'numeric',
                  })}
                />
              </>
            ) : null}
            <Text style={{ ...type.caption, marginTop: spacing.sm }}>{trust.returnReason}</Text>
          </Card>
        </View>
      ) : null}

      {product.hasVariants && product.variants.length ? (
        <View style={{ marginBottom: spacing.lg, gap: spacing.md }}>
          {attributeKeys.map((key) => (
            <View key={key}>
              <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.sm }}>
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {[...new Set(product.variants.map((v) => v.attributes[key]).filter(Boolean))].map((value) => (
                  <Chip
                    key={value}
                    label={value}
                    active={selection[key] === value}
                    disabled={!valueAvailable(key, value)}
                    onPress={() => chooseAttribute(key, value)}
                  />
                ))}
              </View>
            </View>
          ))}
          {selectedVariant ? (
            <Text style={{ ...type.caption }}>
              SKU {selectedVariant.sku} · {selectedVariant.stock} available
            </Text>
          ) : null}
        </View>
      ) : null}

      {available ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginBottom: spacing.lg }}>
          <Text style={{ ...type.label, color: colors.text }}>Quantity</Text>
          <Stepper
            value={quantity}
            min={1}
            max={maxQuantity}
            onChange={setQuantity}
          />
        </View>
      ) : null}

      {addError ? (
        <View style={{ marginTop: spacing.md }}>
          <NoticeCard
            tone="danger"
            title="Could not add to cart"
            message={addError}
            onDismiss={() => setAddError(null)}
          />
        </View>
      ) : null}

      <View style={{ height: spacing.lg }} />

      <Button
        title={inCart ? 'View cart' : available ? 'Add to cart' : 'Out of stock'}
        fullWidth
        loading={adding}
        onPress={inCart ? () => router.push('/cart') : addToCart}
        disabled={!available}
      />

      {product.highlights?.length ? (
        <View style={{ marginTop: spacing.xl }}>
          <SectionHeader title="Highlights" />
          {product.highlights.map((highlight) => (
            <View key={highlight} style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs }}>
              <Text style={{ color: colors.primary }}>•</Text>
              <Text style={{ ...type.body, color: colors.text, flex: 1 }}>{highlight}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ marginTop: spacing.xl }}>
        <SectionHeader title="Description" />
        <Text style={{ ...type.body, color: colors.textMuted }}>{product.description}</Text>
      </View>

      {breakdown && breakdown.total > 0 ? (
        <View style={{ marginTop: spacing.xl }}>
          <SectionHeader
            title={showAllReviews ? 'All reviews' : 'Reviews'}
            caption={`${breakdown.average.toFixed(1)} average from ${breakdown.total} reviews · ${breakdown.verifiedCount} verified`}
            actionLabel={showAllReviews ? 'Show fewer' : breakdown.total > 3 ? 'See all' : undefined}
            onAction={() =>
              router.setParams(
                showAllReviews
                  ? { reviews: undefined }
                  : { reviews: '1' },
              )
            }
          />
          {!showAllReviews
            ? breakdown.distribution.map((bucket) => (
              <View key={bucket.rating} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 }}>
                <Text style={{ ...type.caption, width: 28 }}>{bucket.rating}★</Text>
                <View style={{ flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted }}>
                  <View
                    style={{
                      width: `${breakdown.total ? (bucket.count / breakdown.total) * 100 : 0}%`,
                      height: 6,
                      borderRadius: radius.pill,
                      backgroundColor: colors.accent,
                    }}
                  />
                </View>
                <Text style={{ ...type.caption, width: 24, textAlign: 'right' }}>{bucket.count}</Text>
              </View>
            ))
            : null}
          {reviews.map((review) => (
            <Card key={review.id} style={{ marginTop: spacing.md }}>
              <View style={styles.reviewHeader}>
                <Text style={{ ...type.label, color: colors.text, flex: 1 }}>{review.userName}</Text>
                <Stars value={review.rating} />
              </View>
              <Text style={{ ...type.label, color: colors.text, marginTop: 2 }}>{review.title}</Text>
              <Text style={{ ...type.caption, marginTop: 4 }}>{review.text}</Text>
              <View style={styles.reviewMeta}>
                <Text style={{ ...type.caption }}>
                  {`${formatDate(review.createdAt)}${review.verifiedPurchase ? ' · Verified purchase' : ''}`}
                </Text>
                {review.helpfulCount > 0 ? <Text style={{ ...type.caption }}>{`${review.helpfulCount} found this helpful`}</Text> : null}
              </View>
              {review.sellerReply?.text ? (
                <View style={styles.reviewReply}>
                  <Text style={{ ...type.label, color: colors.primaryDark }}>{`${review.sellerReply.text}`}</Text>
                  <Text style={{ ...type.caption }}>{`Seller replied ${formatDate(review.sellerReply.at)}`}</Text>
                </View>
              ) : null}
            </Card>
          ))}
        </View>
      ) : (
        <View style={{ marginTop: spacing.xl }}>
          <SectionHeader title="Reviews" caption="No reviews for this product yet" />
        </View>
      )}

      {user ? (
        myReviewableItem ? (
          <View style={{ marginTop: spacing.lg }}>
            <Button
              title="Write a review"
              onPress={() =>
                router.push({ pathname: '/write-review', params: { orderItemId: myReviewableItem.id } })
              }
              fullWidth
            />
          </View>
        ) : null
      ) : (
        <View style={{ marginTop: spacing.lg }}>
          <Button
            title="Sign in to review"
            variant="secondary"
            // Same guard as `toggleWishlist`: a valid `next` makes the pushed
            // login pop back to this product page instead of redirecting Home.
            onPress={() => router.push({ pathname: '/login', params: { next: '/wishlist' } })}
            fullWidth
          />
        </View>
      )}

      {moreFromStore.length > 0 && store ? (
        <View style={{ marginTop: spacing.lg }}>
          <ProductRail
            title={`More from ${store.name}`}
            caption="Other picks from this store"
            products={moreFromStore}
            onOpen={(id) => router.push({ pathname: '/product/[id]', params: { id } })}
            actionLabel="Visit store"
            onAction={() => router.push({ pathname: '/store/[id]', params: { id: store.id } })}
          />
        </View>
      ) : null}

      {related.length ? (
        <View style={{ marginTop: spacing.lg }}>
          <ProductRail
            title="You may also like"
            caption="More from this category"
            products={related}
            onOpen={(id) => router.push({ pathname: '/product/[id]', params: { id } })}
          />
        </View>
      ) : null}

      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}

const styles = {
  stepper: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surface,
  },
  stepperOff: { opacity: 0.4 },
  stepperText: { ...type.h2, color: colors.primary },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipOff: { opacity: 0.45, backgroundColor: colors.surfaceMuted },
  reviewHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  reviewMeta: { marginTop: spacing.sm, gap: 2 },
  reviewReply: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    gap: 2,
  },
};
