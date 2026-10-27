import * as React from 'react';

import { Pressable, RefreshControl, Text, View } from 'react-native';

import { router, useFocusEffect } from 'expo-router';

import { Button, Card, Field, ProductImage, Screen, taka } from '@/components/ui';
import { useQuickAccount } from '@/modules/session/quick-account-modal';
import { colors, radius, spacing, type } from '@/theme/tokens';
import { cartService } from '@/services/cart-service';
import { voucherService, type VoucherQuote } from '@/services/voucher-service';
import type { CartLineView, SellerGroupView } from '@/services/pricing-service';
import { useListingCache } from '@/modules/cache/use-listing-cache';
import { NoticeCard } from '@/modules/checkout/checkout-ui';
import { useSession } from '@/modules/session/session-context';

function IntegrityBanner({ userId, onRepaired }: { userId: string; onRepaired: () => void }): React.JSX.Element | null {
  const [result, setResult] = React.useState<string | null>(null);
  const integrity = cartService.audit(userId);
  if (integrity.clean && !result) return null;

  const runRepair = (): void => {
    const outcome = cartService.repair(userId);
    setResult(
      outcome.removed || outcome.reduced
        ? `Fixed ${outcome.removed} removed, ${outcome.reduced} reduced.`
        : 'Nothing could be fixed automatically.',
    );
    onRepaired();
  };

  return (
    <Card style={{ marginBottom: spacing.lg, borderColor: integrity.blocking.length ? colors.danger : colors.accent }}>
      <Text style={{ ...type.h3, color: colors.text }}>
        {integrity.blocking.length
          ? `${integrity.blocking.length} item(s) block checkout`
          : `${integrity.advisory.length} item(s) changed since you added them`}
      </Text>
      {integrity.issues.slice(0, 4).map((issue) => (
        <Text key={issue.itemId} style={{ ...type.caption, marginTop: spacing.xs }}>
          {issue.message}
        </Text>
      ))}
      {integrity.issues.length > 4 ? (
        <Text style={{ ...type.caption, marginTop: spacing.xs }}>
          {`${integrity.issues.length - 4} more item(s) need attention.`}
        </Text>
      ) : null}
      {result ? <Text style={{ ...type.caption, color: colors.success, marginTop: spacing.xs }}>{result}</Text> : null}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <Button
          title="Fix my cart"
          onPress={runRepair}
          accessibilityLabel="Remove or reduce the items that changed"
        />
        <Button title="Review cart" variant="secondary" onPress={onRepaired} />
      </View>
    </Card>
  );
}

function Checkbox({
  checked,
  onPress,
  label,
}: {
  checked: boolean;
  onPress: () => void;
  label: string;
}): React.JSX.Element {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label} hitSlop={8}>
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
        {checked ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

function QtyControl({
  line,
  onChange,
}: {
  line: CartLineView;
  onChange: (next: number) => void;
}): React.JSX.Element {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Pressable
        onPress={() => onChange(line.quantity - 1)}
        disabled={line.quantity <= 1}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        style={[styles.qtyButton, line.quantity <= 1 && styles.qtyOff]}
      >
        <Text style={styles.qtyGlyph}>−</Text>
      </Pressable>
      <Text style={{ ...type.h3, minWidth: 24, textAlign: 'center' }}>{line.quantity}</Text>
      <Pressable
        onPress={() => onChange(line.quantity + 1)}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        style={styles.qtyButton}
      >
        <Text style={styles.qtyGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

function LineRow({
  line,
  userId,
  onChanged,
  onOpen,
}: {
  line: CartLineView;
  userId: string;
  onChanged: () => void;
  onOpen: () => void;
}): React.JSX.Element {
  const attributes = line.variant?.attributes
    ? Object.entries(line.variant.attributes)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' · ')
    : line.cart.variantAttributes
      ? Object.entries(line.cart.variantAttributes)
          .map(([key, value]) => `${key}: ${value}`)
          .join(' · ')
      : null;

  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md }}>
      <Checkbox
        checked={line.selected}
        onPress={() => {
          cartService.setSelected(userId, line.id, !line.selected);
          onChanged();
        }}
        label={`Select ${line.product.name}`}
      />
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={line.product.name}>
        <ProductImage uri={line.product.images?.[0]} size={72} cornerRadius={radius.md} />
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ ...type.label, color: colors.text }} numberOfLines={2} onPress={onOpen}>
          {line.product.name}
        </Text>
        {attributes ? <Text style={{ ...type.caption }}>{attributes}</Text> : null}
        {!line.available ? <Text style={{ ...type.caption, color: colors.danger }}>Currently unavailable</Text> : null}
        <Text style={{ ...type.label, color: colors.primary }}>{taka(line.unitPrice)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 2 }}>
          <QtyControl
            line={line}
            onChange={(next) => {
              cartService.updateQuantity(userId, line.id, next);
              onChanged();
            }}
          />
          <Pressable
            onPress={() => {
              cartService.removeItem(userId, line.id);
              onChanged();
            }}
            accessibilityRole="button"
            hitSlop={6}
          >
            <Text style={{ ...type.caption, color: colors.danger }}>Remove</Text>
          </Pressable>
        </View>
      </View>
      <Text style={{ ...type.label, color: colors.text }}>{taka(line.subtotal)}</Text>
    </View>
  );
}

function GroupCard({
  group,
  userId,
  onChanged,
  onOpen,
}: {
  group: SellerGroupView;
  userId: string;
  onChanged: () => void;
  onOpen: (productId: string) => void;
}): React.JSX.Element {
  const allSelected = group.items.every((item) => item.selected);
  return (
    <Card padded={false} style={{ marginBottom: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          padding: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Checkbox
          checked={allSelected}
          onPress={() => {
            cartService.setSellerSelected(userId, group.sellerId, !allSelected);
            onChanged();
          }}
          label={`Select all from ${group.store.name}`}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.h3, color: colors.text }}>{group.store.name}</Text>
          <Text style={{ ...type.caption }}>
            {group.store.location} · {group.freeShipping ? 'Free shipping' : `Shipping ${taka(group.shippingFee)}`}
          </Text>
        </View>
      </View>

      {group.items.map((line, index) => (
        <View key={line.id}>
          {index > 0 ? (
            <View style={{ height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md }} />
          ) : null}
          <LineRow
            line={line}
            userId={userId}
            onChanged={onChanged}
            onOpen={() => onOpen(line.product.id)}
          />
        </View>
      ))}

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: spacing.md,
          padding: spacing.md,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Text style={{ ...type.caption }}>Seller subtotal</Text>
        <Text style={{ ...type.h3, color: colors.text }}>{taka(group.subtotal)}</Text>
      </View>
    </Card>
  );
}

export default function CartScreen(): React.JSX.Element {
  const { cartOwnerId, status } = useSession();
  const { present: presentQuickAccount } = useQuickAccount();
  const [, setTick] = React.useState(0);
  const [code, setCode] = React.useState('');
  const [applied, setApplied] = React.useState<string | undefined>(undefined);
  const [voucherError, setVoucherError] = React.useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      setTick((t) => t + 1);
    }, []),
  );

  const refresh = React.useCallback(() => setTick((t) => t + 1), []);
  const { refreshing, refresh: refreshFromServer, error: cartError, retry: retryCart } = useListingCache(cartOwnerId, 'cart');

  const remote = true;
  const totalsWithApplied = cartService.totals(cartOwnerId, applied);

  // Remote mode: the server owns voucher eligibility, so offers are fetched
  // rather than evaluated from the (empty) device voucher repository. The cart
  // signature refetches whenever the priced cart changes.
  const [remoteOffers, setRemoteOffers] = React.useState<VoucherQuote[] | null>(null);
  const [offersError, setOffersError] = React.useState<string | null>(null);
  const cartSignature = React.useMemo(
    () =>
      totalsWithApplied.groups
        .flatMap((group) => group.items)
        .map((line) => `${line.id}:${line.quantity}:${line.selected ? 1 : 0}:${line.unitPrice}`)
        .sort()
        .join('|'),
    [totalsWithApplied.groups],
  );

  const localOffers = React.useMemo(
    () => (remote ? [] : voucherService.eligibleForCart(cartOwnerId, totalsWithApplied.groups, totalsWithApplied.subtotal)),
    [remote, cartOwnerId, totalsWithApplied],
  );
  const offers = remote ? remoteOffers ?? [] : localOffers;
  const bestValid = offers.filter((offer) => offer.valid);
  const blocked = offers.filter((offer) => !offer.valid);

  // A voucher that was valid when applied can silently stop being valid as the
  // cart changes (min-spend, free-shipping removal, an item restored to full
  // price), so the applied code only counts for pricing and checkout once it
  // still quotes as valid. Derived during render, never a removed-discount lie:
  // the totals below are priced without it and the notice explains what happened.
  const appliedLower = applied?.toLowerCase();
  const appliedIsLive = Boolean(
    appliedLower && offers.some((offer) => offer.valid && offer.voucher.code.toLowerCase() === appliedLower),
  );
  const appliedEffective = appliedIsLive ? applied : undefined;
  const reconcileMessage =
    applied && !appliedIsLive ? 'That voucher is no longer valid for this cart, so it was removed.' : null;

  React.useEffect(() => {
    if (!remote) return;
    let live = true;
    voucherService
      .eligibleForCartRemote()
      .then((quotes) => {
        if (!live) return;
        setRemoteOffers(quotes);
        setOffersError(null);
      })
      .catch(() => {
        if (!live) return;
        setRemoteOffers([]);
        setOffersError('We could not load the vouchers for this cart.');
      });
    return () => {
      live = false;
    };
  }, [remote, cartOwnerId, cartSignature]);

  // Ask the server to price the cart with the applied code (or none): the
  // server owns the resulting discount, so no local voucher arithmetic runs.
  React.useEffect(() => {
    if (!remote) return;
    cartService.setVoucher(cartOwnerId, appliedEffective);
  }, [remote, cartOwnerId, appliedEffective]);

  const totals = cartService.totals(cartOwnerId, appliedEffective);

  const allSelected = totals.groups.flatMap((g) => g.items).every((item) => item.selected);
  const hasItems = totals.groups.length > 0;
  const hasSelected = totals.itemCount > 0;

  const applyCode = (value: string): void => {
    const candidate = value.trim();
    if (!candidate) {
      setApplied(undefined);
      setVoucherError(null);
      return;
    }
    const match = offers.find((offer) => offer.voucher.code.toLowerCase() === candidate.toLowerCase());
    if (!match) {
      setVoucherError('We could not find that voucher code.');
      return;
    }
    if (!match.valid) {
      setVoucherError(match.reason ?? 'This voucher cannot be applied.');
      return;
    }
    setApplied(match.voucher.code);
    setVoucherError(null);
  };

  // Signed-in customers go straight to checkout. Everyone else gets the order
  // popup first: it creates the account in place, then continues to checkout with
  // the cart (and any applied voucher) still mounted underneath, so nothing is
  // rebuilt from scratch on the way.
  const goToCheckout = (): void => {
    const push = (): void =>
      router.push(appliedEffective ? { pathname: '/checkout', params: { voucher: appliedEffective } } : '/checkout');
    if (status === 'signedIn') {
      push();
      return;
    }
    presentQuickAccount({ onAuthenticated: push });
  };

  return (
    <Screen
      padded
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refreshFromServer} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg }}>
        <Button title="Continue shopping" variant="ghost" onPress={() => router.push('/browse')} />
        <View style={{ flex: 1 }} />
        {hasItems ? (
          <Button
            title="Clear cart"
            variant="ghost"
            onPress={() => {
              cartService.clear(cartOwnerId);
              setApplied(undefined);
              setVoucherError(null);
              refresh();
            }}
          />
        ) : null}
      </View>

      <Text style={{ ...type.h1, color: colors.text, marginBottom: spacing.xs }}>Your cart</Text>
      <Text style={{ ...type.caption, marginBottom: spacing.lg }}>
        {hasItems ? `${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'} selected` : 'Nothing here yet'}
      </Text>

      {cartError ? (
        <View style={{ marginBottom: spacing.lg }}>
          <NoticeCard
            tone="warning"
            title="Couldn't refresh"
            message={cartError}
            actionLabel="Try again"
            onAction={retryCart}
          />
        </View>
      ) : null}

      {!hasItems ? (
        <View style={{ alignItems: 'center', marginTop: spacing.xxl, gap: spacing.lg }}>
          <Text style={{ fontSize: 48 }}>🛒</Text>
          <Text style={{ ...type.h3, color: colors.textMuted, textAlign: 'center' }}>
            Your cart is empty. Browse the catalogue to add something you like.
          </Text>
          <Button title="Start browsing" onPress={() => router.push('/browse')} />
        </View>
      ) : (
        <>
          <IntegrityBanner userId={cartOwnerId} onRepaired={refresh} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md }}>
            <Checkbox
              checked={allSelected}
              onPress={() => {
                cartService.selectAll(cartOwnerId, !allSelected);
                refresh();
              }}
              label="Select all items"
            />
            <Text style={{ ...type.label, color: colors.text, flex: 1 }}>Select all</Text>
            {totals.itemCount > 0 ? (
              <Pressable
                onPress={() => {
                  cartService.clearSelected(cartOwnerId);
                  refresh();
                }}
                accessibilityRole="button"
                hitSlop={6}
              >
                <Text style={{ ...type.caption, color: colors.danger }}>Remove selected</Text>
              </Pressable>
            ) : null}
          </View>

          {totals.groups.map((group) => (
            <GroupCard
              key={group.sellerId}
              group={group}
              userId={cartOwnerId}
              onChanged={refresh}
              onOpen={(productId) => router.push({ pathname: '/product/[id]', params: { id: productId } })}
            />
          ))}

          <Card style={{ marginBottom: spacing.lg }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
              <Text style={{ ...type.h3, color: colors.text, flex: 1 }}>Voucher</Text>
              <Button title="All vouchers" variant="ghost" onPress={() => router.push('/vouchers')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  value={code}
                  onChangeText={setCode}
                  placeholder="Enter code"
                  autoCapitalize="characters"
                  onSubmitEditing={() => applyCode(code)}
                  returnKeyType="done"
                  error={reconcileMessage ?? voucherError ?? (remote ? offersError : null)}
                />
              </View>
              <Button
                title={appliedEffective ? 'Remove' : 'Apply'}
                variant={appliedEffective ? 'ghost' : 'primary'}
                onPress={() => (applied ? (setApplied(undefined), setVoucherError(null)) : applyCode(code))}
              />
            </View>
            {appliedEffective ? (
              <Text style={{ ...type.caption, color: colors.success, marginTop: spacing.xs }}>
                {appliedEffective} applied
              </Text>
            ) : bestValid.length ? (
              <View style={{ marginTop: spacing.sm, gap: 4 }}>
                {bestValid.slice(0, 6).map((offer) => (
                  <Pressable
                    key={offer.voucher.id}
                    onPress={() => {
                      setCode(offer.voucher.code);
                      setApplied(offer.voucher.code);
                      setVoucherError(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Apply voucher ${offer.voucher.code}`}
                    hitSlop={8}
                  >
                    <Text style={{ ...type.caption, color: colors.primary }}>
                      {offer.voucher.code} — {offer.voucher.title} ({taka(offer.discount)} off)
                    </Text>
                  </Pressable>
                ))}
                {bestValid.length > 6 ? (
                  <Text style={{ ...type.caption }}>{`${bestValid.length - 6} more available in vouchers`}</Text>
                ) : null}
              </View>
            ) : null}
            {blocked.length ? (
              <Text style={{ ...type.caption, marginTop: spacing.sm }}>
                {`${blocked.length} voucher${blocked.length === 1 ? '' : 's'} not applicable yet`}
              </Text>
            ) : null}
          </Card>

          <Card style={{ marginBottom: spacing.lg }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <Text style={{ ...type.body, color: colors.textMuted }}>Subtotal</Text>
              <Text style={{ ...type.body, color: colors.text }}>{taka(totals.subtotal)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
              <Text style={{ ...type.body, color: colors.textMuted }}>Shipping</Text>
              <Text style={{ ...type.body, color: colors.text }}>
                {totals.shippingTotal === 0 ? 'Free' : taka(totals.shippingTotal)}
              </Text>
            </View>
            {totals.voucherDiscount > 0 ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                <Text style={{ ...type.body, color: colors.textMuted }}>Voucher discount</Text>
                <Text style={{ ...type.body, color: colors.success }}>−{taka(totals.voucherDiscount)}</Text>
              </View>
            ) : null}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                borderTopWidth: 1,
                borderTopColor: colors.border,
                paddingTop: spacing.md,
              }}
            >
              <Text style={{ ...type.h2, color: colors.text }}>Total</Text>
              <Text style={{ ...type.h2, color: colors.primary }}>{taka(totals.grandTotal)}</Text>
            </View>
          </Card>

          <Button
            title="Proceed to checkout"
            fullWidth
            disabled={!hasSelected}
            onPress={goToCheckout}
          />
          <Text style={{ ...type.caption, marginTop: spacing.sm, textAlign: 'center' }}>
            We&apos;ll set up your account with your phone number at checkout. Your cart is saved on this device.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = {
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.textInverse, fontSize: 13, fontWeight: '700' as const },
  qtyButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.surface,
  },
  qtyOff: { opacity: 0.4 },
  qtyGlyph: { ...type.h3, color: colors.primary },
};
