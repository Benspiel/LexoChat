# LexiChat – Architektur

> Stand: Phase 6 (alle Phasen umgesetzt, Abnahme siehe [Security-Review](04-security-review.md)).

## 0. Annahmen (bitte prüfen)

Diese Annahmen wurden getroffen, weil sie im Auftrag nicht festgelegt waren. Jede davon kann geändert werden.

| # | Annahme | Auswirkung, falls falsch |
|---|---|---|
| A1 | Eine Praxis, **5–50 Nutzende**, eine Instanz pro Praxis (kein Mandantenbetrieb). | Bei deutlich mehr Nutzenden: Broadcast-Verschlüsselung pro Empfänger und SQLite neu bewerten. |
| A2 | Hosting auf einem **Linux-Server (VM) mit Docker** bei einem Anbieter in Deutschland/EU, mit öffentlicher Domain und Let's-Encrypt-Zertifikat. | Bei reinem LAN-Betrieb ohne öffentliche Domain: interne CA oder DNS-Challenge nötig (Caddy-Konfiguration anpassen). |
| A3 | **Admins dürfen auch in der Windows-App chatten** (laut Auftrag). | – |
| A4 | Arbeitsplätze sind **Windows 10/11** mit WebView2 (für Tauri v2). | – |
| A5 | Chat-Nachrichten sind **keine Patientendokumentation** (§ 630f BGB). Dokumentationspflichtige Inhalte werden in das Praxisverwaltungssystem (PVS) übertragen. Daher ist automatische Löschung (Standard 90 Tage) zulässig. | Falls die Praxis Chats als Dokumentation nutzen will: Löschkonzept und Aufbewahrungsfristen müssen neu bewertet werden (rechtlich prüfen lassen). |
| A6 | Keine E-Mail-Zustellung (kein SMTP). Passwort-Resets laufen ausschließlich über Admins. | – |
| A7 | `/design/DESIGN.md` (Mobbin-Analyse) liegt seit Phase 3 im Repository; das Design-System wurde daran angeglichen (siehe [03-design-system.md](03-design-system.md)). | – |

## 1. Überblick

```
 Windows-App (Tauri v2)        Admin-Web-App (statisch)
 ┌───────────────────────┐     ┌──────────────────────┐
 │ React-UI + libsodium  │     │ React-UI + libsodium │
 │ E2EE, lokaler Cache   │     │ nur Benutzerverwaltung│
 └──────────┬────────────┘     └──────────┬───────────┘
            │ HTTPS (TLS 1.3)             │ HTTPS (TLS 1.3, same-origin)
            ▼                             ▼
 ┌──────────────────────────────────────────────────────┐
 │ Caddy (Reverse Proxy): TLS, HSTS, CSP, Rate-Limits,   │
 │ sperrt /_/ und alle Superuser-APIs                   │
 └──────────────────────────┬───────────────────────────┘
                            │ HTTP (internes Docker-Netz)
 ┌──────────────────────────▼───────────────────────────┐
 │ LexiChat-Server = PocketBase v0.40.5 als Go-Bibliothek│
 │ + Hooks/Endpunkte (internal/lexichat)                 │
 │ SQLite (pb_data, verschlüsseltes Volume)              │
 └──────────────────────────────────────────────────────┘
```

### Warum PocketBase als Go-Bibliothek (statt Binary + JS-Hooks)?
- Alle Sicherheitsregeln (Hooks, Migrationen, Endpunkte) sind **typisiert, kompiliert und automatisiert getestet** (`go test`), inkl. Tests gegen echte PocketBase-Instanzen.
- Ein einziges, statisch gelinktes Binary (`CGO_ENABLED=0`) im Distroless-Container ohne Shell.
- PocketBase-Version ist in `go.mod` gepinnt (v0.40.5, Go 1.27.2). Die PocketBase-API wurde im Quellcode dieser Version geprüft, nicht aus dem Gedächtnis übernommen.

### Monorepo

| Pfad | Inhalt | Phase |
|---|---|---|
| `apps/server` | PocketBase + LexiChat-Erweiterungen (Go) | 1 ✅ |
| `apps/admin-web` | Admin-Web-App (React + Vite) | 2 ✅ |
| `apps/desktop` | Windows-App (Tauri v2 + React) | 3 ✅ |
| `packages/ui` | Design-System (Tokens, Komponenten), siehe [03-design-system.md](03-design-system.md) | 2 ✅ |
| `packages/crypto` | Client-Krypto (libsodium): KDF, Schlüssel, Nachrichtenformat v1, Sicherheitsnummern | 2/3 ✅ |
| `packages/shared` | API-Client, Passwort-Policy, Audit-Texte | 2 ✅ |
| `deploy` | Docker Compose, Caddy, Skripte | 1 ✅ |
| `docs` | Architektur, Bedrohungsmodell, Rechtekonzept, Datenschutz | fortlaufend |

### Technologie-Entscheidung Desktop: Tauri v2
Beibehalten wie vorgegeben. Gründe: kleine Angriffsfläche (kein Node.js im Renderer, Capability-System), Zugriff auf Windows Credential Manager (DPAPI), Toasts, Tray, Autostart, `SetWindowDisplayAffinity`; signierte Updates über das eigene Update-Plugin. Electron bietet hier keinen Sicherheitsvorteil, .NET/WinUI würde ein zweites UI-Kit neben der Web-App bedeuten.

## 2. Authentifizierung

### 2.1 Passwort → zwei getrennte Schlüssel (KDF v1)
Der Server sieht **nie** das Klartext-Passwort. Der Client leitet ab:

```
master  = Argon2id(passwort, salt, ops=3, mem=64 MiB, p=1, 32 Byte)   (libsodium crypto_pwhash ALG_ARGON2ID13)
authKey = BLAKE2b-256(key=master, "lexichat:auth:v1")                 → wird als "password" an PocketBase gesendet (hex, 64 Zeichen)
kek     = BLAKE2b-256(key=master, "lexichat:kek:v1")                  → verpackt die privaten Schlüssel, verlässt nie das Gerät
```

- PocketBase speichert nur `bcrypt(authKey)`. Wer den Server/die Datenbank kontrolliert, kennt weder Passwort noch `kek` und kann die privaten Schlüssel nicht entpacken. Ein Offline-Angriff auf ein gestohlenes DB-Backup muss pro Rateversuch Argon2id (64 MiB) rechnen.
- Das Passwortfeld in PocketBase akzeptiert **nur** 64 Hex-Zeichen (`^[0-9a-f]{64}$`) – ein fehlerhafter Client, der das Klartext-Passwort sendet, wird abgewiesen (getestet).
- Salt und Parameter liefert `GET /api/lexichat/prelogin?username=…`. Für unbekannte Benutzernamen wird ein **deterministischer Schein-Salt** (HMAC mit Server-Secret) geliefert → keine Benutzer-Enumeration über diesen Endpunkt.
- Die Go-Implementierung (`apps/server/internal/lxkdf`) ist per Testvektor **byte-genau gegen libsodium** (`libsodium-wrappers-sumo`) geprüft. Zusätzlich wurde ein kompletter Ende-zu-Ende-Durchlauf (JS-Client ↔ Server: Prelogin, Login mit Einmalpasswort, Passwortwechsel mit Schlüsselerzeugung, Re-Login, Entschlüsseln des privaten Schlüssels) erfolgreich ausgeführt.
- **Konsequenz:** Die Passwort-Policy kann nur **clientseitig** geprüft werden. Der Server kann sie nicht erzwingen, weil er das Passwort nicht kennt (bewusster Zielkonflikt zugunsten der Vertraulichkeit). Umgesetzt in `packages/shared/src/passwordPolicy.ts` (NIST SP 800-63B): mind. 12 Zeichen, keine Zeichenklassen-Pflicht, Abgleich mit ~49 000 verbreiteten Passwörtern (`@zxcvbn-ts/language-common`, MIT) plus deutscher/praxisbezogener Liste, auch in Varianten („Passwort2026!“, „P4ssw0rd“); kein Name/Benutzername, keine trivialen Folgen. Admin-Web-App und Windows-App nutzen dieselbe Funktion.
- bcrypt (PocketBase-Standard) ist hier ausreichend, weil `authKey` bereits ein hochentropischer, per Argon2id abgeleiteter Wert ist. Die eigentliche Härte gegen Wörterbuchangriffe liefert Argon2id.

### 2.2 Konten, Einmalpasswörter, Bootstrap
- **Keine Selbstregistrierung**: `users.createRule = null`. Konten entstehen nur über `POST /api/lexichat/admin/users` (aktive Admins) oder das CLI-Kommando `bootstrap-admin` (erster Admin, verweigert, sobald ein Admin existiert).
- Neue Konten und Admin-Resets erhalten ein **serverseitig erzeugtes Einmalpasswort** (~99 Bit, z. B. `k7mfq-2xhtr-9pwab-c3dne`), das genau einmal angezeigt wird. `must_change_password = true` sperrt alles außer dem Passwortwechsel (Middleware + API-Rules).
- Der erste Passwortwechsel (`POST /api/lexichat/me/password`) ist **atomar**: neues `authKey`, neuer Salt, neu verpackte private Schlüssel und – bei neuen Konten – die öffentlichen Schlüssel in einer Transaktion. Danach werden alle Sitzungen beendet; der Client meldet sich mit dem neuen Passwort neu an.

### 2.3 Sitzungen
- PocketBase-Tokens sind zustandslos (JWT). Damit Sitzungen **sichtbar und widerrufbar** sind, wird bei jedem Login ein `sessions`-Datensatz angelegt. Jede Anfrage eines Nutzers muss zusätzlich den Header `X-LexiChat-Session` mit einer gültigen, eigenen Sitzung senden, sonst `401`.
- Token-Laufzeit 30 min (Refresh durch den Client), Sitzung: Leerlauf-Timeout (Standard 8 h) und absolute Laufzeit (Standard 14 Tage), beides in `lx_settings` konfigurierbar.
- Widerruf („Sitzung beenden“, Abmelden) löscht den Datensatz; offene **Realtime-Verbindungen dieser Sitzung werden sofort getrennt** (getestet).
- Deaktivierung, Passwortwechsel und Admin-Reset erneuern den `tokenKey` (alle Tokens sofort ungültig) und löschen alle Sitzungen.
- Hinweis: PocketBase behandelt ein ungültiges Token wie einen Gast (keine Fehlermeldung, nur leere Listen). Die Clients prüfen deshalb regelmäßig per `auth-refresh` und reagieren auf `401`.

### 2.4 Brute-Force-Schutz
1. Caddy: Rate-Limit je IP (Login/Prelogin/Passwortwechsel 30/min, gesamte API 3000/min).
2. PocketBase-Rate-Limits (u. a. `*:auth` 30/min, `*:create` 60/10 s).
3. Kontosperre mit exponentiellem Backoff: ab 5 Fehlversuchen 1, 2, 4 … max. 60 Minuten. Der Zähler wird atomar per SQL erhöht (keine Race-Condition bei parallelen Versuchen).
4. Generische Fehlermeldung für falsches Passwort, unbekannten Nutzer und gesperrtes Konto (identischer Text, getestet).
- Restrisiko: Wer Benutzernamen kennt, kann ein Konto vorübergehend sperren (Denial of Service). Bei einem internen Dienst vertretbar; Admins sehen Sperren im Audit-Log.

### 2.5 Admin-Web-App nur für Admins
- Die Admin-Web-App läuft auf eigener Domain (same-origin mit der API). Logins mit `Origin` = Admin-Domain werden für Nicht-Admins **serverseitig** abgelehnt (`403`, Audit-Eintrag). Zusätzlich prüft die Web-App clientseitig.
- Ehrliche Einordnung: Der `Origin`-Header kann von Nicht-Browser-Clients weggelassen werden. Das ist kein Sicherheitsproblem, weil alle Verwaltungsfunktionen ohnehin serverseitig an `role = admin` gebunden sind – die Sperre verhindert nur, dass Nutzer die Web-Oberfläche überhaupt verwenden.

### 2.6 Zwei-Faktor-Authentisierung (umgesetzt in Phase 2)
Geprüft im Quellcode von PocketBase v0.40.5: PocketBase bietet MFA nur als Kombination zweier **eingebauter** Methoden (Passwort + E-Mail-OTP oder OAuth2). **TOTP (Authenticator-App) ist nicht nativ vorhanden**, E-Mail-OTP scheidet aus (kein SMTP). Deshalb eigene Umsetzung (`apps/server/internal/lexichat/totp.go`):
- RFC 6238 (HMAC-SHA1, 6 Ziffern, 30 s) – die Parameter, die alle gängigen Authenticator-Apps unterstützen; ±1 Zeitschritt Toleranz; **jeder Code nur einmal** (Replay-Schutz über `totp_last_step`). Geprüft mit den Testvektoren aus RFC 6238 und einer unabhängigen Node-Implementierung in den E2E-Tests.
- Der Code wird als zusätzliches Feld `totp` im normalen Passwort-Login gesendet und **vor** Anlage der Sitzung geprüft. Falsche Codes zählen zur Kontosperre.
- Das Secret wird mit AES-256-GCM verschlüsselt gespeichert (Schlüssel aus `LEXICHAT_SERVER_SECRET` abgeleitet, Benutzer-ID als Associated Data). **Folge:** Wird `LEXICHAT_SERVER_SECRET` geändert, müssen alle 2FA-Einrichtungen zurückgesetzt werden.
- Einrichtung nur nach erneuter Passworteingabe; QR-Code wird lokal im Browser erzeugt.
- Pflicht für Admins (`require_2fa_admins`, Standard an): Ohne 2FA ist ein Admin-Konto auf die Einrichtung beschränkt (Middleware + `requireAdmin`). Admins können 2FA nicht selbst abschalten; ein anderer Admin kann sie bei Geräteverlust zurücksetzen (Audit).
- Restrisiko: TOTP ist nicht phishing-resistent (anders als FIDO2/WebAuthn). WebAuthn wäre ein sinnvoller späterer Ausbau.

### 2.7 Private Schlüssel nie in der Web-App
Die Admin-Web-App wird vom Server ausgeliefert und könnte bei einer Serverkompromittierung manipuliert werden. Deshalb verarbeitet sie **nie** private Schlüssel:
- Passwortwechsel in der Web-App ist nur möglich, solange keine passwortverpackten Schlüssel existieren (Erstanmeldung, nach Admin-Reset). Sonst lehnt der Server ab (`/api/lexichat/me/password` verlangt dann neu verpackte Schlüssel), und die Web-App verweist auf die Windows-App.
- Schlüssel werden ausschließlich in der (signierten) Windows-App erzeugt bzw. wiederhergestellt: `POST /api/lexichat/me/keys` (nur solange keine verpackten Schlüssel existieren, mit Passwortbestätigung).

## 3. Ende-zu-Ende-Verschlüsselung

### 3.1 Schlüssel
- Pro Nutzer: X25519 (Verschlüsselung, `crypto_box`) + Ed25519 (Signatur), erzeugt **auf dem Gerät**.
- Die privaten Schlüssel werden mit `kek` per XChaCha20-Poly1305 verpackt (`wrapped_private_keys`) und so auf dem Server gespeichert (Mehrgeräte-Login). Das Feld ist in PocketBase `hidden` (nicht abfragbar, nicht filterbar) und wird nur dem Eigentümer über `GET /api/lexichat/me/keys` ausgeliefert.
- **Wiederherstellungsschlüssel:** Beim ersten Login erzeugt der Client einen zufälligen Wiederherstellungsschlüssel (einmalige Anzeige) und speichert die privaten Schlüssel zusätzlich damit verpackt (`recovery_wrapped_keys`).
- **Admin-Reset:** Neues Einmalpasswort, `wrapped_private_keys` wird gelöscht, **öffentliche Schlüssel und Recovery-Blob bleiben**. Hat die Person ihren Wiederherstellungsschlüssel, stellt der Client die alten Schlüssel wieder her (keine Schlüsseländerung für Kontakte). Ohne Wiederherstellungsschlüssel wird ein neues Schlüsselpaar erzeugt; **alte Nachrichten sind für diese Person dann nicht mehr lesbar** (bewusste Konsequenz, wird im Admin-UI vor dem Reset angezeigt).
- Admins können öffentliche Schlüssel anderer **nicht** setzen (getestet) – sonst wäre ein Man-in-the-Middle durch Admins trivial.

### 3.2 Nachrichten (Format v1)
```
msgKey     = random(32)
ciphertext = XChaCha20-Poly1305(msgKey, nonce(24), plaintext, AD = chatId|senderId|v)
envelopes  = { userId: crypto_box_seal(msgKey, pubEnc(userId)) }   für ALLE Chat-Mitglieder inkl. Absender
signature  = Ed25519(senderSignKey, v|chatId|senderId|nonce|ciphertext|hash(envelopes))
```
- Der Server prüft die **Struktur** (Nonce 24 Byte, Signatur 64 Byte, genau ein 80-Byte-Envelope je Chat-Mitglied, keine Envelopes für Fremde), nicht den Inhalt (kann er nicht).
- `crypto_box_seal` ist anonym; die Authentizität des Absenders entsteht durch die Ed25519-Signatur, die der Empfänger gegen den öffentlichen Signaturschlüssel des Absenders prüft.
- Das Envelope-Modell funktioniert unverändert für Gruppen (n Mitglieder → n Envelopes).

### 3.3 Schlüsselverteilung und -wechsel
- Öffentliche Schlüssel sind für alle aktiven Nutzer sichtbar; `key_version`/`keys_updated` zeigen Wechsel an.
- Die Clients berechnen eine **Sicherheitsnummer** (Fingerabdruck beider Schlüssel) zur Verifikation (z. B. persönlich am Empfang) und warnen bei Schlüsselwechsel (Trust-on-first-use + Warnung). Der Server speichert keinen Fingerabdruck, weil ein serverseitiger Wert keine Vertrauensbasis wäre.

### 3.4 Bekannte Grenzen (ehrlich)
- **Keine Forward Secrecy / kein Double Ratchet im MVP.** Wird ein privater Schlüssel kompromittiert (z. B. Passwort + DB-Kopie oder Malware auf dem Client), sind alle damit verschlüsselten, noch gespeicherten Nachrichten lesbar. Gemildert durch Auto-Löschung (Standard 90 Tage).
  *Upgrade-Pfad:* Nachrichtenformat ist versioniert (`v`). Version 2 kann pro Chat einen Sender-Key-/Ratchet-Mechanismus (z. B. Signal-Protokoll via libsignal oder MLS / RFC 9420 für Gruppen) einführen; Server und Datenmodell bleiben (Envelopes werden dann zu Schlüsselaktualisierungen).
- Metadaten (wer mit wem wann) sieht der Server zwangsläufig.
- Ein kompromittierter Admin kann ein Passwort zurücksetzen, sich mit dem Einmalpasswort anmelden und ein **neues** Schlüsselpaar für die Person erzeugen. Alte Nachrichten bleiben geschützt; neue könnten ihn erreichen. Gegenmaßnahmen: Schlüsselwechsel-Warnung bei allen Kontakten, Audit-Log (hash-verkettet), Vier-Augen-Prinzip organisatorisch (siehe Bedrohungsmodell).

## 4. Datenmodell

Alle Collections starten mit „alles gesperrt“. Die konkreten Regeln stehen in [02-rechtekonzept.md](02-rechtekonzept.md); die Migration ist `apps/server/migrations/1760700000_lexichat_init.go`.

| Collection | Zweck | Wichtige Felder |
|---|---|---|
| `users` (Auth) | Konten | `username` (eindeutig, NOCASE), `name`, `avatar` (JPEG/PNG/WebP ≤ 512 KB, geschützter Download, **kein SVG**), `role`, `active`, `must_change_password`, `public_enc_key`, `public_sign_key`, `key_version`, `keys_updated`; hidden: `kdf_salt`, `kdf_params`, `wrapped_private_keys`, `recovery_wrapped_keys`, `failed_logins`, `locked_until` |
| `lx_settings` | globale Einstellungen (1 Datensatz) | Aufbewahrung, Broadcast-Recht, 2FA, Sitzungs-Timeouts, Desktop-Sperre, Audit-Aufbewahrung |
| `sessions` | angemeldete Geräte | `user`, `client` (desktop/admin_web), `device_name`, `ip_hash`, `last_seen`, `expires_at` |
| `chats` | 1:1-Chats | `type` (`direct`, erweiterbar), `members` (genau 2), `member_key` (eindeutig, sortiert), `last_message_at` |
| `messages` | verschlüsselte Nachrichten | `chat`, `sender`, `v`, `ciphertext`, `nonce`, `envelopes`, `signature`, `is_broadcast`, `broadcast`, `reply_to`, `edited_at`, `expires_at` |
| `broadcasts` | Broadcast-Klammer | `sender`, `recipient_count`, `expires_at` |
| `receipts` | Zustell-/Lesebestätigungen | `message`, `user`, `delivered_at`, `read_at` (eindeutig je Nachricht+Nutzer) |
| `audit_logs` | Audit (append-only, hash-verkettet) | `action`, `actor_id`, `actor_username`, `target_*`, `details`, `ip_hash`, `prev_hash`, `hash`, `created` |

Abweichungen vom Vorschlag im Auftrag (mit Begründung):
- **`deleted_at` entfällt**: „Löschen für alle“ ist ein echtes serverseitiges Löschen (Datenminimierung); Antworten verlieren die Referenz.
- **`last_login` entfällt**: Login-Zeitpunkte einzelner Beschäftigter sind leistungs-/verhaltensbezogene Daten (§ 26 BDSG). Admins sehen stattdessen nur die aktiven Sitzungen.
- **`key_fingerprint` entfällt** serverseitig (siehe 3.3).
- **`broadcasts.delivered_count` entfällt**: wird aus `receipts` berechnet (keine Zähler-Race-Conditions).
- Zusätzlich: `kdf_*`, `key_version`, `keys_updated`, `failed_logins`, `locked_until`, `member_key`, `last_message_at`, `sessions`.

## 5. Server-Härtung (Phase 1 umgesetzt)

- Sicherheitsrelevante PocketBase-Einstellungen werden bei **jedem Start erzwungen** („Settings as Code“): Rate-Limits an, Batch-API aus, Request-Logs ohne IP und ohne Nutzer-ID mit 30 Tagen Aufbewahrung, Superuser-Login nur von definierten IPs, Collection-Bearbeitung im Dashboard ausgeblendet.
- CORS: Standard-`*` von PocketBase wird ersetzt; nur konfigurierte Origins (Admin-Domain, `http://tauri.localhost`).
- Caddy: TLS 1.3 only, HSTS, strikte CSP (`default-src 'none'` für die API; Admin-App ohne Inline-Skripte, nur `'wasm-unsafe-eval'` für libsodium), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy; `/_/` und alle Superuser-Endpunkte sind von außen nicht erreichbar (funktional getestet). Kein Access-Log (enthielte IP-Adressen).
- Container: Distroless, non-root (UID 65532), read-only Root-FS, `cap_drop: ALL`, `no-new-privileges`, Ressourcenlimits; PocketBase-Port nur auf `127.0.0.1` (Dashboard per SSH-Tunnel).
- Feldebene: Anfragen an `users`, `chats`, `messages`, `receipts` werden gegen **Allow-Listen** der erlaubten Felder geprüft; serverseitig verwaltete Felder (`sender`, `expires_at`, `is_broadcast`, `edited_at`, `member_key`, …) setzt nur der Server.
- Audit-Log: append-only auf Modellebene (auch für Superuser), SHA-256-Hash-Kette, Prüfkommando `lexichat verify-audit`. IP-Adressen nur als gekürzter HMAC (Pseudonymisierung).
- Aufbewahrung: Cron-Job alle 5 Minuten löscht abgelaufene Nachrichten, Broadcasts, Sitzungen und Audit-Einträge.

## 6. Regulatorischer Hinweis

LexiChat ist als **interner** Messenger für Beschäftigte einer Praxis konzipiert. Für die Kommunikation **mit Patientinnen und Patienten** bzw. mit anderen Leistungserbringern gelten im deutschen Gesundheitswesen eigene Vorgaben – insbesondere der **TI-Messenger** (TIM) der gematik für die Kommunikation innerhalb der Telematikinfrastruktur. LexiChat ist dafür weder gedacht noch zugelassen. Wie weit die TI-Messenger-Vorgaben oder Anforderungen nach § 75b SGB V (IT-Sicherheitsrichtlinie der KBV) auf einen rein internen Praxis-Messenger durchschlagen, kann ich nicht abschließend beurteilen – das sollte mit der/dem Datenschutzbeauftragten bzw. einer Rechtsberatung geklärt werden.

## 7. Phasen

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Monorepo, Docker/Caddy, Collections + API-Rules + Rules-Tests, Admin-Bootstrap, Sitzungen, Brute-Force-Schutz, Audit-Log, Aufbewahrung, Backup/Restore-Skripte, Architektur/Bedrohungsmodell/Rechtekonzept | ✅ |
| 2 | Admin-Web-App, Design-System, TOTP-2FA, Passwort-Policy, API-Client, E2E-/axe-Tests | ✅ |
| 3 | Windows-App (Tauri v2), `packages/crypto`, Realtime, Benachrichtigungen, Sperre, Credential Manager, verschlüsselter Cache | ✅ (nativ nur gegen Windows-Ziel kompiliert, nicht auf echtem Windows getestet) |
| 4 | Broadcasts mit serverseitiger Empfängerliste, Lesestatus | ✅ |
| 5 | Privatsphäre-Einstellungen, Kontaktverzeichnis, Export Art. 15/20, Anonymisierung, Datenschutz-Dokumente | ✅ (Dokumente sind Entwürfe) |
| 6 | Security-Review, ASVS-L2-Checkliste, Restore-Test, Release-Pipeline Windows | ✅ (Installer nicht real gebaut/signiert) |

## 8. Windows-App (Phase 3)

- **Tauri v2** mit Plugins `notification`, `single-instance`, `autostart`, `updater` (signierte Updates, `native-tls`/Schannel), `process`. Capabilities in `src-tauri/capabilities/default.json` auf das Nötigste begrenzt.
- **Geheimnisse**: Der lokale Geräteschlüssel liegt im **Windows Credential Manager** (`keyring`, DPAPI). Damit wird der lokale Nachrichten-Cache mit XChaCha20-Poly1305 verschlüsselt. Private Chat-Schlüssel liegen nur im Arbeitsspeicher und gewrappt (KEK aus dem Passwort) auf dem Server.
- **Screenshot-Schutz** über `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` (Einstellung pro Gerät, standardmäßig aus, weil es Bildschirmfreigaben im Support erschwert; Abfotografieren lässt sich nicht verhindern).
- **Sperre**: nach Leerlauf (Einstellung `desktop_lock_minutes`) und über das Tray-Menü „Sperren“; Entsperren erfordert das Passwort, Schlüssel werden beim Sperren aus dem Speicher entfernt.
- **Benachrichtigungen** standardmäßig ohne Absender und Inhalt; „Absender“ oder „Absender + Text“ nur nach Opt-in (`notificationContent`).
- **Plattform-Abstraktion** (`src/lib/platform.ts`): Im Browser (E2E-Tests) laufen dieselben Abläufe mit In-Memory-Fallbacks; nichts wird im Browser-Speicher persistiert.
- **Release**: `scripts/build-windows.mjs` setzt Server-URL, CSP und Updater-Endpunkt fest ein; GitHub-Workflow `release-windows.yml` (manuell) baut und signiert mit dem Zertifikat aus dem Secret-Store.

## 9. Broadcasts (Phase 4)

Client holt `GET /api/lexichat/broadcasts/recipients` (aktive Nutzer + öffentliche Schlüssel + Versionsstempel) → verschlüsselt pro Empfänger (Kontext `bcast:<recipientId>`) → `POST /api/lexichat/broadcasts` mit dem Stempel. Der Server prüft, dass die Empfängermenge **exakt** dem aktuellen Stand der aktiven Nutzer entspricht (sonst `409`, Client wiederholt), legt fehlende 1:1-Chats an und schreibt alle Nachrichten in einer Transaktion. Der Client kann so niemanden auslassen oder hinzufügen. Berechtigung (`broadcast_permission`: nur Admins / alle) und Limit pro Stunde (`broadcasts_per_hour`) sind Einstellungen. Der Absender sieht nur Zahlen (zugestellt / gelesen von x Empfängern, aus `receipts`), keine Namen; „gelesen“ zählt nur bei Empfängern mit aktivierten Lesebestätigungen.

## 10. Privatsphäre und Betroffenenrechte (Phase 5)

| Endpunkt | Zweck |
|---|---|
| `GET/POST /api/lexichat/me/prefs` | eigene Einstellungen (Lesebestätigungen, Tipp-Anzeige, Online-Status, Benachrichtigungsinhalt, Vorschau in der Chatliste) – **alle standardmäßig aus**; Tipp-/Online-Anzeige gegenseitig (wer sie nicht teilt, sieht sie auch nicht) |
| `POST /api/lexichat/typing`, `GET /api/lexichat/presence` | flüchtige Signale über Realtime, nicht gespeichert |
| `GET /api/lexichat/directory` | minimale Kontaktdaten (Name, Avatar, öffentliche Schlüssel) aktiver Nutzer und eigener Chat-Partner, auch wenn deaktiviert/anonymisiert |
| `GET /api/lexichat/me/export` | Datenexport Art. 15/20 (JSON `lexichat-export-v1`) |
| `GET /api/lexichat/admin/users/{id}/export`, `POST …/anonymize` | Auskunft und Anonymisierung durch Admins (2FA + Audit) |

Felder `prefs`, `totp_enabled`, `deactivated_at` sind im Schema **hidden** (nicht lesbar und nicht filterbar); der abgeleitete Wert `two_factor` wird nur Eigentümer und Admins angezeigt. Deaktivierte Konten werden nach `anonymize_deactivated_days` automatisch anonymisiert.
