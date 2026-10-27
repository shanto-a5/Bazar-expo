/**
 * Quick-account popup (M14).
 *
 * Frictionless onboarding used to be a full screen: the customer was pushed
 * away from the cart, filled the form on a blank page, and popped back. This is
 * the same flow as a light, centered popup over the screen they were on.
 *
 * Two things make the overlay, rather than a route:
 *
 *   1. The cart/checkout underneath is never unmounted, so its state (applied
 *      voucher, selected lines, scroll) survives — and the blurred backdrop
 *      actually blurs it (`BlurView` blurs sibling content in the same window;
 *      inside a native `Modal` on iOS it would blur nothing).
 *   2. Checkout continuation is a plain state change: `useSession().quickAccount`
 *      flips the session to signed-in, so a guarded screen simply re-renders.
 *
 * The logic itself is unchanged from the screen it replaces: one phone number,
 * best-effort location to pre-fill a delivery address, and the server mints the
 * account. Location is optional in every sense — a refused permission or an
 * unreadable reverse geocode still creates the account and lets the address be
 * typed at checkout.
 */
import * as Location from 'expo-location';
import { BlurView, BlurTargetView } from 'expo-blur';
import * as React from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type View as ViewType,
} from 'react-native';

import { Button, Field, Logo } from '@/components/ui';
import { useSession } from '@/modules/session/session-context';
import { addressService } from '@/services/address-service';
import { colors, makeShadow, radius, spacing, type } from '@/theme/tokens';

/** The same shape the API accepts, so a number that passes here is accepted there. */
const PHONE_RE = /^[0-9+\-\s]{6,20}$/;
const POSTAL_RE = /^\d{4}$/;

/** The address fields reverse geocoding can supply, any of which may be empty. */
interface CapturedAddress {
  division: string;
  district: string;
  area: string;
  addressLine: string;
  postalCode: string;
}

/**
 * Best-effort "where am I". Resolves `null` when permission is refused or the fix
 * fails; a refused permission is a normal answer, not an error, because the
 * account can still be created and the address typed at checkout. Coordinates
 * are captured independently of reverse geocoding so GPS-only addresses work
 * internationally.
 */
async function captureAddress(): Promise<(CapturedAddress & { latitude?: number; longitude?: number }) | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') return null;

  let position: Location.LocationObject;
  try {
    position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  } catch {
    return null;
  }

  let place: Location.LocationGeocodedAddress | null = null;
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    });
    place = results[0] ?? null;
  } catch {
    place = null;
  }

  const addressLine = place
    ? [place.streetNumber, place.street ?? place.name].filter(Boolean).join(' ').trim()
    : '';
  return {
    division: place?.region ?? '',
    district: place?.city ?? place?.subregion ?? '',
    area: place?.district ?? place?.subregion ?? place?.city ?? '',
    addressLine,
    postalCode: place?.postalCode ?? '',
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

/** The address is only worth saving once the fields the API requires are present. */
function isComplete(address: CapturedAddress): boolean {
  return Boolean(address.division && address.district && address.addressLine);
}

export interface QuickAccountRequest {
  /** Runs once the account exists (and any captured address was saved). */
  onAuthenticated?: () => void;
  /** Runs when the popup is dismissed without creating an account. */
  onDismiss?: () => void;
}

interface QuickAccountContextValue {
  present: (request?: QuickAccountRequest) => void;
  dismiss: () => void;
}

const QuickAccountContext = React.createContext<QuickAccountContextValue | null>(null);

export function useQuickAccount(): QuickAccountContextValue {
  const value = React.useContext(QuickAccountContext);
  if (!value) throw new Error('useQuickAccount must be used within a QuickAccountProvider.');
  return value;
}

/**
 * Hosts the popup and the blurred backdrop above the app.
 *
 * The whole tree is wrapped in a `BlurTargetView` (Android needs an explicit
 * target to blur) and the overlay is a sibling of it, so the backdrop blurs the
 * live screen without ever unmounting it.
 */
export function QuickAccountProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [request, setRequest] = React.useState<QuickAccountRequest | null>(null);
  const targetRef = React.useRef<ViewType | null>(null);
  // A stable animation value. Held in state (not a ref) so it can be read during
  // render for the interpolations without tripping the refs-during-render rule.
  const [progress] = React.useState(() => new Animated.Value(0));

  const present = React.useCallback((next: QuickAccountRequest = {}) => {
    setRequest(next);
  }, []);

  const close = React.useCallback(
    (after?: () => void) => {
      Animated.timing(progress, {
        toValue: 0,
        duration: 150,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setRequest(null);
        after?.();
      });
    },
    [progress],
  );

  React.useEffect(() => {
    if (!request) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [request, progress]);

  const dismiss = React.useCallback(() => close(request?.onDismiss), [close, request]);

  const value = React.useMemo<QuickAccountContextValue>(() => ({ present, dismiss }), [present, dismiss]);

  return (
    <QuickAccountContext.Provider value={value}>
      <View style={styles.fill}>
        <BlurTargetView ref={targetRef} style={styles.fill}>
          {children}
        </BlurTargetView>
        {request ? (
          <QuickAccountOverlay
            blurTarget={targetRef}
            progress={progress}
            onClose={() => close(request.onDismiss)}
            onSuccess={() => close(request.onAuthenticated)}
          />
        ) : null}
      </View>
    </QuickAccountContext.Provider>
  );
}

function QuickAccountOverlay({
  blurTarget,
  progress,
  onClose,
  onSuccess,
}: {
  blurTarget: React.RefObject<ViewType | null>;
  progress: Animated.Value;
  onClose: () => void;
  onSuccess: () => void;
}): React.JSX.Element {
  const { quickAccount } = useSession();
  const [phone, setPhone] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | undefined>(undefined);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const run = async (withLocation: boolean): Promise<void> => {
    setFormError(null);
    const trimmed = phone.trim();
    if (!trimmed) {
      setFieldError('Enter your phone number.');
      return;
    }
    if (!PHONE_RE.test(trimmed)) {
      setFieldError('Enter a valid phone number.');
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    try {
      // Location is captured before the account exists: the permission prompt and
      // a fix are slow, and there is no reason to mint an account only to find the
      // customer refused.
      const captured = withLocation ? await captureAddress().catch(() => null) : null;

      const user = await quickAccount(trimmed);

      if (captured) {
        const hasCoords =
          typeof captured.latitude === 'number' &&
          typeof captured.longitude === 'number' &&
          Number.isFinite(captured.latitude) &&
          Number.isFinite(captured.longitude);
        const canSave =
          hasCoords ||
          (captured.division && captured.district && captured.addressLine);
        if (canSave) {
          // Best effort: a save failure must not stop the account from being usable.
          await addressService
            .add(user.id, {
              label: 'Current location',
              recipientName: user.name,
              phone: trimmed,
              division: captured.division || '',
              district: captured.district || '',
              area: captured.area || '',
              addressLine: captured.addressLine || '',
              postalCode: POSTAL_RE.test(captured.postalCode) ? captured.postalCode : '',
              isDefault: true,
              ...(hasCoords ? { latitude: captured.latitude, longitude: captured.longitude } : {}),
            } as any)
            .catch(() => undefined);
        }
      }
      // Success unmounts the popup, so `submitting` is intentionally left on.
      onSuccess();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to create your account. Try again.');
      setSubmitting(false);
    }
  };

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [28, 0] });
  const backdropOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView
        tint="dark"
        intensity={55}
        blurTarget={blurTarget}
        blurMethod="dimezisBlurView"
        style={StyleSheet.absoluteFill}
      />
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: backdropOpacity }]} />
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />
      <KeyboardAvoidingView
        style={styles.center}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.card, { opacity: backdropOpacity, transform: [{ translateY }] }]}>
          <View style={styles.head}>
            <Logo size={40} />
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <Text style={styles.closeGlyph}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
          >
            <Text style={{ ...type.h2, color: colors.text, marginBottom: spacing.xs }}>Just your number</Text>
            <Text style={{ ...type.caption, marginBottom: spacing.lg }}>
              No password to remember. Add your phone number and we&apos;ll set up your account so you can place the
              order.
            </Text>

            <Field
              label="Phone number"
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              error={fieldError}
              hint="We only use this to reach you about your orders."
              returnKeyType="done"
              onSubmitEditing={() => void run(false)}
            />

            {formError ? (
              <Text style={{ ...type.caption, color: colors.danger, marginBottom: spacing.sm }}>{formError}</Text>
            ) : null}

            <Button
              title="Use my current location & continue"
              onPress={() => void run(true)}
              loading={submitting}
              fullWidth
            />
            <View style={{ height: spacing.sm }} />
            <Button
              title="Continue without location"
              variant="secondary"
              onPress={() => void run(false)}
              disabled={submitting}
              fullWidth
            />
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { backgroundColor: colors.overlay },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '86%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...makeShadow(),
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  closeGlyph: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  scroll: { flexGrow: 0, flexShrink: 1 },
});
