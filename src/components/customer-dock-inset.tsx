/**
 * Bottom clearance contract for the customer bottom dock.
 *
 * The dock is a floating overlay owned by the `/(home)` marketplace shell. The
 * shell publishes the required clearance through context and the shared `Screen`
 * reads it, rather than every screen under a dock being patched individually.
 * The auth shell has no dock, so the context is absent there and `Screen`
 * behaves exactly as before.
 */
import * as React from 'react';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Height of the floating dock surface, excluding the safe-area gap. */
export const CUSTOMER_DOCK_HEIGHT = 60;

/** Small visual gap so the dock floats above the home indicator / page edge. */
export const CUSTOMER_DOCK_BOTTOM_GAP = 10;

const CustomerDockClearanceContext = React.createContext<number | null>(null);

export function CustomerDockClearanceProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const clearance = CUSTOMER_DOCK_HEIGHT + CUSTOMER_DOCK_BOTTOM_GAP + insets.bottom;

  return (
    <CustomerDockClearanceContext.Provider value={clearance}>
      {children}
    </CustomerDockClearanceContext.Provider>
  );
}

/**
 * Bottom space the floating dock occupies, or `null` when the current shell has
 * no dock (auth), so callers can leave their layout untouched.
 */
export function useCustomerDockClearance(): number | null {
  return React.useContext(CustomerDockClearanceContext);
}
