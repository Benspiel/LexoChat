const dt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/** Formats a PocketBase date ("2026-10-17 14:02:35.929Z"). */
export function formatDate(value?: string | null): string {
  if (!value) return "–";
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "–" : dt.format(d);
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Unbekannter Fehler.";
}
