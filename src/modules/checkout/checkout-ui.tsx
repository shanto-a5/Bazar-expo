import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Address } from '@/domain/types';
import { Button, Card, taka } from '@/components/ui';
import type { SellerGroupView } from '@/services/pricing-service';
import { colors, radius, spacing, type } from '@/theme/tokens';

export const CHECKOUT_STEPS = ['Address', 'Delivery', 'Payment', 'Review'] as const;

export function Radio({
  selected,
  label,
  onPress,
  caption,
  trailing,
  accessibilityLabel,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
  caption?: string;
  trailing?: string;
  accessibilityLabel?: string;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.option, selected && styles.optionOn, pressed && styles.pressed]}
    >
      <View style={[styles.radio, selected && styles.radioOn]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[type.h3, { color: colors.text }]}>{label}</Text>
        {caption ? <Text style={{ ...type.caption, marginTop: 2 }}>{caption}</Text> : null}
      </View>
      {trailing ? <Text style={[type.label, { color: selected ? colors.primary : colors.textMuted }]}>{trailing}</Text> : null}
    </Pressable>
  );
}

export function NavRow({
  label,
  value,
  onPress,
  missing,
}: {
  label: string;
  value: string;
  onPress: () => void;
  missing?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.option, pressed && styles.pressed]}
    >
      <View style={{ flex: 1 }}>
        <Text style={type.label}>{label}</Text>
        <Text style={[type.body, { color: missing ? colors.danger : colors.text, marginTop: 2 }]} numberOfLines={2}>
          {value}
        </Text>
      </View>
      <Text style={[type.caption, { color: colors.primary, fontWeight: '700' }]}>Change</Text>
    </Pressable>
  );
}

export function SummaryRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'muted' | 'discount' | 'total' | 'primary';
}): React.JSX.Element {
  const color =
    tone === 'discount' ? colors.success : tone === 'total' || tone === 'primary' ? colors.primary : colors.textMuted;
  return (
    <View style={styles.summaryRow}>
      <Text style={[tone === 'total' ? type.h2 : type.body, { color: tone === 'muted' ? colors.textMuted : colors.textMuted }]}>
        {label}
      </Text>
      <Text
        style={[
          tone === 'total' ? type.h2 : type.body,
          { color: tone === 'muted' ? colors.text : color, fontWeight: tone === 'total' || tone === 'primary' ? '700' : '500' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export function ItemsCard({ groups }: { groups: SellerGroupView[] }): React.JSX.Element {
  return (
    <Card style={{ marginBottom: spacing.lg }}>
      {groups.map((group, groupIndex) => (
        <View key={group.sellerId} style={{ marginTop: groupIndex === 0 ? 0 : spacing.md, paddingTop: groupIndex === 0 ? 0 : spacing.md, borderTopWidth: groupIndex === 0 ? 0 : 1, borderTopColor: colors.border }}>
          <Text style={[type.label, { color: colors.text, marginBottom: spacing.sm }]}>{group.store.name}</Text>
          {group.items
            .filter((line) => line.selected)
            .map((line) => (
              <View key={line.id} style={styles.itemRow}>
                <Text style={[type.body, { color: colors.text, flex: 1 }]} numberOfLines={2}>
                  {line.product.name} × {line.quantity}
                </Text>
                <Text style={type.body}>{taka(line.subtotal)}</Text>
              </View>
            ))}
        </View>
      ))}
    </Card>
  );
}

export function AddressBlock({ address, compact = false }: { address: Address; compact?: boolean }): React.JSX.Element {
  return (
    <View style={{ gap: 2 }}>
      <Text style={type.label}>
        {address.label} · {address.recipientName}
      </Text>
      <Text style={type.caption}>{address.phone}</Text>
      <Text style={type.body}>
        {address.addressLine}, {address.area}, {address.district}, {address.division} {address.postalCode}
      </Text>
      {!compact && address.instructions ? (
        <Text style={[type.caption, { marginTop: spacing.xs }]}>Note: {address.instructions}</Text>
      ) : null}
    </View>
  );
}

export function NoticeCard({
  tone,
  title,
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  tone: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}): React.JSX.Element {
  const palette = {
    info: { background: colors.primarySoft, text: colors.primaryDark },
    warning: { background: colors.surfaceMuted, text: colors.text },
    danger: { background: colors.dangerSoft, text: colors.danger },
    success: { background: colors.successSoft, text: colors.success },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette.background }]}>
      <Text style={[type.h3, { color: palette.text }]}>{title}</Text>
      {message ? <Text style={[type.body, { color: palette.text, marginTop: spacing.xs }]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.md }}>
          <Button title={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
      {onDismiss ? (
        <Pressable onPress={onDismiss} accessibilityRole="button" hitSlop={8} style={{ marginTop: spacing.sm }}>
          <Text style={[type.caption, { color: palette.text, fontWeight: '700' }]}>Dismiss</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pressed: { opacity: 0.85 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.primary },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  notice: { borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
});
