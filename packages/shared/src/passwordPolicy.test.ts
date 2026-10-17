import { describe, expect, it } from "vitest";
import { checkPassword, normalizedVariants } from "./passwordPolicy";

describe("password policy", () => {
  it("accepts a long passphrase", async () => {
    expect((await checkPassword("Kaffeetasse und Stethoskop am Fenster")).ok).toBe(true);
  });

  it("requires 12 characters", async () => {
    const r = await checkPassword("kurz123!");
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("Mindestens 12");
  });

  it("rejects common passwords and simple variants", async () => {
    for (const pw of ["123456789012", "qwertyuiop12", "Passwort2026!", "praxis123456", "P4ssw0rd!!!!", "ichliebedich1"]) {
      expect((await checkPassword(pw)).ok, pw).toBe(false);
    }
  });

  it("rejects trivial patterns", async () => {
    expect((await checkPassword("aaaaaaaaaaaaaa")).ok).toBe(false);
    expect((await checkPassword("abcdefghijklm")).ok).toBe(false);
  });

  it("rejects passwords containing the username or name", async () => {
    const r = await checkPassword("mueller-sicheres-pw", { username: "mueller", name: "Anna Müller" });
    expect(r.ok).toBe(false);
  });

  it("does not require character classes", async () => {
    expect((await checkPassword("blaue wolken ueber dem dach")).ok).toBe(true);
  });

  it("normalizes leetspeak and trailing digits", () => {
    expect(normalizedVariants("P4ssw0rd2026!")).toContain("password");
  });
});
