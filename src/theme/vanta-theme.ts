/**
 * Vanta theme — the single source of truth for the marketplace's visual
 * language: palette, category color map, typography scale, spacing, radii,
 * shadows illus. Every screen pulls from here; hard-coded hex strings outside
 * this file are a bug. (M2-J visual architecture.)
 */
import type { TextStyle, ViewStyle } from 'react-native';

export const vanta = {
  colors: {
    // Brand / neutrals
    primary: '#F85606',
    primaryDark: '#4E2A8A',
    primarySoft: '#EEE5FB',
    accent: '#F59E0B',
    bg: '#FAFAF9',
    surface: '#FFFFFF',
    border: '#E8E6E4',
    text: '#1C1917',
    textMuted: '#78716C',
    textInverse: '#FFFFFF',
    overlay: 'rgba(28, 25, 23, 0.45)',
    danger: '#DC2626',
    dangerSoft: '#FEE2E2',
    success: '#16A34A',
    successSoft: '#DCFCE7',
    infoSoft: '#DBEAFE',
  },
  categoryColors: {
    Fashion: '#0F766E',
    Electronics: '#1D4ED8',
    'Home & Living': '#B45309',
    'Beauty & Health': '#BE185D',
    Sports: '#047857',
    'Toys & Kids': '#C2410C',
    'Automotive & Motorbike': '#4B5563',
    'Grocery & Pets': '#4D7C0F',
    'Featured/Mixed': '#F85606',
  },
  typography: {
    title: { fontSize: 28, fontWeight: '800' } as TextStyle,
    h1: { fontSize: 22, fontWeight: '700' } as TextStyle,
    h2: { fontSize: 17, fontWeight: '700' } as TextStyle,
    body: { fontSize: 14, fontWeight: '400' } as TextStyle,
    label: { fontSize: 13, fontWeight: '600' } as TextStyle,
    caption: { fontSize: 12, fontWeight: '400' } as TextStyle,
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32 },
  radius: { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 },
};

export interface Shadow {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
}

export function makeShadow(elevation = 2): Shadow {
  return {
    shadowColor: '#1C1917',
    shadowOpacity: 0.08 + elevation * 0.02,
    shadowRadius: 4 + elevation * 1.5,
    shadowOffset: { width: 0, height: 1 + elevation },
    elevation,
  };
}

export function card(): ViewStyle {
  return {
    backgroundColor: vanta.colors.surface,
    borderRadius: vanta.radius.lg,
    padding: vanta.spacing.lg,
    ...makeShadow(1),
  };
}

export const iconForeground = (token: string): { name: string; color: string } => {
  switch (token) {
    case 'customer':
      return { name: 'person', color: '#1D4ED8' };
    case 'seller':
      return { name: 'storefront', color: '#F85606' };
    case 'order':
      return { name: 'receipt-long', color: '#0F766E' };
    default:
      return { name: 'circle', color: vanta.colors.textMuted };
  }
};
