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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { BlurView, BlurTargetView } from 'expo-blur';
import * as React from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ComponentRef } from 'react';

import { Button, Field, Logo } from '@/components/ui';
import { useLanguage } from '@/modules/language/language-context';
import { useSession } from '@/modules/session/session-context';
import { addressService } from '@/services/address-service';
import { colors, makeShadow, radius, spacing, type } from '@/theme/tokens';

/** The same shape the API accepts, so a number that passes here is accepted there. */
const PHONE_RE = /^[0-9+\-\s]{6,20}$/;
const POSTAL_RE = /^\d{4}$/;
const CACHED_GPS_STORAGE_KEY = 'bazar.cached_gps.v1';

type Coordinates = { latitude: number; longitude: number };

function validCoordinates(latitude: number, longitude: number): Coordinates | null {
  return Number.isFinite(latitude) && Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

/** Reads a coordinate pair or coordinates embedded in a full Google Maps URL. */
function parseCoordinates(value: string): Coordinates | null {
  const pair = value.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,，]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (pair) return validCoordinates(Number(pair[1]), Number(pair[2]));
  const path = value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
  const at = value.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  const match = path ?? at;
  return match ? validCoordinates(Number(match[1]), Number(match[2])) : null;
}

/** Google Maps share links redirect to a full URL whose coordinates can be parsed. */
async function resolveMapCoordinates(value: string): Promise<Coordinates | null> {
  const direct = parseCoordinates(value);
  if (direct) return direct;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || !/(^|\.)((maps\.app\.goo\.gl)|(goo\.gl)|(google\.[a-z.]+))$/i.test(url.hostname)) return null;
  try {
    const response = await fetch(url.toString(), { redirect: 'follow' });
    return parseCoordinates(response.url) ?? parseCoordinates(await response.text());
  } catch { return null; }
}

/** The address fields reverse geocoding can supply, any of which may be empty. */
export interface CapturedAddress {
  division: string;
  district: string;
  area: string;
  addressLine: string;
  postalCode: string;
  latitude: number;
  longitude: number;
}

let cachedQuickLocation: CapturedAddress | null = null;
let prefetchStarted = false;

export function getCachedQuickLocation(): CapturedAddress | null {
  return cachedQuickLocation;
}

function setCachedQuickLocation(next: CapturedAddress | null): void {
  cachedQuickLocation = next;
  if (next) {
    void AsyncStorage.setItem(CACHED_GPS_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
  } else {
    void AsyncStorage.removeItem(CACHED_GPS_STORAGE_KEY).catch(() => undefined);
  }
}

/**
 * Upfront, non-blocking GPS prefetch on app launch.
 *
 * Immediately requests foreground location permissions. If granted, reads
 * `Location.getLastKnownPositionAsync()` first for instant results, falling back
 * to `Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })`.
 * Coordinates are stored immediately in memory and AsyncStorage so Quick Account
 * can consume them with zero wait.
 */
export function prefetchQuickLocation(): void {
  if (prefetchStarted) return;
  prefetchStarted = true;

  void (async () => {
    try {
      const savedRaw = await AsyncStorage.getItem(CACHED_GPS_STORAGE_KEY).catch(() => null);
      if (savedRaw && !cachedQuickLocation) {
        try {
          const parsed = JSON.parse(savedRaw) as Partial<CapturedAddress>;
          const valid =
            typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number'
              ? validCoordinates(parsed.latitude, parsed.longitude)
              : null;
          if (valid) {
            cachedQuickLocation = {
              division: parsed.division ?? '',
              district: parsed.district ?? '',
              area: parsed.area ?? '',
              addressLine: parsed.addressLine ?? '',
              postalCode: parsed.postalCode ?? '',
              latitude: valid.latitude,
              longitude: valid.longitude,
            };
          }
        } catch {
          /* ignore corrupt storage */
        }
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setCachedQuickLocation(null);
        return;
      }

      let position = await Location.getLastKnownPositionAsync().catch(() => null);
      if (!position) {
        position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      }
      if (!position) return;

      const coords = validCoordinates(position.coords.latitude, position.coords.longitude);
      if (!coords) return;

      const baseCaptured: CapturedAddress = {
        division: '',
        district: '',
        area: '',
        addressLine: '',
        postalCode: '',
        latitude: coords.latitude,
        longitude: coords.longitude,
      };
      setCachedQuickLocation(baseCaptured);

      // Enrich with reverse geocoding in the background without blocking coordinate availability
      try {
        const results = await Location.reverseGeocodeAsync({
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        const place = results[0] ?? null;
        if (place) {
          const addressLine = [place.streetNumber, place.street ?? place.name].filter(Boolean).join(' ').trim();
          setCachedQuickLocation({
            division: place.region ?? '',
            district: place.city ?? place.subregion ?? '',
            area: place.district ?? place.subregion ?? place.city ?? '',
            addressLine,
            postalCode: place.postalCode ?? '',
            latitude: coords.latitude,
            longitude: coords.longitude,
          });
        }
      } catch {
        /* reverse geocode is optional */
      }
    } catch {
      /* location prefetch is best-effort */
    }
  })();
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
  const targetRef = React.useRef<ComponentRef<typeof View> | null>(null);
  // A stable animation value. Held in state (not a ref) so it can be read during
  // render for the interpolations without tripping the refs-during-render rule.
  const [progress] = React.useState(() => new Animated.Value(0));

  React.useEffect(() => {
    prefetchQuickLocation();
  }, []);

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
            onSuccess={() => {
              const after = request.onAuthenticated;
              setRequest(null);
              after?.();
            }}
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
  blurTarget: React.RefObject<ComponentRef<typeof View> | null>;
  progress: Animated.Value;
  onClose: () => void;
  onSuccess: () => void;
}): React.JSX.Element {
  const { quickAccount } = useSession();
  const { t } = useLanguage();
  const [phone, setPhone] = React.useState('');
  const [fieldError, setFieldError] = React.useState<string | undefined>(undefined);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [locationFallback, setLocationFallback] = React.useState(false);
  const [manualLocation, setManualLocation] = React.useState('');
  const [manualCoordinates, setManualCoordinates] = React.useState<Coordinates | null>(null);
  const [locationError, setLocationError] = React.useState<string | null>(null);
  const [resolvingLocation, setResolvingLocation] = React.useState(false);

  const run = async (locationMode: 'manual' | 'gps' | 'none'): Promise<void> => {
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

    let captured: ( Omit<CapturedAddress, 'latitude' | 'longitude'> & { latitude?: number; longitude?: number } ) | null = null;

    if (locationMode === 'gps') {
      // Read the globally cached GPS coordinates from Step 1 without re-fetching.
      const cached = getCachedQuickLocation();
      if (!cached) {
        // Permission was denied or coordinates are null: immediately show manual fallback without waiting.
        setLocationFallback(true);
        return;
      }
      captured = cached;
    } else if (locationMode === 'manual') {
      let manual = manualCoordinates;
      setLocationError(null);
      setResolvingLocation(true);
      manual = await resolveMapCoordinates(manualLocation);
      setResolvingLocation(false);
      if (!manual) {
        setLocationError('Enter valid latitude, longitude coordinates or a Google Maps link that includes them.');
        return;
      }
      captured = { division: '', district: '', area: '', addressLine: '', postalCode: '', ...manual };
    }

    setSubmitting(true);
    try {
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
            })
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
              onSubmitEditing={() => void run(locationFallback && manualLocation.trim() ? 'manual' : 'gps')}
            />

            {formError ? (
              <Text style={{ ...type.caption, color: colors.danger, marginBottom: spacing.sm }}>{formError}</Text>
            ) : null}

            {locationFallback ? (
              <View style={styles.locationBox}>
                <Text style={{ ...type.h3, color: colors.text, marginBottom: spacing.xs }}>
                  Use coordinates from Google Maps
                </Text>
                <Text style={{ ...type.caption, marginBottom: spacing.sm }}>
                  Your device couldn&apos;t share its location. Open Google Maps, tap the blue dot to find your current
                  location, then copy its coordinates or share link and paste it below. Location is optional.
                </Text>
                <Pressable
                  onPress={() => void Linking.openURL('https://maps.google.com/?q=My%20Location').catch(() => undefined)}
                  style={{ paddingVertical: spacing.xs, alignSelf: 'flex-start' }}
                  accessibilityRole="link"
                >
                  <Text style={{ ...type.caption, color: colors.accent, textDecorationLine: 'underline' }}>
                    Open Google Maps
                  </Text>
                </Pressable>
                <Field
                  label="Coordinates or Google Maps link"
                  value={manualLocation}
                  onChangeText={(value) => {
                    setManualLocation(value);
                    setManualCoordinates(parseCoordinates(value));
                    setLocationError(null);
                  }}
                  placeholder="23.8103, 90.4125 or paste a Maps link"
                  error={locationError}
                  hint="Example: 23.8103, 90.4125"
                  returnKeyType="done"
                  onSubmitEditing={() => void run('manual')}
                />
                <Button
                  title={t('confirmOrder')}
                  onPress={() => void run('manual')}
                  loading={submitting || resolvingLocation}
                  disabled={submitting || resolvingLocation}
                  fullWidth
                />
                <View style={{ height: spacing.sm }} />
                <Button
                  title="Continue without location"
                  variant="secondary"
                  onPress={() => void run('none')}
                  disabled={submitting || resolvingLocation}
                  fullWidth
                />
              </View>
            ) : (
              <View style={{ marginTop: spacing.sm }}>
                <Button
                  title="Continue with my current location"
                  onPress={() => void run('gps')}
                  loading={submitting}
                  disabled={submitting}
                  fullWidth
                />
                <View style={{ height: spacing.sm }} />
                <Button
                  title="Continue without location"
                  variant="secondary"
                  onPress={() => void run('none')}
                  disabled={submitting}
                  fullWidth
                />
              </View>
            )}
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
  locationBox: { marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceMuted, borderRadius: radius.lg },
  optionalAction: { alignItems: 'center', paddingVertical: spacing.sm },
});
