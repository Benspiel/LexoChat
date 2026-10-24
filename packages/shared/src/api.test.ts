import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, LexiChatClient, filterString, userMessage } from "./api";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("LexiChatClient", () => {
  it("sends token and session header, never cookies", async () => {
    const f = mockFetch(200, { items: [] });
    const c = new LexiChatClient();
    c.auth = { token: "tok", sessionId: "sess", record: { id: "u", username: "a", name: "A" } };
    await c.list("users");
    const [, init] = f.mock.calls[0] as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h["Authorization"]).toBe("tok");
    expect(h["X-LexiChat-Session"]).toBe("sess");
    expect(init.credentials).toBe("omit");
  });

  it("stores the session id from the login meta", async () => {
    mockFetch(200, { token: "t", record: { id: "1", username: "a", name: "A" }, meta: { sessionId: "s1", mustChangePassword: true } });
    const c = new LexiChatClient();
    const r = await c.login("a", "k");
    expect(r.sessionId).toBe("s1");
    expect(r.mustChangePassword).toBe(true);
    expect(c.auth?.sessionId).toBe("s1");
  });

  it("keeps the resume secret of a desktop login and resumes without password", async () => {
    mockFetch(200, { token: "t", record: { id: "1", username: "a", name: "A" }, meta: { sessionId: "s1", resumeSecret: "r".repeat(64) } });
    const c = new LexiChatClient();
    await c.login("a", "k");
    expect(c.auth?.resumeSecret).toBe("r".repeat(64));

    const f = mockFetch(200, { token: "t2", record: { id: "1", username: "a", name: "A" }, meta: { sessionId: "s1" } });
    const fresh = new LexiChatClient();
    await fresh.resume("s1", "r".repeat(64));
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/lexichat/session/resume");
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: "s1", resumeSecret: "r".repeat(64) });
    expect(fresh.auth).toMatchObject({ token: "t2", sessionId: "s1", resumeSecret: "r".repeat(64) });
  });

  it("drops the auth state on 401 and notifies", async () => {
    mockFetch(401, { message: "Ihre Sitzung ist abgelaufen oder wurde beendet." });
    const onUnauthorized = vi.fn();
    const c = new LexiChatClient({ onUnauthorized });
    c.auth = { token: "t", sessionId: "s", record: { id: "u", username: "a", name: "A" } };
    await expect(c.list("users")).rejects.toBeInstanceOf(ApiError);
    expect(c.auth).toBeNull();
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it("exposes the totpRequired flag", async () => {
    mockFetch(401, { message: "Bitte geben Sie den Code ein.", data: { totp: { code: "totp_required", message: "x" } } });
    const err = await new LexiChatClient().login("a", "k").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).totpRequired).toBe(true);
  });
});

describe("helpers", () => {
  it("replaces English default messages", () => {
    expect(userMessage(404, "The requested resource wasn't found.")).toBe("Nicht gefunden.");
    expect(userMessage(400, "Das aktuelle Passwort ist falsch.")).toBe("Das aktuelle Passwort ist falsch.");
  });

  it("escapes filter strings", () => {
    expect(filterString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});
