import * as React from 'react';

import { Text, View } from 'react-native';

import { router } from 'expo-router';

import { Button, Card, Logo, Screen, SectionHeader, taka } from '@/components/ui';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { useSession } from '@/modules/session/session-context';
import { cartService } from '@/services/cart-service';
import { storeService } from '@/services/store-service';
import { voucherService, type VoucherQuote } from '@/services/voucher-service';
import { formatDate } from '@/utils/time';
import { colors, radius, spacing, type } from '@/theme/tokens';

function offerValue(quote: VoucherQuote): string {
  const { voucher } = quote;
  if (voucher.type === 'percentage') {
    return `${voucher.discountValue}% off${voucher.maximumDiscount ? ` (up to ${taka(voucher.maximumDiscount)})` : ''}`;
  }
  if (voucher.type === 'fixed') return `${taka(voucher.discountValue)} off`;
  return 'Free delivery';
}

function offerScope(quote: VoucherQuote): string {
  const { voucher } = quote;
  if (voucher.scope === 'seller' && voucher.sellerId) {
    return storeService.storeBySellerId(voucher.sellerId)?.name ?? 'Selected store';
  }
  if (voucher.categoryId) return 'Selected category';
  if (voucher.productIds?.length) return 'Selected products';
  return 'Whole order';
}

export default function VouchersScreen(): React.JSX.Element {
  const { cartOwnerId } = useSession();
  useFocusRefresh();

  const remote = true;
  const totals = cartService.totals(cartOwnerId);

  // Remote mode: the server quotes the vouchers against the customer's cart, so
  // the screen lists those quotes directly (each carries its own valid/reason).
  const [remoteOffers, setRemoteOffers] = React.useState<VoucherQuote[] | null>(null);
  React.useEffect(() => {
    if (!remote) return;
    let live = true;
    voucherService
      .eligibleForCartRemote()
      .then((quotes) => {
        if (live) setRemoteOffers(quotes);
      })
      .catch(() => {
        if (live) setRemoteOffers([]);
      });
    return () => {
      live = false;
    };
  }, [remote, cartOwnerId, totals.subtotal]);

  const localQuotes = remote ? [] : voucherService.eligibleForCart(cartOwnerId, totals.groups, totals.subtotal);
  const localOffers = remote
    ? []
    : voucherService
        .listActive()
        .map((voucher) => localQuotes.find((quote) => quote.voucher.code === voucher.code))
        .filter((quote): quote is VoucherQuote => !!quote);
  const offers = remote ? remoteOffers ?? [] : localOffers;

  const usable = offers.filter((quote) => quote.valid);
  const blocked = offers.filter((quote) => !quote.valid);
  const hasItems = totals.groups.length > 0;

  return (
    <Screen padded>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg }}>
        <Logo size={40} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.h3, color: colors.text }}>Vouchers</Text>
          <Text style={{ ...type.caption }}>Codes you can use on this cart</Text>
        </View>
        <Button title="Cart" variant="secondary" onPress={() => router.push('/cart')} />
      </View>

      {offers.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: spacing.xxl, gap: spacing.lg }}>
          <Text style={{ fontSize: 48 }}>🎟️</Text>
          <Text style={{ ...type.h3, color: colors.textMuted, textAlign: 'center' }}>
            No active vouchers right now. Codes you receive from sellers show up here.
          </Text>
          <Button title="Browse products" onPress={() => router.push('/browse')} />
        </View>
      ) : (
        <>
          <SectionHeader
            title="Ready to use"
            caption={hasItems ? 'Applicable to the items in your cart' : 'Add items to your cart to use these'}
          />
          {usable.length === 0 ? (
            <Text style={{ ...type.h3, color: colors.textMuted, marginBottom: spacing.lg }}>
              None of the current vouchers match your cart yet.
            </Text>
          ) : (
            usable.map((quote) => (
              <Card key={quote.voucher.id} style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                  <View style={styles.codeBox}>
                    <Text style={{ ...type.h3, color: colors.primary }}>{quote.voucher.code}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.label, color: colors.text }}>{quote.voucher.title}</Text>
                    <Text style={{ ...type.caption, marginTop: 2 }}>{offerValue(quote)}</Text>
                    <Text style={{ ...type.caption, marginTop: 2 }}>
                      {`${offerScope(quote)} · ends ${formatDate(quote.voucher.expiry)}`}
                    </Text>
                  </View>
                </View>
                {quote.voucher.description ? (
                  <Text style={{ ...type.caption, marginTop: spacing.md }}>{quote.voucher.description}</Text>
                ) : null}
                <Text style={{ ...type.label, color: colors.success, marginTop: spacing.sm }}>
                  {`Saves ${taka(quote.discount)} on this cart`}
                </Text>
                <Button
                  title="Apply in cart"
                  variant="secondary"
                  fullWidth
                  style={{ marginTop: spacing.md }}
                  onPress={() => router.push('/cart')}
                />
              </Card>
            ))
          )}

          {blocked.length ? (
            <View style={{ marginTop: spacing.lg }}>
              <SectionHeader title="Not usable yet" caption={`${blocked.length} voucher${blocked.length === 1 ? '' : 's'}`} />
              {blocked.map((quote) => (
                <Card key={quote.voucher.id} style={{ marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <View style={styles.codeBox}>
                      <Text style={{ ...type.h3, color: colors.textMuted }}>{quote.voucher.code}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.label, color: colors.text }}>{quote.voucher.title}</Text>
                      <Text style={{ ...type.caption, marginTop: 2 }}>{offerValue(quote)}</Text>
                      <Text style={{ ...type.caption, color: colors.danger, marginTop: 2 }}>
                        {quote.reason ?? 'Not applicable to this cart'}
                      </Text>
                    </View>
                  </View>
                </Card>
              ))}
            </View>
          ) : null}
        </>
      )}

      <View style={{ height: spacing.xxl }} />
    </Screen>
  );
}

const styles = {
  codeBox: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
};
