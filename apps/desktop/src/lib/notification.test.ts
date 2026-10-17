import { describe, expect, it } from "vitest";
import { notificationText } from "./notification";

describe("notificationText", () => {
  it("shows neither sender nor content by default", () => {
    const n = notificationText("none", "Dr. Anna Beispiel", "Befund Patient Müller");
    expect(JSON.stringify(n)).not.toContain("Anna");
    expect(JSON.stringify(n)).not.toContain("Befund");
  });

  it("shows only the sender when opted in", () => {
    const n = notificationText("sender", "Anna", "Befund Patient Müller");
    expect(n.body).toContain("Anna");
    expect(JSON.stringify(n)).not.toContain("Befund");
  });

  it("truncates content and hides undecryptable messages", () => {
    expect(notificationText("full", "Anna", "x".repeat(500)).body).toHaveLength(120);
    expect(notificationText("full", "Anna", null).body).toBe("Neue Nachricht");
  });

  it("falls back to the safe default for unknown modes", () => {
    const n = notificationText("bogus" as never, "Anna", "Befund");
    expect(JSON.stringify(n)).not.toMatch(/Anna|Befund/);
  });
});
