// Display metadata and the categorical color palette shared by the spine legend
// and the galaxy points.

export interface ModelMeta {
  id: string;
  short: string;
  tagline: string;
}

// Ordered along the paper's recipe-context -> chemistry spectrum.
export const MODEL_META: ModelMeta[] = [
  { id: 'cooc', short: 'Co-occurrence', tagline: 'what cooks combine' },
  { id: 'core', short: 'Core', tagline: 'the balanced blend' },
  { id: 'chem', short: 'Chemistry', tagline: 'shared flavor compounds' },
];

export const SPECTRUM_ENDS = { left: 'Recipe context', right: 'Chemistry' };

// Open-source home, linked from the top bar.
export const REPO_URL = 'https://github.com/hairez/flavor-galaxy';

// Distinct hues that read well on a dark background.
const PALETTE_HEX = [
  '#f87171', // red
  '#fbbf24', // amber
  '#a3e635', // lime
  '#34d399', // emerald
  '#22d3ee', // cyan
  '#60a5fa', // blue
  '#a78bfa', // violet
  '#f472b6', // pink
  '#fb923c', // orange
  '#2dd4bf', // teal
  '#e879f9', // fuchsia
  '#facc15', // yellow
];

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const OTHER_HEX = '#4a4f6b'; // neutral grey for the low-confidence "Other" bucket

export function paletteHex(i: number): string {
  return PALETTE_HEX[i % PALETTE_HEX.length];
}

export function paletteRgb(i: number): [number, number, number] {
  return hexToRgb(paletteHex(i));
}

// Family color by name so the "Other" bucket reads as neutral grey, not a hue.
export function familyHex(name: string, i: number): string {
  return name === 'Other' ? OTHER_HEX : paletteHex(i);
}

export function familyRgb(name: string, i: number): [number, number, number] {
  return name === 'Other' ? hexToRgb(OTHER_HEX) : paletteRgb(i);
}
