import * as React from 'react';

import { Text, View } from 'react-native';

import { useLocalSearchParams } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { goBackOrReplace } from '@/modules/navigation/back';
import { Card, Screen, SectionHeader } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { SignInGate } from '@/modules/session/route-guard';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { EmptyState } from '@/modules/orders/order-ui';
import {
  EMPTY_REVIEW_FORM,
  ReviewFormFields,
  ReviewSubmitButton,
  validateReviewForm,
  type ReviewFormErrors,
  type ReviewFormValue,
} from '@/modules/reviews/review-form';
import { catalogService, effectivePrice, productIsAvailable } from '@/services/catalog-service';
import { reviewService } from '@/services/review-service';
import { colors, spacing, type } from '@/theme/tokens';

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default function WriteReviewScreen(): React.JSX.Element {
  const { user } = useSession();
  useFocusRefresh();
  const params = useLocalSearchParams<{ orderItemId?: string | string[]; reviewId?: string | string[] }>();
  const orderItemId = first(params.orderItemId);
  const reviewId = first(params.reviewId);
  const userId = user?.id ?? '';
  const editing = reviewId ? reviewService.listForUser(userId).find((entry) => entry.id === reviewId) : undefined;
  const eligibility = orderItemId ? reviewService.eligibility(userId, orderItemId) : undefined;

  const [value, setValue] = React.useState<ReviewFormValue>(() =>
    editing ? { rating: editing.rating, title: editing.title, text: editing.text } : EMPTY_REVIEW_FORM,
  );
  const [errors, setErrors] = React.useState<ReviewFormErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const productId = editing?.productId ?? eligibility?.productId ?? '';
  const product = productId ? catalogService.getProduct(productId) : undefined;
  const store = product ? catalogService.getStore(product.sellerId) : undefined;

  const submit = async (): Promise<void> => {
    setFormError(null);
    const found = validateReviewForm(value);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setSaving(true);
    try {
      if (editing) {
        await reviewService.update(userId, editing.id, {
          rating: value.rating,
          title: value.title,
          text: value.text,
        });
      } else if (eligibility?.can && eligibility.orderId && eligibility.sellerOrderId && eligibility.sellerId && eligibility.productId) {
        await reviewService.create(userId, {
          orderItemId,
          orderId: eligibility.orderId,
          sellerOrderId: eligibility.sellerOrderId,
          productId: eligibility.productId,
          sellerId: eligibility.sellerId,
          rating: value.rating,
          title: value.title,
          text: value.text,
          images: [],
        });
      } else {
        setFormError('This item cannot be reviewed right now.');
        setSaving(false);
        return;
      }
      goBackOrReplace('/my-reviews');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save this review.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return <SignInGate title="Write a review" message="Sign in to rate the items you received." fallback="/my-reviews" />;
  }

  if (!editing && (!eligibility || !eligibility.can)) {
    return (
      <Screen padded>
        <EmptyState
          title="Review unavailable"
          message="Only delivered items from your own orders can be reviewed."
          actionLabel="Back to my reviews"
          onAction={() => goBackOrReplace('/my-reviews')}
        />
      </Screen>
    );
  }

  return (
    <Screen padded>
      <Text style={{ ...type.h1, color: colors.text, marginBottom: spacing.xs }}>
        {editing ? 'Edit your review' : 'Write a review'}
      </Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>
        Only customers who received this item can review it.
      </Text>

      {product ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <SectionHeader title={product.name} caption={store ? `Sold by ${store.name}` : undefined} />
          <Text style={{ ...type.body, color: colors.textMuted }}>
            {productIsAvailable(product) ? 'Currently in stock' : 'Currently unavailable'}
          </Text>
        </Card>
      ) : null}

      {formError ? (
        <Text style={{ ...type.body, color: colors.danger, marginBottom: spacing.md }}>{formError}</Text>
      ) : null}

      <ReviewFormFields value={value} errors={errors} onChange={(patch) => setValue((current) => ({ ...current, ...patch }))} />
      <ReviewSubmitButton title={editing ? 'Save changes' : 'Publish review'} loading={saving} onPress={submit} />
      <View style={{ height: spacing.md }} />
      <BackButton title="Cancel" fallbackHref="/my-reviews" />
      {product ? (
        <Text style={{ ...type.caption, textAlign: 'center', marginTop: spacing.md }}>
          {`Bought for ${effectivePrice(product)} · reviews update the product rating right away`}
        </Text>
      ) : null}
    </Screen>
  );
}
