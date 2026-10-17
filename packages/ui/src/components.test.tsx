import { describe, expect, it } from "vitest";
import { initials } from "./components";

describe("initials", () => {
  it("uses first and last name", () => {
    expect(initials("Anna Maria Müller")).toBe("AM");
    expect(initials("praxisadmin")).toBe("P");
    expect(initials("  ")).toBe("?");
  });
});
