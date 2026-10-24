# Technische und organisatorische Maßnahmen (Art. 32 DSGVO) – LexiChat

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

Legende: **T** = technisch in LexiChat umgesetzt (mit Verweis), **B** = Betreiber/Hoster, **O** = organisatorisch durch die Praxis.

## 1. Vertraulichkeit

### 1.1 Zutrittskontrolle
- **B** Rechenzentrum {{HOSTING_ANBIETER}} mit Zutrittskontrolle (Zertifizierung {{ISO 27001 / C5}}).
- **O** Arbeitsplätze in nicht öffentlich zugänglichen Bereichen; Empfangsbildschirme mit Blickschutz.

### 1.2 Zugangskontrolle
- **T** Anmeldung mit Benutzername + Passwort; Passwort wird clientseitig mit Argon2id (64 MiB, 3 Iterationen) abgeleitet, der Server sieht es nie.
- **T** Passwortrichtlinie: ≥ 12 Zeichen, Abgleich mit ~49 000 verbreiteten Passwörtern (+ deutsche Liste).
- **T** Zwei-Faktor-Anmeldung (TOTP, RFC 6238), Pflicht für Admins.
- **T** Kontosperre mit exponentiellem Backoff nach 5 Fehlversuchen; Rate-Limits am Reverse Proxy und im Server.
- **T** Sitzungen: 30-min-Token + serverseitig widerrufbare Sitzung; Admin-Web-App mit Leerlauf- und Maximaldauer; Windows-App „einmal anmelden“ (Sitzung bis Abmeldung/Widerruf, max. 365 Tage ohne Nutzung, Zugangsdaten DPAPI-geschützt im Windows-Konto); App-Sichtschutz nach Inaktivität, Windows-Bildschirmsperre per GPO.
- **T** Keine Selbstregistrierung; Konten nur durch Admins, Einmalpasswörter.
- **B** Server-Administration nur per SSH-Schlüssel; Superuser-Dashboard nur per SSH-Tunnel und IP-Allowlist; Firewall.
- **O** Arbeitsplatz-Anmeldung, automatische Bildschirmsperre, BitLocker.

### 1.3 Zugriffskontrolle
- **T** Rollenkonzept (`user`/`admin`), API-Regeln „default deny“, Feld-Allow-Listen, automatisierte Negativtests ([Rechtekonzept](../02-rechtekonzept.md)).
- **T** Ende-zu-Ende-Verschlüsselung: Inhalte nur für Chat-Mitglieder lesbar, auch nicht für Admins/Hoster.
- **T** Admins können keine Schlüssel anderer setzen; Sicherheitsnummern und Schlüsselwechsel-Warnung.

### 1.4 Trennungskontrolle
- **T** Eigene Instanz pro Praxis; Chats nur zwischen Mitgliedern; Admin-Funktionen getrennte Oberfläche/Domain.

### 1.5 Pseudonymisierung
- **T** IP-Adressen nur als gekürzter HMAC (Audit, Sitzungen); Request-Logs ohne IP und ohne Nutzer-ID.
- **T** Anonymisierung ausgeschiedener Konten.

### 1.6 Verschlüsselung
- **T** Transport: TLS 1.3 only, HSTS.
- **T** Inhalte: XChaCha20-Poly1305 + crypto_box_seal (X25519) + Ed25519-Signaturen (libsodium).
- **T** Private Schlüssel nur verschlüsselt auf dem Server; lokaler Cache verschlüsselt (Schlüssel im Windows-Anmeldeinformationsspeicher).
- **T** TOTP-Geheimnisse AES-256-GCM-verschlüsselt.
- **T/B** Backups mit `age` verschlüsselt; Schlüssel getrennt und offline.
- **B** Festplatten-/Volume-Verschlüsselung (LUKS) des Servers.

## 2. Integrität

### 2.1 Weitergabekontrolle
- **T** Signierte Nachrichten (Manipulation wird erkannt), keine Drittanbieter, kein CDN, keine Push-Dienste.
- **T** Signierte App-Updates (Tauri-Updater) vom eigenen Server; Code-Signing des Installers.
- **O** Nutzungsrichtlinie: keine Weitergabe von Inhalten in andere Kanäle.

### 2.2 Eingabekontrolle
- **T** Unveränderliches, hash-verkettetes Audit-Log (wer, wann, was – ohne Inhalte) mit Prüfwerkzeug `lexichat verify-audit`.
- **T** Nachrichten: Absender serverseitig erzwungen und kryptografisch signiert; Bearbeitungen gekennzeichnet.

## 3. Verfügbarkeit und Belastbarkeit
- **T** Tägliche verschlüsselte Backups (konsistent), Restore-Skript, Healthchecks, Ressourcenlimits, Rate-Limits.
- **T** Offline-Warteschlange in der App; automatische Wiederverbindung.
- **B** Redundante Infrastruktur/USV des Rechenzentrums; Monitoring ohne personenbezogene Daten.
- **O** Halbjährlicher Restore-Test (Protokoll im Betriebshandbuch); Notfallplan.

## 4. Verfahren zur regelmäßigen Überprüfung
- **T** CI: Tests (Rechte, Krypto, E2E), Abhängigkeits-Audits (govulncheck, pnpm audit, cargo audit), Dependabot.
- **O** Jährliche Überprüfung der TOMs, DSFA und Rechte; Sichtung des Audit-Logs; Security-Review vor größeren Releases (siehe [Security-Review](../04-security-review.md)).

## 5. Auftragskontrolle
- **O** AV-Verträge nach Art. 28 ([Checkliste](07-av-checkliste.md)), Verpflichtung der Dienstleister nach § 203 Abs. 4 StGB.

## 6. Datenschutz durch Technikgestaltung (Art. 25)
- **T** Lesebestätigung, Tipp-Anzeige, Online-Status, Nachrichtenvorschau: standardmäßig aus; Benachrichtigungen ohne Inhalt.
- **T** Keine Telemetrie, kein Crash-Reporting an Dritte, keine Cookies in der Admin-Web-App, Schriften lokal.
