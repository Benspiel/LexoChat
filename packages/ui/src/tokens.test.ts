import { describe, expect, it } from "vitest";
import { colors, contrast } from "./tokens";

// every text/background combination used by the components must reach WCAG AA (4.5:1)
const TEXT_PAIRS: [string, string, string][] = [
  ["ink on canvas", colors.ink, colors.canvas],
  ["ink on canvas-soft", colors.ink, colors.canvasSoft],
  ["ink on field", colors.ink, colors.field],
  ["canvas on ink (primary button)", colors.canvas, colors.ink],
  ["muted on canvas", colors.muted, colors.canvas],
  ["muted-strong on canvas-soft", colors.mutedStrong, colors.canvasSoft],
  ["muted-strong on field (placeholder)", colors.mutedStrong, colors.field],
  ["canvas on accent (badge)", colors.canvas, colors.accent],
  ["accent on canvas (link)", colors.accent, colors.canvas],
  ["muted-strong on canvas-soft (table header, segmented)", colors.mutedStrong, colors.canvasSoft],
  ["faint on ink (footer fine print)", colors.faint, colors.ink],
  ["canvas on ink-soft (primary hover)", colors.canvas, colors.inkSoft],
];

describe("design tokens", () => {
  it.each(TEXT_PAIRS)("%s reaches 4.5:1", (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("documents why muted-strong exists", () => {
    expect(contrast(colors.muted, colors.field)).toBeLessThan(4.5);
    expect(contrast(colors.faint, colors.canvas)).toBeLessThan(3); // decorative only
  });

  it("focus ring (ink) is clearly visible on every surface", () => {
    for (const bg of [colors.canvas, colors.canvasSoft, colors.field]) expect(contrast(colors.ink, bg)).toBeGreaterThanOrEqual(3);
  });
});
