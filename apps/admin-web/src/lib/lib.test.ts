import { describe, expect, it } from "vitest";
import { errorText, formatDate } from "./format";
import { normalizeCode } from "./totp";

describe("normalizeCode", () => {
  it("strips spaces and non digits and limits to 6 digits", () => {
    expect(normalizeCode(" 123 456 ")).toBe("123456");
    expect(normalizeCode("12-34-56-78")).toBe("123456");
  });
});

describe("formatDate", () => {
  it("formats PocketBase dates in German", () => {
    expect(formatDate("2026-10-17 14:02:35.929Z")).toMatch(/17\.10\.2026/);
    expect(formatDate("")).toBe("–");
    expect(formatDate("kaputt")).toBe("–");
  });
});

describe("errorText", () => {
  it("never leaks non-error objects", () => {
    expect(errorText(new Error("Fehler"))).toBe("Fehler");
    expect(errorText({ secret: "x" })).toBe("Unbekannter Fehler.");
  });
});
