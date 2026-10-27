import * as React from 'react';

import { FlatList, Text, View } from 'react-native';

import { router } from 'expo-router';

import { BackButton } from '@/components/back-button';
import { Button, ProductCard, Screen } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { SignInGate } from '@/modules/session/route-guard';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { EmptyState } from '@/modules/orders/order-ui';
import { WishlistButton } from '@/modules/wishlist/wishlist-button';
import { effectivePrice } from '@/services/catalog-service';
import { wishlistService, type WishlistEntry } from '@/services/wishlist-service';
import { colors, spacing, type } from '@/theme/tokens';

export default function WishlistScreen(): React.JSX.Element {
  const { user } = useSession();
  useFocusRefresh();
  const [, setVersion] = React.useState(0);
  const userId = user?.id ?? null;

  const entries: WishlistEntry[] = userId ? wishlistService.list(userId) : [];

  if (!user) {
    return <SignInGate title="Wishlist" message="Sign in to save products and come back to them later." fallback="/settings" />;
  }

  const unavailable = entries.filter((entry) => !entry.available).length;

  return (
    <Screen padded scroll={false}>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.product.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
        style={{ flex: 1 }}
        ListHeaderComponent={
          <View>
            <BackButton fallbackHref="/settings" />
            <Text style={{ ...type.h1, color: colors.text, marginTop: spacing.md }}>Wishlist</Text>
            <Text style={{ ...type.caption, marginBottom: spacing.lg }}>
              {entries.length === 0
                ? 'Items you save appear here.'
                : `${entries.length} saved item${entries.length === 1 ? '' : 's'}${unavailable > 0 ? ` · ${unavailable} currently unavailable` : ''}`}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View>
            <ProductCard
              product={item.product}
              price={effectivePrice(item.product)}
              onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.product.id } })}
            />
            <View style={styles.cardFooter}>
              <Text style={styles.cardCaption}>{item.available ? 'In stock' : 'Currently unavailable'}</Text>
              <WishlistButton
                productId={item.product.id}
                label={item.product.name}
                onChange={() => setVersion((value) => value + 1)}
              />
            </View>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            title="Nothing saved yet"
            message="Tap the heart on any product to keep it here for later."
            actionLabel="Browse products"
            onAction={() => router.push('/browse')}
          />
        }
        ListFooterComponent={
          entries.length > 0 ? (
            <View style={{ marginTop: spacing.lg }}>
              <Button
                title="Clear wishlist"
                variant="secondary"
                onPress={() => {
                  if (!userId) return;
                  wishlistService.clear(userId);
                  setVersion((value) => value + 1);
                }}
                fullWidth
              />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = {
  cardFooter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginTop: spacing.xs,
  },
  cardCaption: { ...type.caption },
};
