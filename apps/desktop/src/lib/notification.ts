import type { Prefs } from "./store";

/**
 * Text of a Windows toast for an incoming message. Toasts can appear on the lock
 * screen, so by default neither sender nor content are shown (opt-in per person).
 */
export function notificationText(
  mode: Prefs["notificationContent"],
  senderName: string,
  body: string | null,
): { title: string; body: string } {
  if (mode === "sender") return { title: "LexiChat", body: `Neue Nachricht von ${senderName}` };
  if (mode === "full") return { title: senderName, body: body === null ? "Neue Nachricht" : body.slice(0, 120) };
  return { title: "LexiChat", body: "Neue Nachricht in LexiChat" };
}
