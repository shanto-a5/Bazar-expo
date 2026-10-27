import { StyleSheet, TextStyle, ViewStyle } from 'react-native';

/**
 * Vanta design tokens — the single source of truth for color, spacing, radius,
 * shadow, and typography. Screens and shared components read from here; nothing
 * else should hard-code palette hexes.
 */
export const colors = {
  primary: '#F85606',
  primaryDark: '#4E2A8A',
  primarySoft: '#EEE5FB',
  accent: '#F59E0B',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F5F2',
  background: '#FAFAF9',
  border: '#E5E1DC',
  text: '#1C1917',
  textMuted: '#78716C',
  textFaint: '#A8A29E',
  textInverse: '#FFFFFF',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  success: '#16A34A',
  successSoft: '#DCFCE7',
  overlay: 'rgba(28, 25, 23, 0.45)',
} as const;

// Third-party brand palette for the local bKash payment simulator sheet. Kept
// here rather than inlined so the sheet still reads its colors from the token
// file like every other surface in the app.
export const bkashBrand = {
  pink: '#E2136E',
  pinkDark: '#A80E54',
  pinkSoft: '#FCE4F0',
} as const;

// Nagad brand palette for the local Nagad payment simulator sheet.
export const nagadBrand = {
  red: '#EE1C25',
  redDark: '#B3131A',
  redSoft: '#FCE3E3',
  orange: '#F6921E',
} as const;

// The card sheet is deliberately generic (no single bank is represented), so it
// reads its accent straight from the VANTA primary rather than a brand token.
export const cardBrand = {
  accent: colors.primary,
  accentSoft: colors.primarySoft,
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const type = {
  display: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 } as TextStyle,
  h1: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 } as TextStyle,
  h2: { fontSize: 18, fontWeight: '700' } as TextStyle,
  h3: { fontSize: 15, fontWeight: '600' } as TextStyle,
  body: { fontSize: 14, lineHeight: 20 } as TextStyle,
  bodyMuted: { fontSize: 14, lineHeight: 20, color: colors.textMuted } as TextStyle,
  caption: { fontSize: 12, color: colors.textMuted } as TextStyle,
  label: { fontSize: 13, fontWeight: '600' } as TextStyle,
} as const;

export function makeShadow(elevation = 2): ViewStyle {
  return {
    shadowColor: colors.text,
    shadowOpacity: elevation > 0 ? 0.08 : 0,
    shadowRadius: 3 + elevation * 1.5,
    shadowOffset: { width: 0, height: 1 + elevation },
    elevation,
  };
}

export function row(justify: 'flex-start' | 'center' | 'space-between' | 'flex-end' = 'space-between'): ViewStyle {
  return { flexDirection: 'row', alignItems: 'center', justifyContent: justify };
}

export const layout = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  padded: { padding: spacing.lg },
});
