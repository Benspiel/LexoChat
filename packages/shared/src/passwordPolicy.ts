/**
 * Password policy (client side only – the server never sees the password, see
 * docs/00-architektur.md 2.1). Rules follow NIST SP 800-63B: minimum length,
 * blocklist of common passwords, no composition rules.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordContext {
  username?: string;
  name?: string;
}

export interface PasswordCheck {
  ok: boolean;
  /** German, user facing messages for every violated rule */
  problems: string[];
}

/** Additional German / practice specific blocklist entries (lowercase). */
const GERMAN_BLOCKLIST = [
  "passwort", "kennwort", "hallo", "hallo123", "geheim", "schatz", "sommer", "winter", "fruehling", "herbst",
  "frühling", "praxis", "arztpraxis", "praxisteam", "doktor", "lexichat", "willkommen", "anmeldung",
  "deutschland", "fussball", "fußball", "schalke", "bayern", "borussia", "mausi", "hase", "liebe",
  "ichliebedich", "qwertz", "qwertzuiop", "asdfghjkl", "yxcvbnm", "start", "startpasswort", "einmalpasswort",
  "patient", "patienten", "empfang", "sprechstunde", "termin",
];

let blocklist: Promise<Set<string>> | null = null;

/** The common password list (~49k entries) is loaded lazily to keep the initial bundle small. */
function loadBlocklist(): Promise<Set<string>> {
  blocklist ??= import("@zxcvbn-ts/language-common").then((m) => {
    const common = (m.dictionary as Record<string, string[]>)["passwords-common"] ?? [];
    return new Set([...common, ...GERMAN_BLOCKLIST].map((p) => p.toLowerCase()));
  });
  return blocklist;
}

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

/** Variants that are checked against the blocklist ("Praxis2026!" -> "praxis"). */
export function normalizedVariants(password: string): string[] {
  const lower = password.toLowerCase().normalize("NFC");
  const stripped = lower.replace(/[\d\W_]+$/u, "").replace(/^[\d\W_]+/u, "");
  const deleet = (v: string) => v.replace(/[013457@$!]/g, (c) => LEET[c] ?? c);
  return [...new Set([lower, stripped, deleet(lower), deleet(stripped)].filter((v) => v.length > 0))];
}

function isTrivial(password: string): boolean {
  if (new Set([...password]).size <= 3) return true; // "aaaaaaaaaaaa", "abababababab"
  const codes = [...password].map((c) => c.codePointAt(0) ?? 0);
  let sequential = true;
  for (let i = 1; i < codes.length; i++) {
    const d = (codes[i] ?? 0) - (codes[i - 1] ?? 0);
    if (Math.abs(d) !== 1) {
      sequential = false;
      break;
    }
  }
  return sequential;
}

export async function checkPassword(password: string, ctx: PasswordContext = {}): Promise<PasswordCheck> {
  const problems: string[] = [];
  const length = [...password].length;

  if (length < PASSWORD_MIN_LENGTH) problems.push(`Mindestens ${PASSWORD_MIN_LENGTH} Zeichen (aktuell ${length}).`);
  if (length > PASSWORD_MAX_LENGTH) problems.push(`Höchstens ${PASSWORD_MAX_LENGTH} Zeichen.`);
  if (password.trim() !== password) problems.push("Keine Leerzeichen am Anfang oder Ende.");
  if (length >= PASSWORD_MIN_LENGTH && isTrivial(password)) problems.push("Keine Wiederholungen oder einfachen Folgen.");

  const lower = password.toLowerCase();
  for (const part of [ctx.username, ...(ctx.name?.split(/\s+/) ?? [])]) {
    if (part && part.length >= 3 && lower.includes(part.toLowerCase())) {
      problems.push("Das Passwort darf Ihren Namen oder Benutzernamen nicht enthalten.");
      break;
    }
  }

  if (length >= PASSWORD_MIN_LENGTH) {
    const list = await loadBlocklist();
    if (normalizedVariants(password).some((v) => list.has(v))) {
      problems.push("Dieses Passwort ist zu verbreitet und leicht zu erraten.");
    }
  }

  return { ok: problems.length === 0, problems };
}
