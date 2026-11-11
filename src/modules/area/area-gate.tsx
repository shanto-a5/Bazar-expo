/**
 * Blocks the app behind the area selector until the shopper has an area.
 *
 * - No saved area: ONLY the selector renders. Nothing else mounts, so there is
 *   no way around it.
 * - Re-choosing from the Home header: the selector overlays the running app so
 *   navigation state survives.
 * The check reads local storage only; it never waits for the network.
 */
import * as React from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useArea } from '@/modules/area/area-context';
import { AreaSelector } from '@/modules/area/area-selector';
import { colors } from '@/theme/tokens';

export function AreaGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { status, area, changing } = useArea();

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Starting Vanta" />
      </View>
    );
  }

  if (!area) return <AreaSelector canClose={false} />;

  return (
    <View style={{ flex: 1 }}>
      {children}
      {changing ? <AreaSelector canClose /> : null}
    </View>
  );
}
