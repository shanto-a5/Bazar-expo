import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Image,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, type, makeShadow, row } from '@/theme/tokens';
import { useCustomerDockClearance } from '@/components/customer-dock-inset';
import { resolveImage } from '@/utils/image';
import type { Product } from '@/domain/types';

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

const BTN_BG: Record<Variant, string> = {
  primary: colors.primary,
  secondary: colors.primarySoft,
  ghost: 'transparent',
  danger: colors.danger,
  accent: colors.accent,
};
const BTN_FG: Record<Variant, string> = {
  primary: colors.textInverse,
  secondary: colors.primary,
  ghost: colors.primary,
  danger: colors.textInverse,
  accent: colors.textInverse,
};

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  fullWidth,
  accessibilityLabel,
  style,
}: ButtonProps): React.JSX.Element {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      // Visual box is 48px tall (styles.button minHeight); hitSlop widens the
      // touch target a little further so header controls near the screen edge
      // stay easy to hit. Kept at 6px so slop zones never overlap the 12px gap
      // between controls in the same row.
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: BTN_BG[variant] },
        isDisabled && styles.disabledDim,
        pressed && !isDisabled && styles.pressed,
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={BTN_FG[variant]} />
      ) : (
        <Text style={[styles.buttonLabel, { color: BTN_FG[variant] }]}>{title}</Text>
      )}
    </Pressable>
  );
}

interface FieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  error?: string | null;
  hint?: string;
  multiline?: boolean;
  minHeight?: number;
  onSubmitEditing?: () => void;
  returnKeyType?: 'done' | 'go' | 'next' | 'search' | 'send';
  accessibilityLabel?: string;
}

export function Field({
  value,
  onChangeText,
  placeholder,
  label,
  secure,
  keyboardType,
  autoCapitalize,
  error,
  hint,
  multiline,
  minHeight,
  onSubmitEditing,
  returnKeyType,
  accessibilityLabel,
}: FieldProps): React.JSX.Element {
  return (
    <View style={styles.fieldGroup}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        accessibilityLabel={accessibilityLabel ?? label}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        multiline={multiline}
        style={[styles.input, multiline ? { minHeight: minHeight ?? 96, textAlignVertical: 'top', paddingTop: spacing.md } : null, error ? styles.inputError : null]}
        textContentType="none"
        onSubmitEditing={onSubmitEditing}
        returnKeyType={returnKeyType}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {!error && hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
  centered?: boolean;
  backgroundColor?: string;
  /** Optional pull-to-refresh control, forwarded to the scrolling container. */
  refreshControl?: React.ReactElement<RefreshControlProps>;
}

export function Screen({ children, scroll = true, padded = true, centered, backgroundColor, refreshControl }: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  // Real device inset (status bar / notch / cutout) added on top of the existing
  // page padding, so nothing sits under the system area and the design is
  // unchanged where the inset is 0.
  const topInset = { paddingTop: (padded ? spacing.lg : 0) + insets.top };
  // Shells that float a bottom dock (the customer marketplace) publish the
  // space it needs. Null in the auth shell, which leaves its layout exactly as
  // before.
  const dockClearance = useCustomerDockClearance();
  const bottomInset = dockClearance
    ? { paddingBottom: (padded ? spacing.lg : 0) + dockClearance }
    : null;
  if (!scroll) {
    return (
      <View style={[styles.screen, backgroundColor ? { backgroundColor } : null]}>
        <View
          style={[
            styles.screenFill,
            padded && styles.screenPadded,
            centered && styles.screenCentered,
            topInset,
            bottomInset,
          ]}
        >
          {children}
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.screen, backgroundColor ? { backgroundColor } : null]}>
      <ScrollView
        contentContainerStyle={centered ? styles.screenCentered : undefined}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        <View
          style={[
            styles.screenInner,
            padded && styles.screenPadded,
            centered && styles.screenCentered,
            topInset,
            bottomInset,
          ]}
        >
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

interface CardProps {
  children: React.ReactNode;
  padded?: boolean;
  style?: ViewStyle;
}

export function Card({ children, padded = true, style }: CardProps): React.JSX.Element {
  return <View style={[styles.card, padded && styles.cardPadded, style]}>{children}</View>;
}

interface SectionHeaderProps {
  title: string;
  caption?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, caption, actionLabel, onAction }: SectionHeaderProps): React.JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {caption ? <Text style={styles.sectionCaption}>{caption}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenFill: { flex: 1 },
  screenInner: { flexGrow: 1 },
  screenPadded: { padding: spacing.lg },
  screenCentered: { justifyContent: 'center', alignItems: 'center' },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: 48,
  },
  buttonLabel: { fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  disabledDim: { opacity: 0.5 },
  pressed: { opacity: 0.86 },
  fullWidth: { alignSelf: 'stretch' },
  fieldGroup: { marginBottom: spacing.md },
  fieldLabel: { ...type.label, color: colors.text, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 15,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
  fieldHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...makeShadow(1),
  },
  cardPadded: { padding: spacing.lg },
  sectionHeader: { ...row('space-between'), marginBottom: spacing.md, marginTop: spacing.sm },
  sectionHeaderText: { flex: 1 },
  sectionTitle: { ...type.h3, color: colors.text },
  sectionCaption: { ...type.caption, marginTop: 2 },
  sectionAction: { color: colors.primary, fontSize: 13, fontWeight: '700', marginLeft: spacing.md },
  productCardWrap: { flex: 1 },
  productCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 6,
    ...makeShadow(1),
  },
  thumb: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDiscount: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
    badgeText: { color: colors.textInverse, fontSize: 11, fontWeight: '700' },
  imageOverlay: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  productBrand: { ...type.caption },
  productName: { ...type.label, color: colors.text },
  productPriceRow: { ...row('flex-start'), gap: spacing.sm },
  productPrice: { ...type.h3, color: colors.primary },
  productWas: { ...type.caption, textDecorationLine: 'line-through' },
  productRating: { ...type.caption, color: colors.accent },
});

export function taka(value: number): string {
  return `৳${value.toLocaleString('en-IN')}`;
}

export function ProductImage({
  uri,
  size,
  cornerRadius = radius.md,
  emojiScale = 0.42,
}: {
  uri?: string | null;
  size: number;
  cornerRadius?: number;
  emojiScale?: number;
}): React.JSX.Element {
  const resolved = resolveImage(uri);
  const box = { width: size, height: size, borderRadius: cornerRadius };
  if (!resolved) {
    return <View style={[styles.thumb, box, { backgroundColor: colors.surfaceMuted }]} />;
  }
  if (resolved.kind === 'uri') {
    return (
      <ExpoImage
        source={resolved.uri}
        contentFit="cover"
        transition={150}
        style={[styles.thumb, box, { backgroundColor: colors.surfaceMuted }]}
      />
    );
  }
  return (
    <View style={[styles.thumb, box, { backgroundColor: resolved.c1 }]}>
      <Text style={{ fontSize: Math.round(size * emojiScale) }}>{resolved.emoji}</Text>
    </View>
  );
}

export function ProductCard({
  product,
  price,
  onPress,
  badge,
  imageOverlay,
}: {
  product: Product;
  price: number;
  onPress: () => void;
  badge?: string;
  imageOverlay?: React.ReactNode;
}): React.JSX.Element {
  const discounted = !!product.salePrice && product.salePrice < product.regularPrice;
  const off = discounted ? Math.round((1 - product.salePrice! / product.regularPrice) * 100) : 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={product.name}
      style={({ pressed }) => [styles.productCardWrap, pressed && styles.pressed]}
    >
      <View style={styles.productCard}>
        <View>
          <ProductImage uri={product.images?.[0]} size={132} />
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
          {discounted ? (
            <View style={styles.badgeDiscount}>
              <Text style={styles.badgeText}>{off}% OFF</Text>
            </View>
          ) : null}
          {imageOverlay ? <View style={styles.imageOverlay}>{imageOverlay}</View> : null}
        </View>
        <Text style={styles.productBrand} numberOfLines={1}>
          {product.brand}
        </Text>
        <Text style={styles.productName} numberOfLines={2}>
          {product.name}
        </Text>
        <View style={styles.productPriceRow}>
          <Text style={styles.productPrice}>{taka(price)}</Text>
          {discounted ? <Text style={styles.productWas}>{taka(product.regularPrice)}</Text> : null}
        </View>
        {product.ratingCount > 0 ? <Text style={styles.productRating}>★ {product.ratingAvg.toFixed(1)}</Text> : null}
      </View>
    </Pressable>
  );
}

/**
 * The Bazar brand mark, used identically on every screen that shows the logo.
 *
 * `bazar-logo.png` is the supplied `shared/BAZAR.png` artwork resized (never
 * redrawn or recoloured) and is laid out with `resizeMode="contain"`, so the
 * square mark always fits inside the `size` box without cropping or distortion.
 */
export function Logo({ size = 228, style }: { size?: number; style?: ViewStyle }): React.JSX.Element {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Image
        source={require('../../assets/logos/bazar-logo.png')}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="Bazar"
      />
    </View>
  );
}
