# OWASP ASVS 4.0.3 – Level-2-Checkliste (Richtschnur)

> Selbstbewertung je Kapitel, keine Zertifizierung. ✅ erfüllt · 🟡 teilweise / organisatorisch · ❌ offen · n/a nicht anwendbar.
> Ich habe die ASVS-Anforderungen nach bestem Wissen zusammengefasst; die Nummerierung einzelner Anforderungen bitte gegen das offizielle Dokument prüfen.

| Kapitel | Thema | Status | Nachweis / Anmerkung |
|---|---|---|---|
| V1 | Architektur, Design, Bedrohungsmodell | ✅ | [Architektur](00-architektur.md), [STRIDE](01-bedrohungsmodell.md), [Rechtekonzept](02-rechtekonzept.md) |
| V2.1 | Passwortsicherheit | ✅ | ≥ 12 Zeichen, ≤ 128, keine Kompositionsregeln, Blocklist (~49k), Passwortänderung mit altem Passwort; Policy clientseitig (Zero-Knowledge, begründet) |
| V2.2 | Allgemeine Authentisierung | ✅ | Sperre mit Backoff, Rate-Limits (Proxy + Server), generische Meldungen |
| V2.4 | Speicherung von Anmeldedaten | ✅ | Argon2id (Client) + bcrypt (Server) |
| V2.5 | Wiederherstellung | ✅ | kein Self-Service-Reset per E-Mail; Einmalpasswort durch Admin; Wiederherstellungsschlüssel für Schlüssel |
| V2.7/2.8 | Out-of-band / OTP | ✅ | TOTP RFC 6238, Replay-Schutz, Secret verschlüsselt; Pflicht für Admins |
| V3 | Sitzungsverwaltung | ✅ | serverseitige Sitzungen, Widerruf, Leerlauf/Max-Dauer (Admin-Web; Windows-App: gleitend 365 Tage + gehashtes Resume-Secret, bewusste Abweichung für „einmal anmelden“), Token 30 min, keine Cookies (kein CSRF-Vektor), Abmelden beendet Sitzung |
| V4 | Zugriffskontrolle | ✅ | default deny, serverseitig, Tests (positiv/negativ), Admin + 2FA für Verwaltung |
| V5 | Validierung, Sanitisierung, Encoding | ✅ | Feld-Allow-Listen, Schema-Validierung, Strukturprüfung der Krypto-Daten, React-Escaping, kein HTML-Rendering |
| V6 | Kryptografie | ✅ | libsodium (XChaCha20-Poly1305, X25519, Ed25519, Argon2id, BLAKE2b), Go x/crypto; CSPRNG; keine Eigenbau-Primitive |
| V7 | Fehlerbehandlung, Logging | ✅ | Audit ohne Inhalte/Secrets (Test), Request-Logs ohne IP, Hash-Kette |
| V8 | Datenschutz | ✅ | E2EE, Minimierung, Fristen, Export/Anonymisierung, keine Telemetrie, Cache verschlüsselt |
| V9 | Kommunikation | ✅ / 🟡 | TLS 1.3 only, HSTS; Zertifikat-Pinning bewusst nicht umgesetzt (siehe Review) |
| V10 | Schadcode, Integrität | 🟡 | signierte Updates vorbereitet; Abhängigkeiten gepinnt + Audits in CI; Code-Signing-Zertifikat fehlt (Betreiber) |
| V11 | Geschäftslogik | ✅ | Broadcast-Empfängerliste serverseitig, Rate-Limit pro Stunde, Nachrichten an deaktivierte Konten blockiert |
| V12 | Dateien | ✅ (n/a Anhänge) | nur Avatare: JPEG/PNG/WebP, ≤ 512 KB, kein SVG, geschützter Download |
| V13 | API | ✅ | Body-Limit, Rate-Limits, Batch-API aus, ungenutzte Endpunkte blockiert, CORS auf eigene Origins |
| V14 | Konfiguration | ✅ / 🟡 | Settings as Code, Distroless non-root read-only, Security-Header, Secrets nur per Env; Härtung des Host-OS = Betreiber |

Offene ❌: keine. 🟡-Punkte sind im [Security-Review](04-security-review.md) unter „Offene Punkte“ beschrieben.
