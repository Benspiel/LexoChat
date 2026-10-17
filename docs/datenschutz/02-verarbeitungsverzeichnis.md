# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 Abs. 1 DSGVO) – LexiChat

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

| Feld | Inhalt |
|---|---|
| Verantwortlicher | {{PRAXIS_NAME}}, {{ADRESSE}}, {{PRAXISINHABER}} |
| Datenschutzbeauftragte(r) | {{DSB_KONTAKT}} |
| Bezeichnung der Verarbeitung | Interner Messenger „LexiChat“ (dienstliche Kommunikation der Beschäftigten) |
| Verantwortliche Fachabteilung | Praxisleitung / {{IT_VERANTWORTLICH}} |
| Datum der Einführung / letzten Änderung | {{DATUM}} |

## 1. Zwecke

1. Dienstliche Kommunikation zwischen Beschäftigten (1:1, Rundnachrichten).
2. Benutzer- und Rechteverwaltung.
3. Informationssicherheit (Authentisierung, Sitzungsverwaltung, Missbrauchsabwehr, Audit).
4. Erfüllung von Betroffenenrechten.

## 2. Rechtsgrundlagen

Art. 6 Abs. 1 lit. b, c, f, Art. 88 DSGVO, § 26 BDSG (s. Hinweis in den Datenschutzhinweisen); für Gesundheitsdaten Dritter in Nachrichten Art. 9 Abs. 2 lit. h, Abs. 3 DSGVO, § 22 Abs. 1 Nr. 1 lit. b BDSG; Art. 32 DSGVO. {{Betriebsvereinbarung, falls vorhanden}}

## 3. Kategorien betroffener Personen

- Beschäftigte der Praxis (Ärztinnen/Ärzte, MFA, Verwaltung, Auszubildende), ggf. weitere Nutzer:innen mit Konto ({{z. B. externe Honorarkräfte}}).
- Patientinnen und Patienten sowie Dritte, soweit sie in Nachrichten erwähnt werden (Inhalte Ende-zu-Ende-verschlüsselt).

## 4. Kategorien personenbezogener Daten

| Kategorie | Beispiele | Besondere Kategorie |
|---|---|---|
| Stammdaten Beschäftigte | Benutzername, Anzeigename, Avatar, Rolle | nein |
| Authentisierungsdaten | bcrypt-Hash des abgeleiteten Anmeldeschlüssels, KDF-Salt, verschlüsseltes TOTP-Geheimnis | nein |
| Kryptografische Schlüssel | öffentliche Schlüssel, passwort-/wiederherstellungsverschlüsselte private Schlüssel | nein |
| Kommunikationsmetadaten | Chat-Teilnehmende, Absender, Zeitstempel, Zustell-/Lesezeitpunkt | nein |
| Kommunikationsinhalte | Nachrichtentext (Ende-zu-Ende-verschlüsselt) | **ja, möglich** (Gesundheitsdaten, Art. 9) |
| Nutzungs-/Sicherheitsdaten | Sitzungen, Gerätebezeichnung, Fehlversuche, gekürzter IP-Hash, Audit-Ereignisse | nein |

## 5. Empfänger

| Empfänger | Daten | Grundlage |
|---|---|---|
| Admins der Praxis | Konto-, Sitzungs-, Audit-Daten | Rollenkonzept |
| Hoster {{HOSTING_ANBIETER}} (Rechenzentrum {{STANDORT, DE/EU}}) | verschlüsselte Inhalte, Metadaten (technischer Zugriff) | AV-Vertrag Art. 28, § 203 Abs. 3/4 StGB |
| IT-Dienstleister {{NAME}} (Wartung) | wie Hoster | AV-Vertrag |
| Backup-Speicher {{ANBIETER}} | mit `age` verschlüsselte Backups | AV-Vertrag |

## 6. Drittlandübermittlung

Keine. Keine Nutzung von Cloud-Push-Diensten, CDNs, Analyse- oder Crash-Reporting-Diensten.

## 7. Löschfristen

Siehe [Löschkonzept](05-loeschkonzept.md): Nachrichten {{90}} Tage, Sitzungen max. {{14}} Tage, Audit {{365}} Tage, Request-Logs 30 Tage, Backups {{30}} Tage, deaktivierte Konten Anonymisierung nach {{180}} Tagen.

## 8. Technische und organisatorische Maßnahmen

Siehe [TOMs](04-toms.md). Kurzfassung: Ende-zu-Ende-Verschlüsselung, Zero-Knowledge-Passwortableitung (Argon2id), TLS 1.3, 2FA für Admins, Rollen-/Rechtekonzept mit automatisierten Tests, unveränderliches Audit-Log, verschlüsselte Backups, Hosting in DE/EU.

## 9. Datenschutz-Folgenabschätzung

Durchgeführt: [DSFA](03-dsfa.md) vom {{DATUM}}.
