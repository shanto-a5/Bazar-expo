/**
 * Full-screen area selector.
 *
 * Shown before anything else until the shopper has an area, and again (as an
 * overlay with a close button) when they tap the area in the Home header.
 * Built for first-time smartphone users: big targets, one text box, Bangla
 * first with English underneath. A typed area that nobody serves yet can still
 * be submitted — it is reported as a discovery and the Home feed shows a polite
 * "no shops yet" message instead of blocking the shopper.
 */
import * as Location from 'expo-location';
import * as React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/components/ui';
import { loadKnownAreas, refreshKnownAreas, useArea } from '@/modules/area/area-context';
import { findKnownArea, matchAreaTokens, suggestAreas, toAreaRef, type AreaRef } from '@/modules/area/area-logic';
import { colors, radius, spacing, type } from '@/theme/tokens';

export function AreaSelector({ canClose }: { canClose: boolean }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { selectArea, closeSelector, area: current } = useArea();
  const [areas, setAreas] = React.useState<AreaRef[]>([]);
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    void loadKnownAreas().then((cached) => {
      if (live && cached.length > 0) setAreas(cached);
    });
    void refreshKnownAreas()
      .then((fresh) => {
        if (live) setAreas(fresh);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const typedRef = toAreaRef(typed);
  const exact = findKnownArea(areas, typed);
  const suggestions = suggestAreas(areas, typed);

  const choose = React.useCallback(
    async (area: AreaRef, discover: boolean): Promise<void> => {
      if (busy) return;
      setBusy(true);
      try {
        await selectArea(area, { discover });
      } finally {
        setBusy(false);
      }
    },
    [busy, selectArea],
  );

  const submitTyped = React.useCallback((): void => {
    if (!typedRef) {
      setNotice('এলাকার নাম লিখুন। Please type your area name.');
      return;
    }
    // A name that matches a served area is a normal pick; anything else is a discovery.
    void choose(exact ?? typedRef, !exact);
  }, [typedRef, exact, choose]);

  const locateWithGps = React.useCallback(async (): Promise<void> => {
    setNotice(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setNotice('Location permission was not given. Please pick or type your area.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const [place] = await Location.reverseGeocodeAsync(position.coords);
      const match = matchAreaTokens([place?.district ?? '', place?.subregion ?? '', place?.city ?? '', place?.region ?? ''], areas);
      if (match) {
        await choose(match, false);
      } else {
        setNotice('We could not match your location. Please pick or type your area.');
      }
    } catch {
      setNotice('We could not read your location. Please pick or type your area.');
    }
  }, [areas, choose]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}
    >
      <View style={styles.topRow}>
        <Logo size={36} />
        {canClose ? (
          <Pressable onPress={closeSelector} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.title}>আপনার এলাকা বাছাই করুন</Text>
      <Text style={styles.subtitle}>Choose your area to see shops near you</Text>

      <TextInput
        value={typed}
        onChangeText={(text) => {
          setTyped(text);
          setNotice(null);
        }}
        placeholder="এলাকার নাম লিখুন (Type your area)"
        placeholderTextColor={colors.textFaint}
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={submitTyped}
        accessibilityLabel="Your area name"
        style={styles.input}
      />

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {typedRef && !exact ? (
          <Pressable
            onPress={submitTyped}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Use ${typedRef.name}`}
            style={({ pressed }) => [styles.useTyped, pressed && styles.pressed]}
          >
            <Text style={styles.useTypedText}>“{typedRef.name}” — এই এলাকা ব্যবহার করুন</Text>
            <Text style={styles.useTypedHint}>Use this area. We will tell local sellers.</Text>
          </Pressable>
        ) : null}

        {suggestions.map((area) => {
          const selected = current?.slug === area.slug;
          return (
            <Pressable
              key={area.slug}
              onPress={() => void choose(area, false)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={area.name}
              style={({ pressed }) => [styles.areaRow, selected && styles.areaRowSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.areaName, selected && { color: colors.primary }]}>{area.name}</Text>
              {selected ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          );
        })}

        {areas.length === 0 && !typedRef ? (
          <Text style={styles.empty}>এলাকার নাম লিখে দিন। Type the name of your village or area above.</Text>
        ) : null}
      </ScrollView>

      <Pressable
        onPress={() => void locateWithGps()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Use my location"
        style={({ pressed }) => [styles.gps, pressed && styles.pressed]}
      >
        <Text style={styles.gpsText}>📍 আমার অবস্থান ব্যবহার করুন · Use my location</Text>
      </Pressable>

      {busy ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} accessibilityLabel="Saving your area" /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    zIndex: 100,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  close: { fontSize: 22, color: colors.textMuted, fontWeight: '700' },
  title: { ...type.display, fontSize: 26, color: colors.text },
  subtitle: { ...type.bodyMuted, marginTop: spacing.xs, marginBottom: spacing.lg },
  input: {
    minHeight: 56,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    fontSize: 18,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  notice: { ...type.body, color: colors.danger, marginTop: spacing.sm },
  list: { gap: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.lg },
  useTyped: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
  },
  useTypedText: { color: colors.textInverse, fontSize: 17, fontWeight: '700' },
  useTypedHint: { color: colors.textInverse, fontSize: 13, marginTop: 2, opacity: 0.9 },
  areaRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  areaRowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  areaName: { fontSize: 18, fontWeight: '600', color: colors.text },
  check: { fontSize: 20, color: colors.primary, fontWeight: '800' },
  empty: { ...type.bodyMuted, textAlign: 'center', marginTop: spacing.xl },
  gps: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  gpsText: { fontSize: 15, fontWeight: '600', color: colors.text },
  pressed: { opacity: 0.8 },
});
