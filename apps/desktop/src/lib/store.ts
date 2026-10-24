import { useSyncExternalStore } from "react";
import {
  broadcastContext,
  decryptMessage,
  directContext,
  encryptMessage,
  fingerprint,
  fromB64,
  type EncryptedMessage,
  type Identity,
  type MessagePayload,
} from "@lexichat/crypto";
import { RealtimeConnection, filterString, type RealtimeStatus, type UserRecord } from "@lexichat/shared";
import { client } from "./session";
import { localCache, notify } from "./platform";
import { notificationText } from "./notification";

// ------------------------------------------------------------------ types

export interface Contact {
  id: string;
  username: string;
  name: string;
  avatar: string;
  active: boolean;
  anonymized: boolean;
  publicEncKey: string;
  publicSignKey: string;
  keyVersion: number;
}

export interface Chat {
  id: string;
  members: string[];
  last_message_at: string;
  created: string;
}

export interface MessageRecord extends EncryptedMessage {
  id: string;
  chat: string;
  sender: string;
  is_broadcast: boolean;
  broadcast: string;
  reply_to: string;
  edited_at: string;
  created: string;
}

export interface Receipt {
  id: string;
  message: string;
  user: string;
  delivered_at: string;
  read_at: string;
}

export type Decrypted = { ok: true; payload: MessagePayload } | { ok: false; error: string };

export interface Prefs {
  readReceipts: boolean;
  typing: boolean;
  presence: boolean;
  notificationContent: "none" | "sender" | "full";
  listPreview: boolean;
}

export const DEFAULT_PREFS: Prefs = { readReceipts: false, typing: false, presence: false, notificationContent: "none", listPreview: false };

export interface GlobalSettings {
  message_retention_days: number;
  broadcast_permission: "all" | "admins";
  desktop_lock_minutes: number;
  allow_2fa_users: boolean;
}

interface Outgoing {
  tempId: string;
  chat: string;
  body: string;
  replyTo?: string;
  status: "sending" | "failed";
  /** nonce of the encrypted message: matches the realtime echo of the own message */
  nonce?: string;
}

interface LocalState {
  /** trust on first use: userId -> fingerprint we have seen */
  known: Record<string, string>;
  /** userId -> fingerprint the person verified manually */
  verified: Record<string, string>;
  /** chatId -> ISO time of the last message the person has seen (local only, never sent) */
  lastRead: Record<string, string>;
  /** local app settings */
  local: { captureProtection: boolean };
}

interface State {
  me: UserRecord | null;
  identity: Identity | null;
  prefs: Prefs;
  settings: GlobalSettings | null;
  contacts: Map<string, Contact>;
  fingerprints: Map<string, string>;
  chats: Chat[];
  messages: Map<string, MessageRecord[]>;
  hasMore: Map<string, boolean>;
  decrypted: Map<string, Decrypted>;
  receipts: Map<string, Receipt[]>;
  outbox: Outgoing[];
  typing: Map<string, { user: string; until: number }>;
  online: Set<string>;
  connection: RealtimeStatus;
  activeChat: string | null;
  local: LocalState;
  windowFocused: boolean;
}

// ------------------------------------------------------------------ store

const listeners = new Set<() => void>();
let version = 0;

const state: State = {
  me: null,
  identity: null,
  prefs: DEFAULT_PREFS,
  settings: null,
  contacts: new Map(),
  fingerprints: new Map(),
  chats: [],
  messages: new Map(),
  hasMore: new Map(),
  decrypted: new Map(),
  receipts: new Map(),
  outbox: [],
  typing: new Map(),
  online: new Set(),
  connection: "connecting",
  activeChat: null,
  local: { known: {}, verified: {}, lastRead: {}, local: { captureProtection: false } },
  windowFocused: true,
};

function emit() {
  version++;
  for (const l of listeners) l();
}

export function useStore<T>(select: (s: State) => T): T {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  return select(state);
}

export function getState(): State {
  return state;
}

let realtime: RealtimeConnection | null = null;
let presenceTimer: number | undefined;

async function saveLocal() {
  await localCache.write(`local-${state.me?.id ?? "x"}`, state.local);
}

// ------------------------------------------------------------------ lifecycle

export async function start(me: UserRecord, identity: Identity): Promise<void> {
  state.me = me;
  state.identity = identity;
  state.prefs = DEFAULT_PREFS;
  state.local = await localCache.read<LocalState>(`local-${me.id}`, state.local);
  state.local.lastRead ??= {};
  emit();

  await Promise.all([loadSettings(), loadDirectory(), loadChats(), refreshMe()]);
  realtime = new RealtimeConnection(
    client,
    ["chats", "messages", "receipts", "users", "lexichat/typing"],
    (topic, data) => void onRealtime(topic, data),
    (status) => {
      const wasOffline = state.connection !== "online";
      state.connection = status;
      emit();
      if (status === "online" && wasOffline) void resync();
    },
  );
  realtime.connect();
  presenceTimer = window.setInterval(() => void loadPresence(), 30_000);
  void loadPresence();
}

/** Lock: private keys and decrypted texts are removed from memory. */
export function lock(): void {
  state.identity = null;
  state.decrypted.clear();
  emit();
}

export function unlock(identity: Identity): void {
  state.identity = identity;
  emit();
  for (const msgs of state.messages.values()) void decryptAll(msgs);
}

export function stop(): void {
  realtime?.close();
  realtime = null;
  window.clearInterval(presenceTimer);
  state.me = null;
  state.identity = null;
  state.contacts.clear();
  state.chats = [];
  state.messages.clear();
  state.decrypted.clear();
  state.receipts.clear();
  state.outbox = [];
  state.activeChat = null;
  emit();
}

async function resync() {
  await Promise.all([loadDirectory(), loadChats()]);
  if (state.activeChat) await loadMessages(state.activeChat, true);
  await flushOutbox();
}

export function setWindowFocused(f: boolean) {
  state.windowFocused = f;
  if (f && state.activeChat) markRead(state.activeChat);
  emit();
}

// ------------------------------------------------------------------ loading

async function refreshMe() {
  const [me, prefs] = await Promise.all([
    client.request<UserRecord>("GET", `/api/collections/users/records/${state.me!.id}`),
    client.request<Partial<Prefs>>("GET", "/api/lexichat/me/prefs"),
  ]);
  state.me = me;
  state.prefs = { ...DEFAULT_PREFS, ...prefs };
  emit();
}

async function loadSettings() {
  state.settings = await client.request<GlobalSettings>("GET", "/api/collections/lx_settings/records/globalsettings1");
  emit();
}

export async function loadDirectory(): Promise<void> {
  const res = await client.request<{ users: Contact[] }>("GET", "/api/lexichat/directory");
  state.contacts = new Map(res.users.map((u) => [u.id, u]));
  // fingerprints + trust on first use
  let changed = false;
  for (const c of res.users) {
    if (!c.publicEncKey || !c.publicSignKey) continue;
    const fp = await fingerprint(await fromB64(c.publicEncKey), await fromB64(c.publicSignKey));
    state.fingerprints.set(c.id, fp);
    if (!state.local.known[c.id]) {
      state.local.known[c.id] = fp;
      changed = true;
    }
  }
  if (changed) void saveLocal();
  emit();
}

/** The keys of a contact changed since we first saw them (and were not acknowledged yet). */
export function keyChanged(userId: string): boolean {
  const fp = state.fingerprints.get(userId);
  const known = state.local.known[userId];
  return !!fp && !!known && fp !== known;
}

export function isVerified(userId: string): boolean {
  const fp = state.fingerprints.get(userId);
  return !!fp && state.local.verified[userId] === fp;
}

export async function acknowledgeKeyChange(userId: string): Promise<void> {
  const fp = state.fingerprints.get(userId);
  if (!fp) return;
  state.local.known[userId] = fp;
  if (state.local.verified[userId] && state.local.verified[userId] !== fp) delete state.local.verified[userId];
  await saveLocal();
  emit();
}

export async function setVerified(userId: string, verified: boolean): Promise<void> {
  const fp = state.fingerprints.get(userId);
  if (verified && fp) state.local.verified[userId] = fp;
  else delete state.local.verified[userId];
  await saveLocal();
  emit();
}

export async function loadChats(): Promise<void> {
  const res = await client.list<Chat>("chats", { perPage: 500, sort: "-last_message_at,-created" });
  state.chats = res.items;
  emit();
  // last message per chat (for unread markers and the optional preview)
  await Promise.all(
    res.items.map(async (c) => {
      if (!state.messages.has(c.id)) await loadMessages(c.id, true, 1);
    }),
  );
}

export async function loadMessages(chatId: string, reset = false, perPage = 50): Promise<void> {
  const existing = reset ? [] : (state.messages.get(chatId) ?? []);
  const before = existing[0]?.created;
  const filter = `chat = ${filterString(chatId)}` + (before ? ` && created < ${filterString(before)}` : "");
  const res = await client.list<MessageRecord>("messages", { perPage, sort: "-created", filter });
  const merged = [...res.items.reverse(), ...existing];
  state.messages.set(chatId, dedupe(merged));
  state.hasMore.set(chatId, res.totalItems > merged.length);
  emit();
  await decryptAll(res.items);
  await acknowledgeDelivery(res.items);
  if (perPage > 1) await loadReceipts(chatId);
}

function dedupe(list: MessageRecord[]): MessageRecord[] {
  const seen = new Map<string, MessageRecord>();
  for (const m of list) seen.set(m.id, m);
  return [...seen.values()].sort((a, b) => a.created.localeCompare(b.created));
}

async function loadReceipts(chatId: string) {
  const res = await client.list<Receipt>("receipts", { perPage: 500, filter: `message.chat = ${filterString(chatId)}` });
  for (const r of res.items) upsertReceipt(r);
  emit();
}

function upsertReceipt(r: Receipt) {
  const list = (state.receipts.get(r.message) ?? []).filter((x) => x.id !== r.id);
  list.push(r);
  state.receipts.set(r.message, list);
}

async function loadPresence() {
  if (!state.prefs.presence) {
    state.online = new Set();
    emit();
    return;
  }
  try {
    const res = await client.request<{ online: string[] }>("GET", "/api/lexichat/presence");
    state.online = new Set(res.online);
    emit();
  } catch {
    // ignore
  }
}

// ------------------------------------------------------------------ crypto helpers

export function otherMember(chat: Chat): string {
  return chat.members.find((m) => m !== state.me?.id) ?? "";
}

function messageContext(m: MessageRecord): string {
  if (!m.is_broadcast) return directContext(m.chat);
  const chat = state.chats.find((c) => c.id === m.chat);
  const recipient = chat?.members.find((x) => x !== m.sender) ?? "";
  return broadcastContext(recipient);
}

async function decryptAll(list: MessageRecord[]) {
  const id = state.identity;
  if (!id || !state.me) return;
  for (const m of list) {
    if (state.decrypted.has(m.id)) continue;
    const sender = state.contacts.get(m.sender);
    if (!sender?.publicSignKey) {
      state.decrypted.set(m.id, { ok: false, error: "Absender kann nicht geprüft werden (Konto entfernt)." });
      continue;
    }
    try {
      const payload = await decryptMessage({
        message: m,
        context: messageContext(m),
        senderId: m.sender,
        senderSignPublic: await fromB64(sender.publicSignKey),
        myId: state.me.id,
        myEncPublic: id.encPublic,
        myEncPrivate: id.encPrivate,
      });
      state.decrypted.set(m.id, { ok: true, payload });
    } catch (err) {
      state.decrypted.set(m.id, { ok: false, error: err instanceof Error ? err.message : "Nicht lesbar." });
    }
  }
  emit();
}

async function acknowledgeDelivery(list: MessageRecord[]) {
  const me = state.me?.id;
  for (const m of list) {
    if (m.sender === me || (state.receipts.get(m.id) ?? []).some((r) => r.user === me)) continue;
    try {
      const r = await client.request<Receipt>("POST", "/api/collections/receipts/records", { message: m.id, user: me });
      upsertReceipt(r);
    } catch {
      // already exists (unique) or message gone
    }
  }
}

// ------------------------------------------------------------------ actions

export function openChat(chatId: string | null) {
  state.activeChat = chatId;
  emit();
  if (chatId) {
    void loadMessages(chatId, true).then(() => markRead(chatId));
  }
}

export function markRead(chatId: string) {
  const msgs = state.messages.get(chatId) ?? [];
  const last = msgs[msgs.length - 1];
  if (!last) return;
  if (state.local.lastRead[chatId] !== last.created) {
    state.local.lastRead[chatId] = last.created;
    void saveLocal();
  }
  // read receipts only if the person enabled them (privacy by default)
  if (state.prefs.readReceipts && state.windowFocused) {
    for (const m of msgs) {
      if (m.sender === state.me?.id) continue;
      const mine = (state.receipts.get(m.id) ?? []).find((r) => r.user === state.me?.id);
      if (mine && !mine.read_at) {
        void client
          .update<Receipt>("receipts", mine.id, { read_at: new Date().toISOString() })
          .then((r) => {
            upsertReceipt(r);
            emit();
          })
          .catch(() => {});
      }
    }
  }
  emit();
}

export function unreadCount(chatId: string): number {
  const last = state.local.lastRead[chatId] ?? "";
  return (state.messages.get(chatId) ?? []).filter((m) => m.sender !== state.me?.id && m.created > last).length;
}

export function chatHasUnread(chat: Chat): boolean {
  const last = state.local.lastRead[chat.id] ?? "";
  const msgs = state.messages.get(chat.id) ?? [];
  const newest = msgs[msgs.length - 1];
  return !!newest && newest.sender !== state.me?.id && newest.created > last;
}

export async function findOrCreateChat(userId: string): Promise<string> {
  const existing = state.chats.find((c) => c.members.includes(userId) && c.members.includes(state.me!.id));
  if (existing) return existing.id;
  try {
    const chat = await client.request<Chat>("POST", "/api/collections/chats/records", { type: "direct", members: [state.me!.id, userId] });
    state.chats = [chat, ...state.chats];
    state.messages.set(chat.id, []);
    emit();
    return chat.id;
  } catch (err) {
    // 409: the chat already exists (e.g. created by the other side a moment ago)
    await loadChats();
    const again = state.chats.find((c) => c.members.includes(userId) && c.members.includes(state.me!.id));
    if (again) return again.id;
    throw err;
  }
}

async function encryptFor(chat: Chat, body: string, context: string): Promise<EncryptedMessage> {
  const me = state.me!;
  const id = state.identity;
  if (!id) throw new Error("Die App ist gesperrt.");
  const partnerId = otherMember(chat);
  const partner = state.contacts.get(partnerId);
  if (!partner?.publicEncKey || !partner.active) throw new Error("Diese Person kann keine Nachrichten empfangen.");
  if (keyChanged(partnerId)) throw new Error("Die Sicherheitsnummer hat sich geändert. Bitte bestätigen Sie die Änderung zuerst.");
  return encryptMessage({
    payload: { t: "text", body, ts: Date.now() },
    context,
    senderId: me.id,
    senderSignPrivate: id.signPrivate,
    recipients: [
      { id: me.id, encPublic: id.encPublic },
      { id: partnerId, encPublic: await fromB64(partner.publicEncKey) },
    ],
  });
}

export async function sendMessage(chatId: string, body: string, replyTo?: string): Promise<void> {
  const text = body.trim();
  if (!text) return;
  const out: Outgoing = { tempId: crypto.randomUUID(), chat: chatId, body: text, replyTo, status: "sending" };
  state.outbox.push(out);
  emit();
  await trySend(out);
}

async function trySend(out: Outgoing) {
  const chat = state.chats.find((c) => c.id === out.chat);
  if (!chat) return;
  try {
    const enc = await encryptFor(chat, out.body, directContext(chat.id));
    out.nonce = enc.nonce;
    const rec = await client.request<MessageRecord>("POST", "/api/collections/messages/records", {
      chat: chat.id,
      sender: state.me!.id,
      ...enc,
      ...(out.replyTo ? { reply_to: out.replyTo } : {}),
    });
    state.outbox = state.outbox.filter((o) => o.tempId !== out.tempId);
    state.decrypted.set(rec.id, { ok: true, payload: { t: "text", body: out.body } });
    state.messages.set(chat.id, dedupe([...(state.messages.get(chat.id) ?? []), rec]));
    state.local.lastRead[chat.id] = rec.created;
    void saveLocal();
  } catch (err) {
    out.status = "failed";
    const status = (err as { status?: number }).status;
    if (status !== 0) {
      // permanent error (not a network problem): keep it visible with the reason
      (out as Outgoing & { error?: string }).error = err instanceof Error ? err.message : "Senden fehlgeschlagen.";
    }
  }
  emit();
}

export async function flushOutbox(): Promise<void> {
  for (const o of [...state.outbox]) {
    if (o.status === "failed" && !(o as Outgoing & { error?: string }).error) {
      o.status = "sending";
      await trySend(o);
    }
  }
}

export function retry(tempId: string) {
  const o = state.outbox.find((x) => x.tempId === tempId);
  if (!o) return;
  o.status = "sending";
  delete (o as Outgoing & { error?: string }).error;
  void trySend(o);
}

export function discard(tempId: string) {
  state.outbox = state.outbox.filter((o) => o.tempId !== tempId);
  emit();
}

export async function editMessage(m: MessageRecord, body: string): Promise<void> {
  const chat = state.chats.find((c) => c.id === m.chat);
  if (!chat) return;
  const enc = await encryptFor(chat, body.trim(), directContext(chat.id));
  // the format version is fixed per message and must not be part of an update
  const rec = await client.update<MessageRecord>("messages", m.id, {
    ciphertext: enc.ciphertext,
    nonce: enc.nonce,
    envelopes: enc.envelopes,
    signature: enc.signature,
  });
  state.decrypted.set(rec.id, { ok: true, payload: { t: "text", body: body.trim() } });
  replaceMessage(rec);
}

export async function deleteMessage(m: MessageRecord): Promise<void> {
  await client.remove("messages", m.id);
  removeMessage(m);
}

function replaceMessage(rec: MessageRecord) {
  const list = state.messages.get(rec.chat) ?? [];
  state.messages.set(rec.chat, dedupe([...list.filter((x) => x.id !== rec.id), rec]));
  emit();
}

function removeMessage(m: { id: string; chat: string }) {
  state.messages.set(m.chat, (state.messages.get(m.chat) ?? []).filter((x) => x.id !== m.id));
  state.decrypted.delete(m.id);
  emit();
}

let lastTypingSent = 0;
export function sendTyping(chatId: string) {
  if (!state.prefs.typing || Date.now() - lastTypingSent < 3000) return;
  lastTypingSent = Date.now();
  void client.request("POST", "/api/lexichat/typing", { chat: chatId }).catch(() => {});
}

export async function updatePrefs(p: Partial<Prefs>): Promise<void> {
  state.prefs = { ...DEFAULT_PREFS, ...(await client.request<Partial<Prefs>>("POST", "/api/lexichat/me/prefs", p)) };
  emit();
  void loadPresence();
}

export async function updateLocal(p: Partial<LocalState["local"]>): Promise<void> {
  state.local.local = { ...state.local.local, ...p };
  await saveLocal();
  emit();
}

export async function updateProfile(data: { name?: string; avatar?: File | null }): Promise<void> {
  const form = new FormData();
  if (data.name !== undefined) form.append("name", data.name);
  if (data.avatar === null) form.append("avatar", "");
  else if (data.avatar) form.append("avatar", data.avatar);
  const me = await client.request<UserRecord>("PATCH", `/api/collections/users/records/${state.me!.id}`, form);
  state.me = { ...state.me!, ...me };
  emit();
  await loadDirectory();
}

// ------------------------------------------------------------------ broadcasts

export interface BroadcastPlan {
  stamp: string;
  recipients: { id: string; name: string; publicEncKey: string; publicSignKey: string }[];
  withoutKeys: number;
}

export async function planBroadcast(): Promise<BroadcastPlan> {
  return client.request<BroadcastPlan>("GET", "/api/lexichat/broadcasts/recipients");
}

export async function sendBroadcast(plan: BroadcastPlan, body: string): Promise<{ id: string; recipients: number }> {
  const me = state.me!;
  const id = state.identity;
  if (!id) throw new Error("Die App ist gesperrt.");
  const messages = [];
  for (const r of plan.recipients) {
    const enc = await encryptMessage({
      payload: { t: "text", body: body.trim(), ts: Date.now() },
      context: broadcastContext(r.id),
      senderId: me.id,
      senderSignPrivate: id.signPrivate,
      recipients: [
        { id: me.id, encPublic: id.encPublic },
        { id: r.id, encPublic: await fromB64(r.publicEncKey) },
      ],
    });
    messages.push({ recipient: r.id, ...enc });
  }
  const res = await client.request<{ id: string; recipients: number }>("POST", "/api/lexichat/broadcasts", { stamp: plan.stamp, messages });
  await loadChats();
  return res;
}

export interface BroadcastInfo {
  id: string;
  created: string;
  recipient_count: number;
}

export async function listBroadcasts(): Promise<BroadcastInfo[]> {
  const res = await client.list<BroadcastInfo>("broadcasts", { perPage: 100, sort: "-created" });
  return res.items;
}

export async function broadcastStatus(id: string): Promise<{ recipients: number; delivered: number; read: number }> {
  return client.request("GET", `/api/lexichat/broadcasts/${id}/status`);
}

/** Decrypted text of an own broadcast (from any of its per-recipient copies). */
export async function broadcastText(id: string): Promise<string> {
  const res = await client.list<MessageRecord>("messages", { perPage: 1, filter: `broadcast = ${filterString(id)}` });
  const m = res.items[0];
  if (!m) return "";
  if (!state.chats.some((c) => c.id === m.chat)) await loadChats();
  await decryptAll([m]);
  const d = state.decrypted.get(m.id);
  return d?.ok ? d.payload.body : "";
}

// ------------------------------------------------------------------ realtime

async function onRealtime(topic: string, data: unknown) {
  if (topic === "lexichat/typing") {
    const t = data as { chat: string; user: string };
    state.typing.set(t.chat, { user: t.user, until: Date.now() + 5000 });
    emit();
    window.setTimeout(emit, 5100);
    return;
  }
  const ev = data as { action: "create" | "update" | "delete"; record: Record<string, unknown> };
  switch (topic) {
    case "messages": {
      const m = ev.record as unknown as MessageRecord;
      if (ev.action === "delete") {
        removeMessage(m);
        return;
      }
      if (!state.chats.some((c) => c.id === m.chat)) await loadChats();
      // realtime echo of an own message can arrive before the http response
      state.outbox = state.outbox.filter((o) => !o.nonce || o.nonce !== m.nonce);
      state.decrypted.delete(m.id);
      replaceMessage(m);
      await decryptAll([m]);
      if (ev.action === "create" && m.sender !== state.me?.id) {
        await acknowledgeDelivery([m]);
        if (state.activeChat === m.chat && state.windowFocused) markRead(m.chat);
        else void notifyIncoming(m);
      }
      bumpChat(m.chat, m.created);
      return;
    }
    case "chats": {
      if (ev.action === "delete") {
        state.chats = state.chats.filter((c) => c.id !== ev.record["id"]);
        emit();
      } else {
        const c = ev.record as unknown as Chat;
        state.chats = [c, ...state.chats.filter((x) => x.id !== c.id)].sort((a, b) =>
          (b.last_message_at || b.created).localeCompare(a.last_message_at || a.created),
        );
        emit();
      }
      return;
    }
    case "receipts": {
      upsertReceipt(ev.record as unknown as Receipt);
      emit();
      return;
    }
    case "users": {
      // key change or deactivation of a colleague -> reload the directory
      void loadDirectory();
      return;
    }
  }
}

function bumpChat(chatId: string, at: string) {
  state.chats = state.chats
    .map((c) => (c.id === chatId ? { ...c, last_message_at: at } : c))
    .sort((a, b) => (b.last_message_at || b.created).localeCompare(a.last_message_at || a.created));
  emit();
}

async function notifyIncoming(m: MessageRecord) {
  const mode = state.prefs.notificationContent;
  const sender = state.contacts.get(m.sender)?.name ?? "Unbekannt";
  const d = state.decrypted.get(m.id);
  const n = notificationText(mode, sender, d?.ok ? d.payload.body : null);
  await notify(n.title, n.body);
}

// ------------------------------------------------------------------ avatars (protected files)

let fileToken: { token: string; at: number } | null = null;

export async function avatarUrl(userId: string, file: string): Promise<string | null> {
  if (!file) return null;
  if (!fileToken || Date.now() - fileToken.at > 120_000) {
    fileToken = { token: await client.fileToken(), at: Date.now() };
  }
  return `${client.baseUrl}/api/files/users/${encodeURIComponent(userId)}/${encodeURIComponent(file)}?thumb=96x96&token=${encodeURIComponent(fileToken.token)}`;
}
