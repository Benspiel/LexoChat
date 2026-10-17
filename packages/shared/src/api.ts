import type { KdfParams } from "@lexichat/crypto";

export const HEADER_SESSION = "X-LexiChat-Session";
export const HEADER_DEVICE = "X-LexiChat-Device";

/** Error returned by the LexiChat / PocketBase api. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** the login needs (another) second factor code */
  get totpRequired(): boolean {
    const code = (this.data["totp"] as { code?: string } | undefined)?.code;
    return code === "totp_required" || code === "totp_invalid";
  }
}

export interface AuthState {
  token: string;
  sessionId: string;
  record: UserRecord;
}

export interface UserRecord {
  id: string;
  username: string;
  name: string;
  role?: "admin" | "user";
  active?: boolean;
  must_change_password?: boolean;
  totp_enabled?: boolean;
  locked?: boolean;
  has_keys?: boolean;
  avatar?: string;
  key_version?: number;
  created?: string;
  updated?: string;
}

export interface LoginResult extends AuthState {
  mustChangePassword: boolean;
  totpSetupRequired: boolean;
}

export interface ListResult<T> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

const FALLBACK_MESSAGES: Record<number, string> = {
  0: "Der Server ist nicht erreichbar. Bitte prüfen Sie die Verbindung.",
  400: "Die Anfrage war ungültig.",
  401: "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
  403: "Für diese Aktion fehlen die Berechtigungen.",
  404: "Nicht gefunden.",
  409: "Konflikt mit vorhandenen Daten.",
  429: "Zu viele Anfragen. Bitte warten Sie einen Moment.",
  500: "Interner Serverfehler.",
};

/** PocketBase's own default messages are English; ours are German. English ones are replaced. */
const ENGLISH_MESSAGE = /\b(the|failed|wasn't|resource|request|requested|something|went|wrong|missing|invalid|only|allowed)\b/i;

export function userMessage(status: number, message: unknown): string {
  if (typeof message === "string" && message.trim() !== "" && !ENGLISH_MESSAGE.test(message)) {
    return message;
  }
  return FALLBACK_MESSAGES[status] ?? FALLBACK_MESSAGES[500]!;
}

export interface ClientOptions {
  /** API base url; "" means same origin */
  baseUrl?: string;
  device?: string;
  /** called whenever the server rejects the session (401) */
  onUnauthorized?: () => void;
}

/**
 * Minimal fetch based client for the LexiChat api. Keeps the auth state in memory only
 * (no cookies, no localStorage).
 */
export class LexiChatClient {
  auth: AuthState | null = null;

  constructor(private readonly opts: ClientOptions = {}) {}

  async request<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.auth) {
      headers["Authorization"] = this.auth.token;
      headers[HEADER_SESSION] = this.auth.sessionId;
    }
    if (this.opts.device) headers[HEADER_DEVICE] = this.opts.device;

    let res: Response;
    try {
      res = await fetch((this.opts.baseUrl ?? "") + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new ApiError(0, FALLBACK_MESSAGES[0]!);
    }

    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 401 && this.auth && !path.endsWith("/auth-with-password")) {
        this.auth = null;
        this.opts.onUnauthorized?.();
      }
      throw new ApiError(res.status, userMessage(res.status, json["message"]), (json["data"] as Record<string, unknown>) ?? {});
    }
    return json as T;
  }

  prelogin(username: string): Promise<{ salt: string; params: KdfParams }> {
    return this.request("GET", `/api/lexichat/prelogin?username=${encodeURIComponent(username)}`);
  }

  async login(username: string, authKey: string, totp?: string): Promise<LoginResult> {
    const body: Record<string, string> = { identity: username, password: authKey };
    if (totp) body["totp"] = totp;
    const res = await this.request<{ token: string; record: UserRecord; meta: Record<string, unknown> }>(
      "POST",
      "/api/collections/users/auth-with-password",
      body,
    );
    this.auth = { token: res.token, sessionId: String(res.meta["sessionId"]), record: res.record };
    return {
      ...this.auth,
      mustChangePassword: res.meta["mustChangePassword"] === true,
      totpSetupRequired: res.meta["totpSetupRequired"] === true,
    };
  }

  async refresh(): Promise<void> {
    const res = await this.request<{ token: string; record: UserRecord }>("POST", "/api/collections/users/auth-refresh");
    if (this.auth) this.auth = { ...this.auth, token: res.token, record: res.record };
  }

  /** Ends the current session on the server (best effort) and forgets the token. */
  async logout(): Promise<void> {
    const auth = this.auth;
    if (!auth) return;
    try {
      await this.request("DELETE", `/api/collections/sessions/records/${encodeURIComponent(auth.sessionId)}`);
    } catch {
      // the session may already be gone
    } finally {
      this.auth = null;
    }
  }

  list<T>(collection: string, query: { page?: number; perPage?: number; sort?: string; filter?: string } = {}): Promise<ListResult<T>> {
    const q = new URLSearchParams();
    q.set("page", String(query.page ?? 1));
    q.set("perPage", String(query.perPage ?? 50));
    if (query.sort) q.set("sort", query.sort);
    if (query.filter) q.set("filter", query.filter);
    return this.request("GET", `/api/collections/${collection}/records?${q.toString()}`);
  }

  update<T>(collection: string, id: string, data: Record<string, unknown>): Promise<T> {
    return this.request("PATCH", `/api/collections/${collection}/records/${encodeURIComponent(id)}`, data);
  }

  remove(collection: string, id: string): Promise<void> {
    return this.request("DELETE", `/api/collections/${collection}/records/${encodeURIComponent(id)}`);
  }
}

/** Escapes a value for use inside a PocketBase filter string literal. */
export function filterString(value: string): string {
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
