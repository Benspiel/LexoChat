# LexiChat – Rechtekonzept (API-Rules)

> Stand: Phase 1. Quelle der Wahrheit ist die Migration `apps/server/migrations/1760700000_lexichat_init.go`; die Tests stehen in `apps/server/internal/lexichat/rules_test.go`.

## Grundsätze

- **Default deny:** `null` = nur PocketBase-Superuser (Notfallzugang per SSH-Tunnel). Leere Regel (`""`) wird **nirgends** verwendet.
- **Drei Schichten:** (1) PocketBase-API-Rules (deklarativ), (2) Go-Hooks mit Feld-Allow-Listen und Plausibilitätsprüfungen, (3) Modell-Hooks für Invarianten, die auch für Superuser und CLI gelten (letzter Admin, Deaktivierung, Audit-Log append-only).
- **Superuser** (PocketBase-Dashboard) umgehen API-Rules. Zugang nur über SSH-Tunnel + IP-Allowlist, gehört zum Notfallkonzept, nicht zum Alltag.

### Regelbausteine

```text
ACTIVE = @request.auth.collectionName = "users"
         && @request.auth.active = true
         && @request.auth.must_change_password = false

ADMIN  = ACTIVE && @request.auth.role = "admin"
```

Zusätzlich (nicht als Rule ausdrückbar, per Middleware): jede authentifizierte Anfrage braucht eine gültige, eigene Sitzung (`X-LexiChat-Session`), sonst `401`.

## Rollen

| Rolle | Darf | Darf nicht |
|---|---|---|
| `user` | Eigene Chats/Nachrichten lesen und schreiben, Verzeichnis aktiver Kolleg:innen sehen (Name, Avatar, öffentliche Schlüssel), eigenen Anzeigenamen/Avatar ändern, eigenes Passwort ändern, eigene Sitzungen sehen/beenden | Rolle/Status/Benutzernamen ändern, fremde Daten sehen, Konten anlegen, Audit-Log lesen, Einstellungen ändern |
| `admin` | Alles wie `user` + Konten anlegen, bearbeiten (Name, Benutzername, Rolle, aktiv), Passwort zurücksetzen (Einmalpasswort), Konten löschen, alle Sitzungen sehen/beenden, Audit-Log lesen, Einstellungen ändern | **Chatinhalte lesen** (technisch unmöglich, E2EE), öffentliche/private Schlüssel anderer setzen, sich selbst herabstufen/deaktivieren/löschen, den letzten aktiven Admin entfernen |
| Superuser | Notfall: Datenbank-Dashboard | wird im Alltag nicht genutzt; Chatinhalte sind auch für Superuser nur Ciphertext |

## Collections

### `users` (Auth-Collection)

| Aktion | Regel | Zusätzliche Prüfungen (Hooks) |
|---|---|---|
| list | `ACTIVE && (active = true \|\| id = @request.auth.id \|\| @request.auth.role = "admin")` | Nicht-Admins sehen bei Fremden **nicht**: `role`, `must_change_password`, `email`, `created`, `updated`. Hidden-Felder (Schlüsselmaterial, KDF, Sperrzähler) sind für niemanden außer Superuser sichtbar **und nicht filterbar** (getestet). |
| view | `@request.auth.collectionName = "users" && (id = @request.auth.id \|\| (ACTIVE && (active = true \|\| @request.auth.role = "admin")))` | wie oben; eigener Datensatz auch bei `must_change_password` |
| create | `null` | Konten nur über `POST /api/lexichat/admin/users` (ADMIN) oder CLI `bootstrap-admin` |
| update | `(id = @request.auth.id && ACTIVE && @request.body.role:isset = false && @request.body.active:isset = false && @request.body.username:isset = false && @request.body.must_change_password:isset = false) \|\| (ADMIN)` | Feld-Allow-List: selbst `name`, `avatar`; Admin `name`, `avatar`, `username`, `role`, `active`. Passwort, E-Mail, Schlüssel, KDF nie über die Record-API. Keine Selbst-Herabstufung/-Deaktivierung. Deaktivierung ⇒ `tokenKey` neu + alle Sitzungen gelöscht. |
| delete | `ADMIN` | nicht sich selbst; nicht den letzten aktiven Admin; löscht die 1:1-Chats der Person (inkl. Nachrichten) |
| auth | `active = true` | Kontosperre/Backoff, Admin-Web nur für Admins, Sitzung wird angelegt |
| manage | `null` | – |

### `lx_settings`

| Aktion | Regel | Hooks |
|---|---|---|
| list / view | `ACTIVE` | – |
| create | `null` | genau ein Datensatz (`globalsettings1`), per Migration angelegt |
| update | `ADMIN` | Feldgrenzen im Schema (z. B. Aufbewahrung 1–3650 Tage); Audit-Eintrag mit geänderten Werten |
| delete | `null` | – |

### `sessions`

| Aktion | Regel |
|---|---|
| list / view | `@request.auth.collectionName = "users" && (user = @request.auth.id \|\| (ADMIN))` |
| create / update | `null` (nur der Server beim Login) |
| delete | wie list (= „Sitzung beenden“ / Abmelden; trennt Realtime-Verbindungen, Audit-Eintrag) |

### `chats`

| Aktion | Regel | Hooks |
|---|---|---|
| list / view | `ACTIVE && members.id ?= @request.auth.id` | – |
| create | `ACTIVE` | genau 2 verschiedene Mitglieder inkl. Ersteller:in; Gegenüber aktiv und mit Schlüsseln; kein Duplikat (`409` mit Chat-ID); `type`/`member_key`/`last_message_at` setzt der Server |
| update / delete | `null` | Löschung nur über Kontolöschung/Aufbewahrung |

### `messages`

| Aktion | Regel | Hooks |
|---|---|---|
| list / view | `ACTIVE && chat.members.id ?= @request.auth.id` | – |
| create | `ACTIVE && @request.body.sender = @request.auth.id && @request.body.chat.members.id ?= @request.auth.id` | Feld-Allow-List (`chat, sender, v, ciphertext, nonce, envelopes, signature, reply_to`); genau ein gültiger Envelope je Chat-Mitglied; `reply_to` im selben Chat; Empfänger aktiv; `is_broadcast=false`, `expires_at` = jetzt + Aufbewahrung (Server) |
| update | `ACTIVE && sender = @request.auth.id && chat.members.id ?= @request.auth.id` | nur `ciphertext, nonce, envelopes, signature`; `edited_at` setzt der Server; Broadcasts nicht editierbar |
| delete | wie update | echtes Löschen (inkl. Lesebestätigungen) |

### `broadcasts`

| Aktion | Regel |
|---|---|
| list / view | `ACTIVE && sender = @request.auth.id` |
| create / update / delete | `null` (Erzeugung in Phase 4 ausschließlich über `POST /api/lexichat/broadcasts`) |

### `receipts`

| Aktion | Regel | Hooks |
|---|---|---|
| list / view | `ACTIVE && (user = @request.auth.id \|\| message.sender = @request.auth.id)` | – |
| create | `ACTIVE && @request.body.user = @request.auth.id` | Mitglied des Chats, nicht die eigene Nachricht; Zeitstempel setzt der Server |
| update | `ACTIVE && user = @request.auth.id` | nur `read_at`, nur einmal setzbar, nie entfernbar |
| delete | `null` | – (Löschung mit der Nachricht) |

### `audit_logs`

| Aktion | Regel | Hooks |
|---|---|---|
| list / view | `ADMIN` | – |
| create / update / delete | `null` | Modell-Hooks verbieten Update/Delete auch intern und für Superuser; nur der Aufbewahrungs-Job löscht per SQL |

## Eigene Endpunkte

| Endpunkt | Zugriff | Zweck |
|---|---|---|
| `GET /api/lexichat/prelogin?username=` | öffentlich (rate-limitiert) | Salt + KDF-Parameter; Schein-Salt für unbekannte Namen |
| `GET /api/lexichat/me/keys` | angemeldet (auch bei Passwortwechsel-Pflicht) | eigene öffentliche + verpackte private Schlüssel |
| `POST /api/lexichat/me/keys/recovery` | ACTIVE | Wiederherstellungs-Blob setzen |
| `POST /api/lexichat/me/password` | angemeldet | atomarer Passwort- und Schlüsselwechsel; altes Passwort nötig (Fehlversuche zählen zur Sperre) |
| `POST /api/lexichat/admin/users` | ADMIN | Konto anlegen, Einmalpasswort einmalig zurückgeben |
| `POST /api/lexichat/admin/users/{id}/reset-password` | ADMIN | Einmalpasswort, Sitzungen beenden, Sperre aufheben (nicht für sich selbst) |

## Automatisierte Negativtests (Auszug, alle grün)

- Gast/Nutzer kann keine Konten anlegen (Record-API, Admin-Endpunkt, Registrierung).
- Nutzer kann Rolle, Status, Benutzernamen, Schlüssel, Passwort, E-Mail des eigenen Kontos nicht ändern; Hidden-Felder bleiben unverändert.
- Nutzer kann fremde Konten weder ändern noch löschen; Admin kann keine fremden Schlüssel setzen.
- Fremde Chats/Nachrichten/Lesebestätigungen sind weder lesbar noch beschreibbar; Absender-Fälschung, Envelopes für Fremde, gefälschte Broadcast-Flags und serverseitige Felder werden abgewiesen.
- Audit-Log: für Nutzer unsichtbar, für alle unveränderbar, Manipulation in der DB wird von `verify-audit` erkannt.
- Deaktivierung, Admin-Reset und Abmelden machen Token/Sitzung sofort ungültig; Realtime-Verbindungen werden getrennt.
- Letzter Admin kann nicht herabgestuft oder gelöscht werden (auch nicht auf Modellebene).
