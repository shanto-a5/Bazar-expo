import * as React from 'react';

import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, Card, Screen, SectionHeader } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { SignInGate } from '@/modules/session/route-guard';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { EmptyState, Pill } from '@/modules/orders/order-ui';
import { Stars } from '@/modules/reviews/review-form';
import { catalogService } from '@/services/catalog-service';
import { reviewService } from '@/services/review-service';
import { ensureMyReviews } from '@/api/remote-reviews';
import { colors, spacing, type } from '@/theme/tokens';
import { formatDate } from '@/utils/time';

export default function MyReviewsScreen(): React.JSX.Element {
  const { user } = useSession();
  useFocusRefresh();
  const [, setVersion] = React.useState(0);
  const [notice, setNotice] = React.useState<{ text: string; kind: 'success' | 'error' } | null>(null);

  const userId = user?.id ?? '';
  React.useEffect(() => {
    if (userId) ensureMyReviews(userId);
  }, [userId]);
  const reviews = userId ? reviewService.listForUser(userId) : [];
  const pending = userId ? reviewService.reviewableForUser(userId) : [];

  if (!user) {
    return <SignInGate title="My reviews" message="Sign in to review the items you received and manage your ratings." fallback="/account" />;
  }

  const remove = async (id: string, name: string): Promise<void> => {
    try {
      await reviewService.remove(userId, id);
      setNotice({ text: `Review for ${name} deleted.`, kind: 'success' });
      setVersion((value) => value + 1);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Unable to delete this review.', kind: 'error' });
    }
  };

  return (
    <Screen padded>
      <BackButton fallbackHref="/account" />

      <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md }}>My reviews</Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>
        Ratings you shared for delivered items, and anything still waiting for one.
      </Text>

      {notice ? (
        <Text style={{ ...type.body, color: notice.kind === 'error' ? colors.danger : colors.success, marginBottom: spacing.md }}>
          {notice.text}
        </Text>
      ) : null}

      <SectionHeader
        title="Waiting for your review"
        caption={pending.length ? `${pending.length} delivered item(s)` : 'Nothing is waiting right now'}
      />
      {pending.map((entry) => {
        const product = entry.productId ? catalogService.getProduct(entry.productId) : undefined;
        if (!product) return null;
        return (
          <Card key={entry.item!.id} style={{ marginBottom: spacing.md }}>
            <Text style={{ ...type.h3, color: colors.text }}>{product.name}</Text>
            <Text style={{ ...type.caption }}>{entry.item!.productName}</Text>
            <View style={{ height: spacing.md }} />
            <Button
              title="Write a review"
              onPress={() => router.push({ pathname: '/write-review', params: { orderItemId: entry.item!.id } })}
              fullWidth
            />
          </Card>
        );
      })}

      <View style={{ height: spacing.lg }} />
      <SectionHeader
        title="Reviews you wrote"
        caption={reviews.length ? `${reviews.length} review(s)` : 'You have not written any reviews yet'}
      />

      {reviews.length === 0 ? (
        <EmptyState
          title="No reviews yet"
          message="After an order is delivered you can rate the item and help other shoppers."
          actionLabel="Browse products"
          onAction={() => router.push('/browse')}
        />
      ) : null}

      {reviews.map((review) => {
        const product = catalogService.getProduct(review.productId);
        return (
          <Card key={review.id} style={{ marginBottom: spacing.md }}>
            <View style={styles.header}>
              <Text style={{ ...type.h3, color: colors.text, flex: 1 }} numberOfLines={1}>
                {product?.name ?? review.productId}
              </Text>
              {review.verifiedPurchase ? <Pill label="Verified" tone="success" /> : null}
            </View>
            <Stars value={review.rating} />
            <Text style={{ ...type.label, color: colors.text, marginTop: spacing.xs }}>{review.title}</Text>
            <Text style={{ ...type.body, color: colors.textMuted, marginTop: 2 }}>{review.text}</Text>
            <Text style={{ ...type.caption, marginTop: spacing.sm }}>{formatDate(review.createdAt)}</Text>
            {review.sellerReply?.text ? (
              <View style={styles.reply}>
                <Text style={{ ...type.label, color: colors.primary }}>{`${review.sellerReply.text}`}</Text>
                <Text style={{ ...type.caption }}>Seller replied {formatDate(review.sellerReply.at)}</Text>
              </View>
            ) : null}
            <View style={{ height: spacing.md }} />
            <View style={styles.actions}>
              <Button
                title="Edit"
                variant="secondary"
                onPress={() => router.push({ pathname: '/write-review', params: { reviewId: review.id } })}
                accessibilityLabel={`Edit review for ${product?.name ?? 'product'}`}
              />
              <Button
                title="Delete"
                variant="danger"
                onPress={() => {
                  void remove(review.id, product?.name ?? 'this item');
                }}
                accessibilityLabel={`Delete review for ${product?.name ?? 'product'}`}
              />
              {product ? (
                <Button
                  title="View product"
                  variant="ghost"
                  onPress={() => router.push({ pathname: '/product/[id]', params: { id: product.id } })}
                />
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = {
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  reply: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    gap: 2,
  },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
};
