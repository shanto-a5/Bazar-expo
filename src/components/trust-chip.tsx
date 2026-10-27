import * as React from 'react';
import { StyleSheet, View } from 'react-native';

import { Pill } from '@/modules/orders/order-ui';
import { spacing } from '@/theme/tokens';

/**
 * Customer-facing trust chips used on product and store pages.
 *
 * Each chip restates a fact read from the catalogue read model, so a rating,
 * stock level or verified badge is always backed by a record in the local
 * database. They carry no seller-management behaviour.
 */

export function TrustChip({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' }): React.JSX.Element {
  return (
    <View style={styles.chipWrap}>
      <Pill label={label} tone={tone} />
    </View>
  );
}

export function TrustChipRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.chipRow}>{children}</View>;
}

const styles = StyleSheet.create({
  chipWrap: { marginRight: spacing.xs, marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
});
