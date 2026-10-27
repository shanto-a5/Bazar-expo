import { hashCodeOf } from './time';

export type LocalImageSource = string;

export type ResolvedImage =
  | { kind: 'palette'; emoji: string; c1: string; c2: string }
  | { kind: 'uri'; uri: string };

const PALETTES: [string, string][] = [
  ['#FF6B6B', '#FF8E53'],
  ['#5F72BE', '#9921E8'],
  ['#0BA360', '#3CBA92'],
  ['#F7971E', '#FFD200'],
  ['#2193B0', '#6DD5ED'],
  ['#C33764', '#1D2671'],
  ['#F953C6', '#B91D73'],
  ['#24C6DC', '#514A9D'],
  ['#D4145A', '#FBB03B'],
  ['#43CEA2', '#185A9D'],
  ['#7A2828', '#A73737'],
  ['#536976', '#292E49'],
  ['#A80077', '#66FF00'],
  ['#8360C3', '#2EBF91'],
  ['#FC466B', '#3F5EFB'],
];

export function isPaletteImage(uri?: string | null): boolean {
  return !!uri && uri.startsWith('p:');
}

export function resolveImage(uri?: string | null): ResolvedImage | null {
  if (!uri) return null;
  if (uri.startsWith('p:')) {
    const parts = uri.split(':');
    const seed = parts[2] ?? parts[1] ?? 'x';
    const emoji = parts[2] ? parts[1] : '🛍️';
    const h = hashCodeOf(seed);
    const [c1, c2] = PALETTES[h % PALETTES.length];
    return { kind: 'palette', emoji, c1, c2 };
  }
  return { kind: 'uri', uri };
}

export function paletteFor(seed: string): [string, string] {
  return PALETTES[hashCodeOf(seed) % PALETTES.length];
}

export function makePaletteImage(emoji: string, seed: string): string {
  return `p:${emoji}:${seed}`;
}