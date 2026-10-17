# Checkliste Auftragsverarbeitung (Art. 28 DSGVO) für Hosting/Backup/IT-Dienstleister

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

Dienstleister: {{NAME, ANSCHRIFT}} · Leistung: {{Server-Hosting / Backup-Speicher / IT-Betreuung}} · Datum der Prüfung: {{DATUM}}

## A. Vertragsinhalte (Art. 28 Abs. 3 DSGVO)

| Punkt | ✔ | Fundstelle |
|---|---|---|
| Gegenstand, Dauer, Art und Zweck der Verarbeitung | ☐ | |
| Art der Daten (inkl. Hinweis auf mögliche Gesundheitsdaten, Art. 9) und Kategorien Betroffener | ☐ | |
| Verarbeitung nur auf dokumentierte Weisung | ☐ | |
| Vertraulichkeitsverpflichtung der eingesetzten Personen | ☐ | |
| TOMs nach Art. 32 als Anlage (Zertifikate: {{ISO 27001, BSI C5}}) | ☐ | |
| Unterauftragsverarbeiter: Liste, Genehmigung, Informationspflicht bei Änderungen | ☐ | |
| Unterstützung bei Betroffenenrechten | ☐ | |
| Unterstützung bei Art. 32–36 (Sicherheit, Meldung von Datenpannen **unverzüglich**, DSFA) | ☐ | |
| Löschung/Rückgabe nach Vertragsende inkl. Backups, Nachweis | ☐ | |
| Kontroll- und Auditrechte des Verantwortlichen | ☐ | |
| Hinweispflicht bei rechtswidrigen Weisungen | ☐ | |

## B. Ort der Verarbeitung

| Punkt | ✔ |
|---|---|
| Rechenzentrum in Deutschland/EU ({{Standort}}) | ☐ |
| Keine Übermittlung in Drittländer, auch nicht durch Fernwartung/Support/Unterauftragnehmer | ☐ |
| Keine Muttergesellschaft mit Sitz in einem Drittland, die Herausgabe verlangen kann (z. B. US CLOUD Act) – Risiko bewerten | ☐ |

## C. Berufsgeheimnis (§ 203 StGB)

| Punkt | ✔ |
|---|---|
| Schriftliche Verpflichtung des Dienstleisters zur Verschwiegenheit mit Belehrung über die Strafbarkeit (§ 203 Abs. 4 Satz 2 Nr. 1 StGB) | ☐ |
| Dienstleister verpflichtet seinerseits eingesetzte Personen und Unterauftragnehmer | ☐ |
| Offenbarung nur, soweit für die Leistung erforderlich (§ 203 Abs. 3 Satz 2 StGB) – durch E2EE technisch minimiert | ☐ |

## D. Technische Anforderungen an LexiChat-Betrieb

| Punkt | ✔ |
|---|---|
| Volume-/Festplattenverschlüsselung der VM | ☐ |
| Backups nur verschlüsselt (age), Schlüssel liegt **nicht** beim Dienstleister | ☐ |
| SSH nur mit Schlüssel, Admin-Zugänge personalisiert und protokolliert | ☐ |
| Patch-Management (OS, Docker) mit festen Fristen | ☐ |
| Kein Zugriff des Dienstleisters auf LexiChat-Admin-Konten | ☐ |
| Notfallkontakt 24/7 / Reaktionszeiten | ☐ |

Ergebnis: {{geeignet / nachbessern}} · Unterschrift: {{…}}
