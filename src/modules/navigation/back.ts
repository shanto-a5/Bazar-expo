/**
 * The one implementation of "go back" (M10-N1).
 *
 * `BackButton` is the visual affordance; this is the behaviour it is built on.
 * It is exported for call sites that cannot render a button — `EmptyState`
 * actions, keyboard handlers, step-machine callbacks — so that the
 * `canGoBack() ? back() : replace(...)` decision is never re-derived inline.
 *
 * The contract:
 *  - real history → pop it, always;
 *  - no history    → `replace` to a route the caller names explicitly.
 *
 * There is deliberately no "and if there is no fallback, go Home" branch. A
 * caller with nowhere truthful to send the user should not call this at all.
 */
import { router, type Href } from 'expo-router';

/**
 * Pop the current screen, or replace with `fallback` when the stack has nothing
 * to pop (a cold deep link, or a screen opened as a root entry).
 *
 * @param fallback A real, relevant destination for this screen when it has no
 * history. Never pass a blanket Home redirect — a screen that genuinely has no
 * previous screen is a root or deep-link state and should be handled as one.
 */
export function goBackOrReplace(fallback: Href): void {
  // Re-checked here rather than trusting a render-time snapshot: the stack may
  // have changed between render and press.
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback);
}

/**
 * Whether there is real navigation history to pop.
 *
 * Safe to call during render. Screens use it to decide whether to offer a back
 * affordance at all, so a root screen does not show a control that cannot do
 * anything.
 */
export function hasNavigationHistory(): boolean {
  return router.canGoBack();
}
