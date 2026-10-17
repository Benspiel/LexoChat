import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { safetyNumber, fromB64, MAX_BODY_CHARS } from "@lexichat/crypto";
import { Avatar, Badge, Button, Dialog, EmptyState, Icon, Notice, Segmented, Spinner, TextField, Toggle } from "@lexichat/ui";
import {
  acknowledgeKeyChange,
  avatarUrl,
  broadcastStatus,
  broadcastText,
  chatHasUnread,
  deleteMessage,
  discard,
  editMessage,
  findOrCreateChat,
  getState,
  isVerified,
  keyChanged,
  listBroadcasts,
  loadMessages,
  openChat,
  otherMember,
  planBroadcast,
  retry,
  sendBroadcast,
  sendMessage,
  sendTyping,
  setVerified,
  unreadCount,
  useStore,
  type BroadcastInfo,
  type BroadcastPlan,
  type Chat,
  type Contact,
  type MessageRecord,
} from "../lib/store";
import { SettingsDialog, type SettingsSection } from "./Settings";

const timeFmt = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

function pbDate(v: string): Date {
  return new Date(v.replace(" ", "T"));
}

function shortTime(v: string): string {
  if (!v) return "";
  const d = pbDate(v);
  return d.toDateString() === new Date().toDateString() ? timeFmt.format(d) : dayFmt.format(d);
}

function useAvatar(c?: { id: string; avatar: string } | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (c?.avatar) void avatarUrl(c.id, c.avatar).then((u) => alive && setUrl(u)).catch(() => {});
    else setUrl(null);
    return () => {
      alive = false;
    };
  }, [c?.id, c?.avatar]);
  return url;
}

function PersonAvatar({ contact, size = 36 }: { contact?: Contact | null; size?: number }) {
  const url = useAvatar(contact);
  const online = useStore((s) => (contact ? s.online.has(contact.id) : false));
  return (
    <span className="avatar-wrap">
      <Avatar name={contact?.name ?? "?"} src={url} size={size} />
      {online && <span className="presence-dot" aria-hidden="true" />}
    </span>
  );
}

// ======================================================================== layout

export function Main({ onLock, onLogout }: { onLock: () => void; onLogout: () => void }) {
  const [newChat, setNewChat] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [mode, setMode] = useState<"chats" | "broadcasts">("chats");
  const activeChat = useStore((s) => s.activeChat);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setNewChat(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        onLock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLock]);

  return (
    <div className="shell">
      <Sidebar mode={mode} onMode={setMode} onNewChat={() => setNewChat(true)} onSettings={setSettings} onLock={onLock} onLogout={onLogout} />
      <main className="main" aria-label="Unterhaltung">
        {mode === "broadcasts" ? <BroadcastsPanel /> : activeChat ? <Conversation chatId={activeChat} key={activeChat} /> : <NoChat onNewChat={() => setNewChat(true)} />}
      </main>
      <NewChatDialog
        open={newChat}
        onClose={() => setNewChat(false)}
        onPick={async (id) => {
          setNewChat(false);
          setMode("chats");
          openChat(await findOrCreateChat(id));
        }}
      />
      {settings && <SettingsDialog section={settings} onSection={setSettings} onClose={() => setSettings(null)} onLock={onLock} onLogout={onLogout} />}
    </div>
  );
}

function NoChat({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="main-empty">
      <EmptyState title="Wählen Sie einen Chat." action={<Button onClick={onNewChat}>Neuer Chat</Button>}>
        Oder starten Sie einen neuen Chat mit einer Kollegin oder einem Kollegen (Strg+K).
      </EmptyState>
    </div>
  );
}

// ======================================================================== sidebar

function Sidebar({
  mode,
  onMode,
  onNewChat,
  onSettings,
  onLock,
  onLogout,
}: {
  mode: "chats" | "broadcasts";
  onMode: (m: "chats" | "broadcasts") => void;
  onNewChat: () => void;
  onSettings: (s: SettingsSection) => void;
  onLock: () => void;
  onLogout: () => void;
}) {
  const me = useStore((s) => s.me);
  const contacts = useStore((s) => s.contacts);
  const chats = useStore((s) => s.chats);
  const connection = useStore((s) => s.connection);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const meContact = me ? contacts.get(me.id) : null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats.filter((c) => {
      if (!q) return true;
      const other = contacts.get(otherMember(c));
      return !!other && (other.name.toLowerCase().includes(q) || other.username.includes(q));
    });
  }, [chats, contacts, query]);

  return (
    <aside className="sidebar" aria-label="Chats">
      <div className="sidebar-top">
        <div className="lx-row">
          <TextField className="lx-grow" label="Chats durchsuchen" hideLabel placeholder="Suchen …" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button onClick={onNewChat} aria-keyshortcuts="Control+K">
            Neuer Chat
          </Button>
        </div>
        <Segmented
          label="Ansicht"
          value={mode}
          onChange={onMode}
          options={[
            { value: "chats", label: "Chats" },
            { value: "broadcasts", label: "Broadcasts" },
          ]}
        />
        {connection !== "online" && (
          <p className="lx-small lx-muted-strong" role="status">
            <Icon name="info" /> {connection === "connecting" ? "Verbinde …" : "Offline – Nachrichten werden gesendet, sobald die Verbindung besteht."}
          </p>
        )}
      </div>

      {mode === "chats" && (
        <nav className="chat-list" aria-label="Chatliste">
          {visible.length === 0 ? (
            <p className="lx-small lx-muted-strong" style={{ padding: 16 }}>
              {chats.length === 0 ? "Noch keine Chats." : "Kein Treffer."}
            </p>
          ) : (
            <ul>
              {visible.map((c) => (
                <ChatRow key={c.id} chat={c} />
              ))}
            </ul>
          )}
        </nav>
      )}
      {mode === "broadcasts" && <div className="chat-list" />}

      <div className="sidebar-bottom">
        <button type="button" className="me-button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          <PersonAvatar contact={meContact} size={32} />
          <span className="lx-grow" style={{ textAlign: "left" }}>
            <span className="row-name">{me?.name}</span>
            <span className="lx-caption lx-muted-strong">{me?.username}</span>
          </span>
          <Icon name="more" size={20} label="Menü" />
        </button>
        {menu && (
          <ul className="me-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
            {(
              [
                ["profile", "Profil und Avatar"],
                ["password", "Passwort ändern"],
                ["security", "Sicherheit und Geräte"],
                ["privacy", "Benachrichtigungen und Privatsphäre"],
                ["app", "App und Daten"],
              ] as [SettingsSection, string][]
            ).map(([id, label]) => (
              <li key={id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onSettings(id);
                  }}
                >
                  {label}
                </button>
              </li>
            ))}
            <li role="none">
              <button type="button" role="menuitem" onClick={() => (setMenu(false), onLock())}>
                Sperren (Strg+L)
              </button>
            </li>
            <li role="none">
              <button type="button" role="menuitem" onClick={() => (setMenu(false), onLogout())}>
                Abmelden
              </button>
            </li>
          </ul>
        )}
      </div>
    </aside>
  );
}

function ChatRow({ chat }: { chat: Chat }) {
  const active = useStore((s) => s.activeChat === chat.id);
  const other = useStore((s) => s.contacts.get(otherMember(chat)));
  const preview = useStore((s) => {
    if (!s.prefs.listPreview) return "";
    const msgs = s.messages.get(chat.id) ?? [];
    const last = msgs[msgs.length - 1];
    const d = last ? s.decrypted.get(last.id) : undefined;
    return d?.ok ? d.payload.body : "";
  });
  useStore((s) => s.local.lastRead[chat.id]);
  const unread = unreadCount(chat.id);
  const hasUnread = chatHasUnread(chat);
  const name = other?.name ?? "Unbekannt";
  return (
    <li>
      <button type="button" className="chat-row" aria-current={active ? "true" : undefined} onClick={() => openChat(chat.id)}>
        <PersonAvatar contact={other} />
        <span className="chat-row__text">
          <span className="lx-spread" style={{ gap: 8, flexWrap: "nowrap" }}>
            <span className="row-name">{name}</span>
            <span className="lx-caption lx-muted-strong">{shortTime(chat.last_message_at || chat.created)}</span>
          </span>
          <span className="lx-spread" style={{ gap: 8, flexWrap: "nowrap" }}>
            <span className="lx-small lx-muted-strong row-preview">{other && !other.active ? "Deaktiviert" : preview}</span>
            {hasUnread && (
              <span className="lx-badge lx-badge--count" aria-label={`${unread || 1} ungelesen`}>
                {unread || 1}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

// ======================================================================== conversation

function Conversation({ chatId }: { chatId: string }) {
  const chat = useStore((s) => s.chats.find((c) => c.id === chatId));
  const otherId = chat ? otherMember(chat) : "";
  const other = useStore((s) => s.contacts.get(otherId));
  const messages = useStore((s) => s.messages.get(chatId));
  const outbox = useStore((s) => s.outbox.filter((o) => o.chat === chatId));
  const hasMore = useStore((s) => s.hasMore.get(chatId) ?? false);
  const typing = useStore((s) => {
    const t = s.typing.get(chatId);
    return t && t.until > Date.now() && t.user === otherId;
  });
  const changed = useStore(() => keyChanged(otherId));
  const verified = useStore(() => isVerified(otherId));
  const [replyTo, setReplyTo] = useState<MessageRecord | null>(null);
  const [editing, setEditing] = useState<MessageRecord | null>(null);
  const [safety, setSafety] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages?.length, outbox.length]);

  if (!chat) return <Spinner />;
  const canSend = !!other?.active && !!other.publicEncKey;

  return (
    <section className="conversation" aria-labelledby="conv-title">
      <header className="conv-header">
        <PersonAvatar contact={other} size={40} />
        <div className="lx-grow">
          <h2 id="conv-title" className="conv-title">
            {other?.name ?? "Unbekannt"}
          </h2>
          <p className="lx-caption lx-muted-strong" aria-live="polite">
            {other && !other.active ? "Konto deaktiviert" : typing ? "schreibt …" : verified ? "Sicherheitsnummer bestätigt" : (other?.username ?? "")}
          </p>
        </div>
        {other?.publicEncKey && (
          <Button variant="soft" size="sm" onClick={() => setSafety(true)}>
            <Icon name="shield" /> Sicherheitsnummer
          </Button>
        )}
      </header>

      {changed && other && (
        <div className="conv-banner">
          <Notice kind="warning">
            Die Sicherheitsnummer von {other.name} hat sich geändert (z. B. neues Passwort ohne Wiederherstellungsschlüssel). Prüfen Sie
            die neue Nummer am besten persönlich, bevor Sie vertrauliche Inhalte senden.
            <div className="lx-row" style={{ marginTop: 8 }}>
              <Button size="sm" variant="outline" onClick={() => setSafety(true)}>
                Nummer prüfen
              </Button>
              <Button size="sm" onClick={() => void acknowledgeKeyChange(otherId)}>
                Änderung bestätigen
              </Button>
            </div>
          </Notice>
        </div>
      )}

      <div className="messages" ref={listRef} role="log" aria-label={`Nachrichten mit ${other?.name ?? "Unbekannt"}`} aria-live="polite">
        {hasMore && (
          <div style={{ textAlign: "center" }}>
            <Button variant="soft" size="sm" onClick={() => void loadMessages(chatId)}>
              Ältere Nachrichten laden
            </Button>
          </div>
        )}
        {messages === undefined && <Spinner />}
        {messages?.length === 0 && outbox.length === 0 && <p className="lx-small lx-muted-strong" style={{ textAlign: "center" }}>Noch keine Nachrichten. Schreiben Sie die erste.</p>}
        {messages?.map((m) => (
          <Bubble key={m.id} m={m} onReply={() => setReplyTo(m)} onEdit={() => setEditing(m)} />
        ))}
        {outbox.map((o) => (
          <div key={o.tempId} className="bubble-row mine">
            <div className="bubble mine">
              <p className="bubble-text">{o.body}</p>
              <span className="bubble-meta">
                {o.status === "sending" ? "Wird gesendet …" : ((o as { error?: string }).error ?? "Nicht gesendet")}
                {o.status === "failed" && (
                  <>
                    {" · "}
                    <button type="button" className="link-btn" onClick={() => retry(o.tempId)}>
                      Erneut senden
                    </button>
                    {" · "}
                    <button type="button" className="link-btn" onClick={() => discard(o.tempId)}>
                      Verwerfen
                    </button>
                  </>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      {canSend ? (
        <Composer
          chatId={chatId}
          replyTo={replyTo}
          editing={editing}
          onClearReply={() => setReplyTo(null)}
          onClearEdit={() => setEditing(null)}
          blocked={changed}
        />
      ) : (
        <div className="composer">
          <p className="lx-small lx-muted-strong">{other && !other.active ? "Diese Person ist deaktiviert. Sie können keine Nachrichten mehr senden." : "Diese Person hat LexiChat noch nicht eingerichtet."}</p>
        </div>
      )}

      {safety && other && <SafetyDialog contact={other} onClose={() => setSafety(false)} />}
    </section>
  );
}

function Bubble({ m, onReply, onEdit }: { m: MessageRecord; onReply: () => void; onEdit: () => void }) {
  const me = useStore((s) => s.me);
  const d = useStore((s) => s.decrypted.get(m.id));
  const receipts = useStore((s) => s.receipts.get(m.id));
  const replied = useStore((s) => (m.reply_to ? s.decrypted.get(m.reply_to) : undefined));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mine = m.sender === me?.id;
  const read = receipts?.some((r) => r.user !== me?.id && r.read_at);
  const delivered = receipts?.some((r) => r.user !== me?.id);

  return (
    <div className={`bubble-row${mine ? " mine" : ""}`}>
      <div className={`bubble${mine ? " mine" : ""}`}>
        {m.is_broadcast && (
          <span className="lx-badge lx-badge--accent" style={{ alignSelf: "flex-start" }}>
            Broadcast
          </span>
        )}
        {m.reply_to && (
          <blockquote className="bubble-quote">{replied?.ok ? replied.payload.body.slice(0, 140) : "Nachricht nicht mehr verfügbar"}</blockquote>
        )}
        {!d ? (
          <p className="bubble-text lx-muted-strong">Wird entschlüsselt …</p>
        ) : d.ok ? (
          <p className="bubble-text">{d.payload.body}</p>
        ) : (
          <p className="bubble-text">
            <Icon name="alert" /> {d.error}
          </p>
        )}
        <span className="bubble-meta">
          {shortTime(m.created)}
          {m.edited_at && " · bearbeitet"}
          {mine && (read ? " · gelesen" : delivered ? " · zugestellt" : " · gesendet")}
        </span>
        <span className="bubble-actions">
          <button type="button" className="link-btn" onClick={onReply}>
            Antworten
          </button>
          {mine && !m.is_broadcast && d?.ok && (
            <button type="button" className="link-btn" onClick={onEdit}>
              Bearbeiten
            </button>
          )}
          {mine && (
            <button type="button" className="link-btn" onClick={() => setConfirmDelete(true)}>
              Löschen
            </button>
          )}
        </span>
      </div>
      <Dialog
        open={confirmDelete}
        title="Nachricht für alle löschen?"
        onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={() => {
                setConfirmDelete(false);
                void deleteMessage(m);
              }}
            >
              Für alle löschen
            </Button>
          </>
        }
      >
        <p>Die Nachricht wird auf dem Server und bei allen Empfänger:innen gelöscht. Bereits gesehene Inhalte können nicht zurückgeholt werden.</p>
      </Dialog>
    </div>
  );
}

function Composer({
  chatId,
  replyTo,
  editing,
  onClearReply,
  onClearEdit,
  blocked,
}: {
  chatId: string;
  replyTo: MessageRecord | null;
  editing: MessageRecord | null;
  onClearReply: () => void;
  onClearEdit: () => void;
  blocked: boolean;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<BroadcastPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const settings = useStore((s) => s.settings);
  const me = useStore((s) => s.me);
  const replyText = useStore((s) => (replyTo ? s.decrypted.get(replyTo.id) : undefined));
  const ref = useRef<HTMLTextAreaElement>(null);
  const mayBroadcast = settings?.broadcast_permission !== "admins" || me?.role === "admin";

  useEffect(() => {
    if (editing) {
      const d = getState().decrypted.get(editing.id);
      setText(d?.ok ? d.payload.body : "");
      ref.current?.focus();
    }
  }, [editing]);
  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  async function submit() {
    const body = text.trim();
    if (!body || blocked) return;
    setError(null);
    try {
      if (editing) {
        await editMessage(editing, body);
        onClearEdit();
      } else {
        void sendMessage(chatId, body, replyTo?.id);
        onClearReply();
      }
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler.");
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      onClearReply();
      onClearEdit();
    } else {
      sendTyping(chatId);
    }
  }

  return (
    <div className="composer">
      {error && <Notice kind="error">{error}</Notice>}
      {(replyTo || editing) && (
        <div className="composer-context">
          <span className="lx-small">
            {editing ? "Nachricht bearbeiten" : `Antwort auf: ${replyText?.ok ? replyText.payload.body.slice(0, 80) : "Nachricht"}`}
          </span>
          <Button variant="ghost" size="sm" aria-label="Abbrechen" onClick={() => (onClearReply(), onClearEdit(), setText(""))}>
            <Icon name="x" />
          </Button>
        </div>
      )}
      <div className="composer-row">
        <label htmlFor={`composer-${chatId}`} className="lx-sr-only">
          Nachricht schreiben
        </label>
        <textarea
          id={`composer-${chatId}`}
          ref={ref}
          className="lx-input composer-input"
          rows={1}
          placeholder={blocked ? "Bitte zuerst die geänderte Sicherheitsnummer bestätigen." : "Nachricht schreiben … (Enter senden, Umschalt+Enter neue Zeile)"}
          value={text}
          maxLength={MAX_BODY_CHARS}
          disabled={blocked}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
        />
        <Button onClick={() => void submit()} disabled={!text.trim() || blocked}>
          {editing ? "Speichern" : "Senden"}
        </Button>
        {!editing && mayBroadcast && (
          <Button
            variant="outline"
            loading={busy}
            disabled={!text.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setPlan(await planBroadcast());
              } catch (err) {
                setError(err instanceof Error ? err.message : "Fehler.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Als Broadcast senden
          </Button>
        )}
      </div>
      <BroadcastConfirm
        plan={plan}
        text={text}
        onClose={() => setPlan(null)}
        onSent={() => {
          setPlan(null);
          setText("");
        }}
      />
    </div>
  );
}

function BroadcastConfirm({ plan, text, onClose, onSent }: { plan: BroadcastPlan | null; text: string; onClose: () => void; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [plan]);
  const n = plan?.recipients.length ?? 0;
  return (
    <Dialog
      open={plan !== null}
      title="Als Broadcast senden?"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            loading={busy}
            disabled={n === 0}
            onClick={async () => {
              if (!plan) return;
              setBusy(true);
              setError(null);
              try {
                await sendBroadcast(plan, text);
                onSent();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Fehler.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {n === 1 ? "An 1 Person senden" : `An ${n} Personen senden`}
          </Button>
        </>
      }
    >
      <div className="lx-stack">
        {error && <Notice kind="error">{error}</Notice>}
        <p>
          <strong>{n === 1 ? "Diese Nachricht geht an 1 Person" : `Diese Nachricht geht an alle ${n} Personen`}</strong> in LexiChat. Jede Person erhält sie in ihrem Chat mit Ihnen und kann
          nur Ihnen privat antworten.
        </p>
        {plan && plan.withoutKeys > 0 && (
          <Notice kind="info">
            {plan.withoutKeys === 1
              ? "1 Person hat die App noch nicht eingerichtet und erhält diesen Broadcast nicht."
              : `${plan.withoutKeys} Personen haben die App noch nicht eingerichtet und erhalten diesen Broadcast nicht.`}
          </Notice>
        )}
        <blockquote className="bubble-quote">{text.slice(0, 300)}</blockquote>
      </div>
    </Dialog>
  );
}

// ======================================================================== broadcasts overview

function BroadcastsPanel() {
  const [items, setItems] = useState<(BroadcastInfo & { text?: string; status?: { recipients: number; delivered: number; read: number } })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readReceiptsEnabled = useStore((s) => s.prefs.readReceipts);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await listBroadcasts();
        const full = await Promise.all(list.map(async (b) => ({ ...b, text: await broadcastText(b.id), status: await broadcastStatus(b.id) })));
        if (alive) setItems(full);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Fehler.");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="broadcasts" aria-labelledby="bc-title">
      <div className="lx-stack-sm" style={{ marginBottom: 24 }}>
        <h1 id="bc-title">Meine Broadcasts.</h1>
        <p className="lx-muted">Nachrichten an alle. Neue Broadcasts senden Sie in einem beliebigen Chat über „Als Broadcast senden“.</p>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {items === null && !error ? (
        <Spinner />
      ) : items && items.length === 0 ? (
        <EmptyState title="Noch keine Broadcasts." />
      ) : (
        <ul className="lx-stack">
          {items?.map((b) => (
            <li key={b.id} className="lx-card">
              <div className="lx-stack-sm">
                <div className="lx-spread">
                  <Badge variant="accent">Broadcast</Badge>
                  <span className="lx-caption lx-muted">{shortTime(b.created)}</span>
                </div>
                <p>{b.text || <span className="lx-muted">(Inhalt nicht verfügbar)</span>}</p>
                {b.status && (
                  <p className="lx-small lx-muted">
                    {b.status.delivered} von {b.status.recipients} zugestellt
                    {readReceiptsEnabled ? ` · ${b.status.read} gelesen (nur Personen mit Lesebestätigung)` : ""}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ======================================================================== dialogs

function NewChatDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (userId: string) => void }) {
  const me = useStore((s) => s.me);
  const contacts = useStore((s) => s.contacts);
  const [q, setQ] = useState("");
  useEffect(() => setQ(""), [open]);
  const list = [...contacts.values()].filter(
    (c) => c.active && c.id !== me?.id && (!q || c.name.toLowerCase().includes(q.toLowerCase()) || c.username.includes(q.toLowerCase())),
  );
  return (
    <Dialog open={open} title="Neuer Chat." onClose={onClose}>
      <div className="lx-stack">
        <TextField label="Person suchen" placeholder="Name oder Benutzername" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <ul className="pick-list" aria-label="Kolleginnen und Kollegen">
          {list.length === 0 && <li className="lx-small lx-muted">Niemand gefunden.</li>}
          {list.map((c) => (
            <li key={c.id}>
              <button type="button" className="chat-row" disabled={!c.publicEncKey} onClick={() => onPick(c.id)}>
                <PersonAvatar contact={c} />
                <span className="chat-row__text">
                  <span className="row-name">{c.name}</span>
                  <span className="lx-caption lx-muted-strong">{c.publicEncKey ? c.username : "hat LexiChat noch nicht eingerichtet"}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

function SafetyDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const identity = useStore((s) => s.identity);
  const verified = useStore(() => isVerified(contact.id));
  const [number, setNumber] = useState<string>("");
  useEffect(() => {
    void (async () => {
      if (!identity || !contact.publicEncKey) return;
      setNumber(
        await safetyNumber(
          { encPublic: identity.encPublic, signPublic: identity.signPublic },
          { encPublic: await fromB64(contact.publicEncKey), signPublic: await fromB64(contact.publicSignKey) },
        ),
      );
    })();
  }, [identity, contact]);
  return (
    <Dialog open title={`Sicherheitsnummer mit ${contact.name}.`} onClose={onClose}>
      <div className="lx-stack">
        <p>
          Vergleichen Sie diese Nummer persönlich oder am Telefon mit {contact.name}. Stimmt sie auf beiden Geräten überein, ist die
          Verschlüsselung nicht manipuliert.
        </p>
        <div className="safety-number lx-mono" data-testid="safety-number">
          {number.split(" ").map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </div>
        <Toggle checked={verified} onChange={(v) => void setVerified(contact.id, v)} label="Als bestätigt markieren" description="Wird nur auf diesem Gerät gespeichert." />
      </div>
    </Dialog>
  );
}
