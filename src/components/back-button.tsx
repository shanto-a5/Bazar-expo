/**
 * The single Vanta back affordance (M10-N1).
 *
 * Every screen that wants a visible back control uses this. It exists so that
 * "back" is implemented once, and so that no screen has to hand-roll the
 * "can go back ? pop : replace somewhere" decision inline — that shape is what
 * produced a screen silently teleporting to Home whenever the stack happened to
 * be shallow.
 *
 * Behaviour, in order:
 *
 *  1. If there is real history, pop it. This is the normal case and the only
 *     case that runs during ordinary use.
 *  2. Otherwise, if the caller supplied a truthful `fallbackHref`, go there.
 *     The caller must name it explicitly: this is for root and deep-link
 *     states where there genuinely is no previous screen, and the destination is
 *     a real, relevant route — never a blanket "go Home".
 *  3. Otherwise render nothing. A back control on a screen with nowhere to go
 *     is worse than no control, so the component removes itself rather than
 *     showing a dead affordance.
 *
 * It deliberately contains no business logic and reads no services; it is a
 * navigation primitive that happens to be styled in the Vanta language.
 */
import { router, type Href } from 'expo-router';
import * as React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, type Variant } from '@/components/ui';
import { goBackOrReplace, hasNavigationHistory } from '@/modules/navigation/back';

export interface BackButtonProps {
  /**
   * Where to go when the stack has no history — a cold deep link, or a screen
   * that is itself a root destination. Must be a real, relevant route for the
   * screen (e.g. the orders list on an order detail), not a generic fallback to
   * Home.
   */
  fallbackHref?: Href;
  /** Visible label. Defaults to `Back`, which is also the accessible name. */
  title?: string;
  /** Visual treatment. `ghost` keeps it reading as a tertiary control. */
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
  /**
   * Override the accessible name only when a screen has a genuinely more
   * specific target worth announcing (e.g. "Back to your orders").
   */
  accessibilityLabel?: string;
}

export function BackButton({
  fallbackHref,
  title = 'Back',
  variant = 'ghost',
  style,
  accessibilityLabel = 'Back',
}: BackButtonProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();

  // Read during render so the control appears/disappears with the stack depth.
  // Whether there is anything to pop is navigator state, which is exactly what
  // decides if a back affordance is meaningful.
  if (!hasNavigationHistory() && !fallbackHref) return null;

  const goBack = (): void => {
    // `goBackOrReplace` re-checks the stack at press time: it can have changed
    // between render and tap (an in-flight redirect, a fast double-tap), and
    // popping a stale route is the "back went somewhere unexpected" bug.
    if (fallbackHref) goBackOrReplace(fallbackHref);
    else router.back();
  };

  return (
    <Button
      title={title}
      variant={variant}
      onPress={goBack}
      accessibilityLabel={accessibilityLabel}
      // Landscape notch clearance: the control is a left-aligned row, so the
      // left inset is the one that can push it under a cutout.
      style={insets.left > 0 ? [{ marginLeft: -insets.left }, style] : style}
    />
  );
}