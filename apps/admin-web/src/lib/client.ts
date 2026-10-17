import { LexiChatClient } from "@lexichat/shared";

/** Hooks registered by the app (session expired -> back to the login). */
export const sessionEvents = { onExpired: () => {} };

/** One client per tab; the auth state lives only in memory (no cookies, no web storage). */
export const client = new LexiChatClient({
  device: "Verwaltung (Browser)",
  onUnauthorized: () => sessionEvents.onExpired(),
});
