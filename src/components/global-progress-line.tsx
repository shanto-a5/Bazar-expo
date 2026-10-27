/**
 * Global background-request progress line.
 *
 * A single thin bar pinned under the status bar that appears only while the
 * cache has server reads in flight. It is deliberately quiet:
 *
 *  - it waits ~180ms before appearing, so quick cached refreshes never flicker;
 *  - it creeps toward completion and snaps to full when the last request
 *    settles, then fades out (a determinate-looking line, no fake percentage);
 *  - it is non-interactive (`pointerEvents="none"`) so it never blocks a touch.
 */
import * as React from 'react';
import { Animated, StyleSheet } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listingCache } from '@/services/listing-cache';
import { colors } from '@/theme/tokens';

const SHOW_DELAY_MS = 180;
const OFFSET_TOP = 2;

export function GlobalProgressLine(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [progress] = React.useState(() => new Animated.Value(0));
  const [opacity] = React.useState(() => new Animated.Value(0));
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = React.useRef(false);

  React.useEffect(() => {
    const clearTimer = (): void => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const show = (): void => {
      clearTimer();
      timer.current = setTimeout(() => {
        timer.current = null;
        visible.current = true;
        progress.setValue(0);
        Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
        Animated.timing(progress, { toValue: 0.85, duration: 900, useNativeDriver: false }).start();
      }, SHOW_DELAY_MS);
    };

    const hide = (): void => {
      clearTimer();
      if (!visible.current) return;
      visible.current = false;
      Animated.timing(progress, { toValue: 1, duration: 180, useNativeDriver: false }).start(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
          progress.setValue(0);
        });
      });
    };

    const sync = (): void => {
      if (listingCache.getProgressPending() > 0) show();
      else hide();
    };

    sync();
    const unsubscribe = listingCache.subscribeProgress(sync);
    return () => {
      unsubscribe();
      clearTimer();
    };
  }, [progress, opacity]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { top: insets.top + OFFSET_TOP, opacity }]}
    >
      <Animated.View style={[styles.bar, { width }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    zIndex: 999,
  },
  bar: {
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
});
