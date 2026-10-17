# LexiChat – Bedrohungsmodell (STRIDE)

> Stand: Phase 2. Status: ✅ umgesetzt · 🟡 geplant (Phase) · ⚠️ Restrisiko / organisatorisch

## 1. Schutzgüter

| Schutzgut | Schutzbedarf |
|---|---|
| Chatinhalte (können Gesundheitsdaten, Art. 9 DSGVO, und Berufsgeheimnisse, § 203 StGB, enthalten) | sehr hoch (Vertraulichkeit, Integrität) |
| Private Schlüssel der Nutzenden | sehr hoch |
| Zugangsdaten (Passwörter, Tokens, Einmalpasswörter, Wiederherstellungsschlüssel) | sehr hoch |
| Metadaten (wer mit wem wann) | hoch |
| Konten-/Rollendaten, Audit-Log | hoch (Integrität) |
| Verfügbarkeit des Dienstes | mittel (Praxisbetrieb läuft auch ohne Chat weiter) |

## 2. Vertrauensgrenzen

1. Arbeitsplatz-PC (Windows-App, lokaler Cache) ↔ Netzwerk
2. Internet/LAN ↔ Reverse Proxy (Caddy)
3. Reverse Proxy ↔ PocketBase (internes Docker-Netz)
4. PocketBase ↔ Datenbank/Volume/Backups
5. Admin-Rolle ↔ Nutzer-Rolle; Superuser (Dashboard) ↔ Admin

## 3. STRIDE je Komponente

| Kategorie | Bedrohung | Maßnahme | Status |
|---|---|---|---|
| **S**poofing | Passwort-Raten / Credential Stuffing | Argon2id-Ableitung (teuer pro Versuch), Kontosperre mit Backoff, Rate-Limits (Caddy + PocketBase), generische Fehler | ✅ |
| S | Gestohlenes Token | 30-min-Token + Sitzungsbindung (`X-LexiChat-Session`), Widerruf, Leerlauf-Timeout | ✅ |
| S | Nutzer meldet sich in der Admin-Web-App an | serverseitige Origin-Prüfung + Rollenprüfung aller Admin-Endpunkte | ✅ |
| S | Gefälschter Absender einer Nachricht | API-Rule `sender = auth.id` + Ed25519-Signatur, die der Empfänger prüft | ✅ Server / 🟡 Client (P3) |
| S | Phishing-Server / falsche URL | Server-URL in der Windows-App fest konfiguriert, TLS 1.3, Zertifikat-Pinning prüfen | 🟡 P3 |
| S | Admin-Konto ohne zweiten Faktor | TOTP-Pflicht für Admins, Replay-Schutz, Secret verschlüsselt (⚠️ TOTP ist nicht phishing-resistent; WebAuthn als Ausbau) | ✅ |
| **T**ampering | Manipulation von Rollen/Status durch Nutzer | Rules + Feld-Allow-List + Tests | ✅ |
| T | Manipulation von Nachrichten auf dem Server | AEAD (Poly1305) + Signatur; Server kann nur löschen, nicht unbemerkt ändern | 🟡 P3 (Client-Prüfung) |
| T | Austausch öffentlicher Schlüssel (MITM) durch Admin/Server | Admins können Schlüssel nicht setzen; Sicherheitsnummer + Warnung bei Schlüsselwechsel | ✅ Server / 🟡 P3 |
| T | Manipulation des Audit-Logs | append-only (Modell-Hooks), Hash-Kette, `verify-audit` | ✅ |
| T | Manipulierte Updates der Windows-App | Code-Signing + signierte Updates (Tauri Updater, eigener Schlüssel) | 🟡 P6 |
| **R**epudiation | Admin bestreitet Verwaltungsaktion | Audit-Log mit Akteur, Zeit, Ziel, Hash-Kette | ✅ |
| **I**nformation Disclosure | Server/DB/Backup kompromittiert | E2EE; Server kennt weder Passwort noch `kek`; Backups mit `age` verschlüsselt; Volume-Verschlüsselung (LUKS) | ✅ / ⚠️ LUKS ist Betreiberaufgabe |
| I | Offline-Brute-Force der verpackten Schlüssel (nach DB-Diebstahl) | Argon2id 64 MiB/3 Iterationen pro Versuch; Passwort-Policy ≥ 12 Zeichen + Liste verbreiteter Passwörter (clientseitig) | ✅ |
| I | Kolleg:in liest verpackte Schlüssel anderer | Felder `hidden` (nicht lesbar, nicht filterbar) | ✅ |
| I | Enumeration von Benutzernamen | Schein-Salt im Prelogin, identische Fehlermeldungen | ✅ (⚠️ Antwortzeit-Unterschiede nicht vollständig ausgeschlossen) |
| I | Inhalte in Logs | keine Inhalte serverseitig vorhanden; Request-Logs ohne IP/Nutzer-ID; Audit ohne Inhalte, ohne Passwörter, ohne Benutzername bei unbekannten Logins (getestet) | ✅ |
| I | Benachrichtigungen auf Sperrbildschirm | Toasts ohne Inhalt/Absender (Standard) | 🟡 P3 |
| I | XSS in Admin-Web/Desktop | React-Escaping, kein `dangerouslySetInnerHTML`, kein HTML/Markdown-Rendering, strikte CSP ohne Inline-Skripte (E2E-Tests laufen mit Produktions-CSP), SVG-Avatare verboten, Token nur im Arbeitsspeicher | ✅ Admin-Web / 🟡 Desktop P3 |
| I | Manipulierte Admin-Web-App (kompromittierter Server liefert Schadcode) | Web-App verarbeitet nie private Schlüssel (Architektur 2.7); Admin-Domain optional nur aus dem Praxisnetz | ✅ / ⚠️ Admin-Passwort + TOTP-Code könnten abgegriffen werden |
| I | Metadaten | Server sieht Kommunikationsbeziehungen – technisch nicht vermeidbar; minimiert (kein `last_login`, IP nur gehasht) | ⚠️ |
| **D**enial of Service | Request-Flut | Rate-Limits, Body-Limit 2 MB, Ressourcenlimits der Container | ✅ |
| D | Gezielte Kontosperre durch Fehlversuche | max. 60 min Sperre, Admin-Reset hebt Sperre auf, Audit | ⚠️ akzeptiert |
| D | Datenverlust | tägliche verschlüsselte Backups, Restore-Skript | ✅ Skripte / 🟡 Restore-Test P6 |
| **E**levation of Privilege | Nutzer → Admin | Rules + Hooks + Tests | ✅ |
| E | Zugriff auf PocketBase-Dashboard | `/_/` und Superuser-APIs am Proxy gesperrt, Port nur `127.0.0.1`, Superuser-IP-Allowlist | ✅ |
| E | Container-Ausbruch | non-root, read-only, `cap_drop: ALL`, `no-new-privileges`, Distroless | ✅ |
| E | Lieferkette (Abhängigkeiten) | Versionen + Image-Digests gepinnt, `go mod verify`, govulncheck in CI, Dependabot | ✅ (⚠️ govulncheck konnte in der Entwicklungsumgebung mangels Netzzugang nicht lokal laufen, läuft in CI) |

## 4. Szenarien

### 4.1 Verlorener / gestohlener Laptop
- Ohne Windows-Anmeldung: lokaler Cache verschlüsselt (Schlüssel im Credential Manager/DPAPI, an das Windows-Konto gebunden) 🟡 P3. Festplattenverschlüsselung (BitLocker) ⚠️ organisatorisch Pflicht.
- Bei entsperrtem Gerät: App-Sperre nach Inaktivität (Standard 10 min) 🟡 P3.
- Reaktion: Admin beendet die Sitzung des Geräts bzw. deaktiviert das Konto → sofort wirksam, Realtime wird getrennt ✅.

### 4.2 Kompromittierter Admin
- Kann **keine** Chatinhalte lesen, keine fremden Schlüssel setzen, Audit-Log nicht ändern.
- Kann: Konten anlegen/deaktivieren, Passwörter zurücksetzen und sich mit dem Einmalpasswort als Person anmelden → ein neues Schlüsselpaar wird erzeugt → Kontakte erhalten eine **Schlüsselwechsel-Warnung**; alte Nachrichten bleiben unlesbar.
- ⚠️ Organisatorisch: mindestens zwei Admins, Vier-Augen-Prinzip für Resets, regelmäßige Sichtung des Audit-Logs, Resets nur nach Rückruf/persönlicher Identifikation.

### 4.3 Kompromittierter Server (Root auf dem Host)
- Sieht: Metadaten, Ciphertexte, verpackte Schlüssel, bcrypt-Hashes der Auth-Keys.
- Sieht nicht: Klartexte, Passwörter, `kek`, private Schlüssel.
- Aktive Angriffe: Ausliefern falscher öffentlicher Schlüssel → durch Sicherheitsnummern/Warnungen erkennbar 🟡 P3; Unterdrücken/Löschen von Nachrichten → nicht verhinderbar ⚠️. Die Admin-Web-App wird vom Server ausgeliefert und könnte manipuliert werden → Admins sollten keine Chatfunktionen in der Web-App haben (so geplant); Schlüssel-relevante Abläufe laufen nur in der signierten Windows-App ✅ (Design).
- Reaktion: Incident-Response-Plan (Phase 5), Server neu aufsetzen, Passwörter aller Nutzenden ändern lassen.

### 4.4 Insider (berechtigte:r Nutzer:in)
- Sieht nur eigene Chats. Kann Inhalte abschreiben/fotografieren ⚠️ (Screenshot-Schutz optional, Abfotografieren nicht verhinderbar). Nutzungsrichtlinie + Schweigepflicht (Phase 5).

### 4.5 Phishing
- Kein Login über Links/E-Mail (kein SMTP), Server-URL fest in der App, Admin-Web nur unter bekannter Domain mit HSTS; Schulung ⚠️.

### 4.6 Malware auf dem Client
- Kann Klartexte und Schlüssel im entsperrten Zustand abgreifen – **nicht** durch die App verhinderbar ⚠️. Maßnahmen: Endpoint-Schutz, Updates, keine lokalen Admin-Rechte, App-Sperre, kurze Aufbewahrung. Keine Forward Secrecy im MVP (siehe Architektur 3.4).

### 4.7 Shoulder Surfing
- App-Sperre, Benachrichtigungen ohne Inhalt, Nachrichtenvorschau in der Chatliste abschaltbar, optional Screenshot-Schutz 🟡 P3; Bildschirmposition/Blickschutzfilter am Empfang ⚠️ organisatorisch.
