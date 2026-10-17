import { readFileSync, rmSync } from "node:fs";
import { STATE_FILE } from "./global-setup";

export default function globalTeardown() {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { pids: number[] };
    for (const pid of state.pids) {
      try {
        process.kill(-pid); // whole process group (pnpm -> vite)
      } catch {
        // already gone
      }
    }
  } finally {
    rmSync(STATE_FILE, { force: true });
  }
}
