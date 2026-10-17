import { describe, expect, it } from "vitest";
import {
  fingerprint,
  generateIdentity,
  newRecoveryKey,
  parseRecoveryKey,
  recoveryWrapKey,
  safetyNumber,
  unwrapIdentity,
  wrapIdentity,
} from "./keys";
import { sodium } from "./sodium";

describe("identity keys", () => {
  it("wraps and unwraps the private keys", async () => {
    const s = await sodium();
    const id = await generateIdentity();
    const kek = s.randombytes_buf(32);
    const blob = await wrapIdentity(id, kek);
    expect(JSON.stringify(blob)).not.toContain(s.to_base64(id.encPrivate, s.base64_variants.ORIGINAL));
    const back = await unwrapIdentity(blob, kek);
    expect(back.encPrivate).toEqual(id.encPrivate);
    expect(back.encPublic).toEqual(id.encPublic);
    expect(back.signPublic).toEqual(id.signPublic);
  });

  it("rejects a wrong key and a modified blob", async () => {
    const s = await sodium();
    const id = await generateIdentity();
    const kek = s.randombytes_buf(32);
    const blob = await wrapIdentity(id, kek);
    await expect(unwrapIdentity(blob, s.randombytes_buf(32))).rejects.toThrow();
    const ct = s.from_base64(blob.ct, s.base64_variants.ORIGINAL);
    ct[3] = ct[3]! ^ 1;
    await expect(unwrapIdentity({ ...blob, ct: s.to_base64(ct, s.base64_variants.ORIGINAL) }, kek)).rejects.toThrow();
  });
});

describe("recovery key", () => {
  it("roundtrips through the display format", async () => {
    const key = await newRecoveryKey();
    expect(key).toMatch(/^([A-Z2-9]{4}-){13}[A-Z2-9]{4}$/);
    const raw = await parseRecoveryKey(key.toLowerCase().replace(/-/g, " "));
    expect(raw).toHaveLength(32);
    const again = await parseRecoveryKey(key);
    expect(again).toEqual(raw);
  });

  it("detects typos via the checksum", async () => {
    const key = await newRecoveryKey();
    const typo = (key[0] === "A" ? "B" : "A") + key.slice(1);
    await expect(parseRecoveryKey(typo)).rejects.toThrow(/Prüfsumme/);
    await expect(parseRecoveryKey("ABCD")).rejects.toThrow();
  });

  it("can unlock wrapped keys", async () => {
    const id = await generateIdentity();
    const raw = await parseRecoveryKey(await newRecoveryKey());
    const blob = await wrapIdentity(id, await recoveryWrapKey(raw));
    const back = await unwrapIdentity(blob, await recoveryWrapKey(raw));
    expect(back.signPrivate).toEqual(id.signPrivate);
  });
});

describe("fingerprints", () => {
  it("are deterministic, 60 digits, and symmetric as safety numbers", async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const fa = await fingerprint(a.encPublic, a.signPublic);
    expect(fa).toMatch(/^(\d{5} ){11}\d{5}$/);
    expect(await fingerprint(a.encPublic, a.signPublic)).toBe(fa);
    expect(await fingerprint(b.encPublic, b.signPublic)).not.toBe(fa);
    expect(await safetyNumber(a, b)).toBe(await safetyNumber(b, a));
  });
});
