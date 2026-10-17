/**
 * Design tokens (Mobbin style, see /design and docs/03-design-system.md).
 * The CSS variables in styles.css mirror these values; tokens.test.ts checks the contrast.
 */
export const colors = {
  ink: "#141414",
  inkSoft: "#262626",
  canvas: "#ffffff",
  canvasSoft: "#f3f3f3",
  field: "#f0f0f0",
  hairline: "#e0e0e0",
  hairlineSoft: "#f0f0f0",
  muted: "#707070",
  /** deviation: muted text on soft/field surfaces (#707070 only reaches 4.35–4.46:1 there) */
  mutedStrong: "#696969",
  faint: "#adadad",
  accent: "#0066ff",
} as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;
export const radius = { pill: 9999, card: 24, tile: 16 } as const;

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
