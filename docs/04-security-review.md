# LexiChat – Security-Review (Phase 6)

> Eigenes Review der Implementierung vor der Abnahme. **Kein Ersatz für einen unabhängigen Penetrationstest**, der vor dem Produktivbetrieb empfohlen wird.

## 1. Vorgehen

1. Durchsicht aller Server-Hooks, API-Regeln und Endpunkte gegen das [Rechtekonzept](02-rechtekonzept.md).
2. Gezielte Suche nach typischen Schwachstellen (Filter-Orakel, Massenzuweisung, IDOR, XSS, unsichere Defaults, Race-Conditions).
3. Prüfung der Krypto-Abläufe gegen das [Architekturdokument](00-architektur.md) (Testvektoren, Manipulationstests).
4. Automatisierte Tests: Go (API-Regeln, Abläufe), Vitest (Krypto, Policy, Tokens), Playwright E2E (Admin-Web-App, Windows-App), axe (WCAG 2.1 AA), Abhängigkeits-Audits.

## 2. Befunde und Behebung

| # | Befund | Schwere | Status |
|---|---|---|---|
| F1 | Felder `prefs`, `totp_enabled`, `deactivated_at` waren für andere zwar ausgeblendet, aber **filterbar** (Orakel: „wer hat keine 2FA?“, Privatsphäre-Einstellungen). | mittel | ✅ behoben: Schema-`hidden`, eigene Endpunkte (`/me/prefs`), abgeleiteter Wert `two_factor` nur für Eigentümer/Admins; Test `TestNoFilterOracleOnSecurityFields` |
| F2 | Ungenutzte PocketBase-Auth-Endpunkte (E-Mail-Reset, OTP, OAuth2, Impersonate) erreichbar (wirkungslos konfiguriert). | gering | ✅ blockiert im Server (Middleware) und in Caddy; Test `TestUnusedAuthEndpointsAreBlocked` |
| F3 | Realtime-Kanäle in PocketBase sind ungepuffert – eigene Tipp-Signale hätten eine Anfrage bei langsamen Clients blockiert (DoS-Vektor). | mittel | ✅ asynchroner Versand; Test deckte den Fehler auf |
| F4 | Bearbeiten einer Nachricht schickte das Feld `v` mit → vom Server (korrekt) abgelehnt, Funktion in der App defekt. | funktional | ✅ behoben (E2E-Test) |
| F5 | Eigene Nachricht konnte kurz doppelt erscheinen (Realtime schneller als HTTP-Antwort). | funktional | ✅ Zuordnung über Nonce |
| F6 | Chat-Partner sahen deaktivierte/anonymisierte Kontakte gar nicht mehr (Signaturen alter Nachrichten nicht prüfbar). | funktional | ✅ Verzeichnis-Endpunkt mit minimalen Daten der Chat-Partner |
| F7 | Letzter-Admin-Schutz las veralteten Zustand (`Record.Original()`). | hoch | ✅ (Phase 1) liest DB-Zustand |
| F8 | Leetspeak-Normalisierung der Passwort-Policy wandelte angehängte Ziffern um („P4ssw0rd2026!“ nicht erkannt). | gering | ✅ (Phase 2) |
| F9 | TOTP-Fehlerdaten wurden von PocketBase umgeformt, 2FA-Abfrage erschien nicht. | funktional | ✅ (Phase 2) Fehlercodes |
| F10 | Updater zog `ring` (C-Code) nach sich; Windows-TLS-Stack (Schannel) ist für das Einsatzumfeld passender (Unternehmens-CAs). | Hinweis | ✅ `native-tls` |

## 3. Geprüft ohne Befund (Auszug)

- Massenzuweisung: alle schreibenden Record-API-Aufrufe laufen gegen Feld-Allow-Listen; serverseitige Felder (Absender, Zeiten, Broadcast-Flag, Schlüssel) sind nicht setzbar (Tests).
- IDOR: Chats/Nachrichten/Receipts/Sitzungen/Broadcast-Status nur für Mitglieder bzw. Eigentümer (Tests mit Dritt-Konto).
- XSS: kein `dangerouslySetInnerHTML`/`innerHTML`/`eval` im Code (Grep), Nachrichten werden als Text gerendert, CSP ohne Inline-Skripte, E2E-Tests laufen mit Produktions-CSP.
- Kryptografie: libsodium-Primitive; KDF byte-genau zwischen Go und JS; Manipulation von Chiffretext/Nonce/Envelope/Signatur und Umhängen in fremde Chats wird erkannt.
- Sitzungen: Widerruf trennt Realtime sofort; Deaktivierung, Passwortwechsel, 2FA-Reset beenden alle Sitzungen.
- Audit: append-only auch für Superuser, Hash-Kette, Manipulation erkannt.
- Container/Proxy: non-root, read-only, keine Superuser-Endpunkte von außen (funktional getestet).

## 4. Offene Punkte / Restrisiken (müssen Menschen prüfen)

1. **Kein externer Pentest** – vor Produktivbetrieb beauftragen (Fokus: Server-API, Admin-Web-App, Desktop-IPC).
2. **Keine Forward Secrecy** (siehe Architektur 3.4).
3. **TOTP ist nicht phishing-resistent**; WebAuthn/FIDO2 wäre die Ausbaustufe.
4. **Windows-Installer nicht real gebaut/signiert** – die Release-Pipeline ist vorbereitet, Code-Signing-Zertifikat und Update-Schlüssel fehlen (Betreiberaufgabe). Rust-Code wurde gegen das Windows-Ziel geprüft (`cargo check`/`clippy`), nicht auf einem echten Windows ausgeführt (Credential Manager, Toasts, Screenshot-Schutz, Tray daher **ungetestet**).
5. **Docker-Stack lokal geprüft, nicht auf einem echten Server**: Images mit den gepinnten Digests gebaut, Stack mit Testdomains (`*.localhost`, interne Caddy-CA) gestartet; geprüft wurden Healthcheck, TLS 1.3 only (TLS 1.2 abgelehnt), Security-Header, Sperre von `/_/`, Superuser- und E-Mail-Endpunkten (404), non-root/read-only, PocketBase-Port nur auf 127.0.0.1, `create-first-admin.sh`, `backup.sh` und `restore.sh`. **Nicht** geprüft: echtes Let's-Encrypt-Zertifikat, Firewall/Host-Härtung, Anmeldung mit der Windows-App gegen diesen Stack (die Anmeldung ist durch die E2E-Tests gegen dasselbe Server-Programm abgedeckt).
6. **Zertifikat-Pinning** im Desktop-Client nicht umgesetzt: Bei Let's-Encrypt-Zertifikaten mit 90-Tage-Rotation ist Pinning fehleranfällig; Schutz stattdessen durch fest einkompilierte Server-URL, HSTS und Windows-Zertifikatsprüfung. Bei eigener CA kann Pinning nachgerüstet werden.
7. **Dateianhänge, Gruppenchats** nicht enthalten (Nicht-Ziele des MVP).
8. Metadaten (wer mit wem wann) sind für den Server sichtbar.
