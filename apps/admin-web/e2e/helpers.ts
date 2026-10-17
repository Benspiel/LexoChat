import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { STATE_FILE } from "./global-setup";

export function state(): { otp: string } {
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as { otp: string };
}

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA1, 6 digits, 30 s) - independent implementation for the tests. */
export function totp(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1]! & 0x0f;
  const bin = h.readUInt32BE(o) & 0x7fffffff;
  return String(bin % 1_000_000).padStart(6, "0");
}

let lastStep = 0;

/** Returns a code for a step that has not been used yet (waits for the next 30 s window if needed). */
export async function freshTotp(secretB32: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  while (step <= lastStep) {
    await new Promise((r) => setTimeout(r, 1000));
    step = Math.floor(Date.now() / 30_000);
  }
  lastStep = step;
  return totp(secretB32, step);
}

/** Fails on CSP violations and uncaught errors. */
export function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /Content Security Policy|Refused to/i.test(msg.text())) problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(err.message));
  return problems;
}

/** WCAG 2.1 AA check with axe-core. */
export async function expectAccessible(page: Page, context: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `axe violations on ${context}`).toEqual([]);
}
