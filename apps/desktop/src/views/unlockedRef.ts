import type { Unlocked } from "../lib/session";

// The unlocked key material lives only in memory, outside of React state.
let current: Unlocked | null = null;

export function getUnlocked(): Unlocked | null {
  return current;
}

export function setUnlocked(u: Unlocked | null): void {
  current = u;
}
