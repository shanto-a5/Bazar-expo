import * as React from 'react';

import { FlatList, Pressable, Text, View } from 'react-native';

import { router } from 'expo-router';

import { Button, Card, Logo, ProductImage, Screen, SectionHeader } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { catalogService } from '@/services/catalog-service';
import { storeService } from '@/services/store-service';
import type { Store } from '@/domain/types/catalog';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function StoresScreen(): React.JSX.Element {
  const { user } = useSession();
  useFocusRefresh();

  const [version, setVersion] = React.useState(0);
  const [tab, setTab] = React.useState<'all' | 'following' | 'new'>('all');

  const followed = user ? storeService.followedStores(user.id) : [];
  const following = followed.map((s) => s.id);
  const openStores = catalogService.visibleStores();
  let stores = openStores;
  if (tab === 'following') stores = followed.filter((s) => openStores.some((v) => v.id === s.id));
  // Filtered like the other tabs: the header promises only stores accepting orders,
  // so "newest" must not surface closed or paused ones.
  if (tab === 'new') stores = storeService.newestStores(50).filter((s) => openStores.some((v) => v.id === s.id));

  const toggleFollow = (store: Store): void => {
    if (!user) {
      router.push('/login?next=/stores');
      return;
    }
    if (following.includes(store.id)) {
      storeService.unfollowStore(user.id, store.id);
    } else {
      storeService.followStore(user.id, store.id);
    }
    setVersion((value) => value + 1);
  };

  const header = (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing.lg }}>
        <Logo size={40} />
        <Text style={{ ...type.h3, color: colors.textMuted, flex: 1 }}>Vanta stores</Text>
        <Button title="Browse" variant="secondary" onPress={() => router.push('/browse')} />
      </View>

      <SectionHeader
        title="Marketplace sellers"
        caption="Only stores accepting orders right now are listed"
      />

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
        {([
          { key: 'all' as const, label: 'Top rated' },
          { key: 'new' as const, label: 'Newest' },
          { key: 'following' as const, label: 'Following' },
        ]).map((option) => (
          <Pressable
            key={option.key}
            onPress={() => setTab(option.key)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
          >
            <Card
              padded={false}
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: 14,
                borderRadius: radius.pill,
                borderColor: tab === option.key ? colors.primary : colors.border,
              }}
            >
              <Text style={{ ...type.label, color: tab === option.key ? colors.primary : colors.textMuted }}>
                {option.label}
              </Text>
            </Card>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <Screen padded scroll={false}>
      <FlatList
        data={stores}
        keyExtractor={(s) => s.id}
        extraData={version}
        contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xxl }}
        style={{ flex: 1 }}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <Card>
            <Pressable
              onPress={() => router.push({ pathname: '/store/[id]', params: { id: item.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Open store ${item.name}`}
            >
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <ProductImage uri={item.logo} size={64} cornerRadius={radius.md} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                    <Text style={{ ...type.h3, color: colors.text, flexShrink: 1 }}>{item.name}</Text>
                    {item.verified ? <Text style={{ ...type.caption, color: colors.primary }}>Verified</Text> : null}
                  </View>
                  <Text style={{ ...type.caption, marginTop: 2 }}>{item.location}</Text>
                  <Text style={{ ...type.caption, color: colors.accent, marginTop: 2 }}>
                    {`★ ${item.ratingAvg.toFixed(1)} (${item.ratingCount}) · ${item.productCount} products`}
                  </Text>
                  <Text style={{ ...type.caption, marginTop: 2 }}>
                    {`${item.followerCount} follower${item.followerCount === 1 ? '' : 's'} · delivers in ${item.deliveryEstimateDays.min}–${item.deliveryEstimateDays.max} days`}
                  </Text>
                </View>
              </View>
            </Pressable>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                title="Visit store"
                variant="secondary"
                onPress={() => router.push({ pathname: '/store/[id]', params: { id: item.id } })}
                style={{ flex: 1 }}
              />
              <Button
                title={following.includes(item.id) ? 'Following' : 'Follow'}
                variant={following.includes(item.id) ? 'ghost' : 'primary'}
                onPress={() => toggleFollow(item)}
                style={{ flex: 1 }}
                accessibilityLabel={`${following.includes(item.id) ? 'Unfollow' : 'Follow'} ${item.name}`}
              />
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <Text style={{ ...type.h3, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl }}>
            {tab === 'following'
              ? user
                ? 'You are not following any stores yet. Follow a store to keep an eye on new arrivals.'
                : 'Sign in to follow stores and track their arrivals.'
              : 'No stores match this view yet.'}
          </Text>
        }
      />
    </Screen>
  );
}
