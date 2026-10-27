import * as React from 'react';

import { Pressable, Text, View } from 'react-native';

import { router } from 'expo-router';

import { useSession } from '@/modules/session/session-context';
import { useFocusRefresh } from '@/modules/orders/focus-refresh';
import { wishlistService } from '@/services/wishlist-service';
import { colors, radius, type } from '@/theme/tokens';

export type WishlistToggleOutcome = 'added' | 'removed' | null;

export interface WishlistToggle {
  saved: boolean;
  error: string | null;
  toggle: () => WishlistToggleOutcome;
}

export function useWishlistToggle(productId: string, ownerId: string | null): WishlistToggle {
  const { status } = useSession();
  const [, setVersion] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  // Hearts live on many screens at once; refreshing on focus keeps the whole
  // set consistent when a save/unsave happened somewhere else meanwhile.
  useFocusRefresh();

  const saved = ownerId ? wishlistService.contains(ownerId, productId) : false;

  const toggle = React.useCallback((): WishlistToggleOutcome => {
    if (status === 'checking') return null;
    if (status !== 'signedIn' || !ownerId) {
      router.push({ pathname: '/login', params: { next: '/wishlist' } });
      return null;
    }
    try {
      const next = wishlistService.toggle(ownerId, productId);
      setError(null);
      setVersion((value) => value + 1);
      return next ? 'added' : 'removed';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update your wishlist.');
      return null;
    }
  }, [ownerId, productId, status]);

  return { saved, error, toggle };
}

export function WishlistButton({
  productId,
  label,
  size = 18,
  onChange,
}: {
  productId: string;
  label: string;
  size?: number;
  onChange?: () => void;
}): React.JSX.Element {
  const { user } = useSession();
  const { saved, error, toggle } = useWishlistToggle(productId, user?.id ?? null);
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Pressable
        onPress={() => {
          if (toggle()) onChange?.();
        }}
        accessibilityRole="button"
        accessibilityLabel={`${saved ? 'Remove' : 'Save'} ${label} ${saved ? 'from' : 'to'} wishlist`}
        hitSlop={8}
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          width: size + 16,
          height: size + 16,
          borderRadius: radius.pill,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ fontSize: size, color: saved ? colors.primary : colors.textMuted }}>{saved ? '♥' : '♡'}</Text>
      </Pressable>
      {error ? (
        <Text numberOfLines={2} style={{ ...type.caption, color: colors.danger, marginTop: 2 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
