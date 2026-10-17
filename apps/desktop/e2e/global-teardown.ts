import { readFileSync, rmSync } from "node:fs";
import { STATE_FILE } from "./global-setup";

export default function globalTeardown() {
  try {
    const { pids } = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { pids: number[] };
    for (const pid of pids) {
      try {
        process.kill(-pid);
      } catch {
        // gone
      }
    }
  } finally {
    rmSync(STATE_FILE, { force: true });
  }
}
