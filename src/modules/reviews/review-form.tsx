import * as React from 'react';

import { Pressable, Text, View } from 'react-native';

import { Button, Field } from '@/components/ui';
import { colors, radius, spacing, type } from '@/theme/tokens';

export interface ReviewFormValue {
  rating: number;
  title: string;
  text: string;
}

export type ReviewFormErrors = Partial<Record<keyof ReviewFormValue, string>>;

export const EMPTY_REVIEW_FORM: ReviewFormValue = { rating: 0, title: '', text: '' };

export function validateReviewForm(value: ReviewFormValue): ReviewFormErrors {
  const errors: ReviewFormErrors = {};
  if (value.rating < 1 || value.rating > 5) errors.rating = 'Choose a rating from 1 to 5 stars.';
  if (value.title.trim().length < 3) errors.title = 'Add a short headline (at least 3 characters).';
  if (value.text.trim().length < 10) errors.text = 'Share a little more (at least 10 characters).';
  return errors;
}

export function Stars({ value, size = 14 }: { value: number; size?: number }): React.JSX.Element {
  const rounded = Math.round(value);
  return (
    <Text accessibilityLabel={`${value} out of 5 stars`} style={{ fontSize: size, color: colors.accent }}>
      {'★'.repeat(Math.max(0, Math.min(5, rounded)))}
      {'☆'.repeat(Math.max(0, 5 - Math.max(0, Math.min(5, rounded))))}
    </Text>
  );
}

export function StarRatingInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (rating: number) => void;
}): React.JSX.Element {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={{ ...type.label, color: colors.text, marginBottom: spacing.xs }}>Your rating</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <Pressable
            key={rating}
            onPress={() => onChange(rating)}
            accessibilityRole="button"
            accessibilityState={{ selected: value === rating }}
            accessibilityLabel={`Rate ${rating} star${rating === 1 ? '' : 's'}`}
            style={[
              {
                width: 44,
                height: 44,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: rating <= value ? colors.accent : colors.border,
                backgroundColor: rating <= value ? colors.surface : colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
          >
            <Text style={{ fontSize: 20, color: rating <= value ? colors.accent : colors.textFaint }}>★</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ReviewFormFields({
  value,
  errors,
  onChange,
}: {
  value: ReviewFormValue;
  errors: ReviewFormErrors;
  onChange: (patch: Partial<ReviewFormValue>) => void;
}): React.JSX.Element {
  return (
    <View>
      <StarRatingInput value={value.rating} onChange={(rating) => onChange({ rating })} />
      {errors.rating ? <Text style={{ ...type.caption, color: colors.danger, marginTop: -spacing.sm, marginBottom: spacing.md }}>{errors.rating}</Text> : null}
      <Field
        label="Headline"
        value={value.title}
        onChangeText={(title) => onChange({ title })}
        placeholder="Exactly what you expected"
        error={errors.title}
        autoCapitalize="sentences"
      />
      <Field
        label="Your review"
        value={value.text}
        onChangeText={(text) => onChange({ text })}
        placeholder="What did you like or dislike? How did it hold up?"
        error={errors.text}
        multiline
        minHeight={120}
        autoCapitalize="sentences"
      />
    </View>
  );
}

export function ReviewSubmitButton({
  title,
  loading,
  onPress,
}: {
  title: string;
  loading: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return <Button title={title} onPress={onPress} loading={loading} fullWidth />;
}
