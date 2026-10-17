# Incident-Response- und Meldeplan (Art. 33/34 DSGVO) – LexiChat

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

## 1. Meldewege und Rollen

| Rolle | Person | Erreichbarkeit |
|---|---|---|
| Meldestelle intern | {{Praxisleitung}} | {{Telefon}} |
| Datenschutzbeauftragte(r) | {{DSB_KONTAKT}} | {{Telefon}} |
| Technische Leitung | {{IT_DIENSTLEISTER}} | {{Telefon 24/7}} |
| Aufsichtsbehörde | {{ZUSTAENDIGE_AUFSICHTSBEHOERDE}} | {{Online-Meldeformular}} |

Alle Beschäftigten melden Verdachtsfälle **sofort** (verlorener Laptop, Fehlversand, verdächtige Anmeldung, Schlüsselwechsel-Warnung ohne Erklärung).

## 2. Ablauf

**Uhr startet:** Die 72-Stunden-Frist (Art. 33 Abs. 1) beginnt, sobald die Praxis Kenntnis von einer Verletzung hat.

1. **Erfassen** (Stunde 0): Wer, was, wann, welche Systeme/Daten; Zeitpunkt der Kenntnisnahme dokumentieren.
2. **Eindämmen** (sofort):
   - Gerät verloren → Sitzung des Geräts beenden bzw. Konto deaktivieren (Admin-Web-App, wirkt sofort).
   - Konto kompromittiert → Passwort + 2FA zurücksetzen, Sitzungen beenden.
   - Admin-Konto kompromittiert → zweite Admin-Person deaktiviert es; Audit-Log sichern (Export).
   - Server kompromittiert → vom Netz nehmen, Beweise sichern (Snapshot), **nicht** ohne Sicherung neu starten; Hoster informieren.
   - Fehlversand → „Löschen für alle“, Empfänger:in um Löschung/Bestätigung bitten.
3. **Bewerten** (bis Stunde 24, mit DSB): Risiko für Betroffene? Kriterien: Art der Daten (Gesundheitsdaten → hoch), Anzahl, Verschlüsselung (E2EE-Inhalte bei Serverkompromittierung **nicht** offengelegt; Metadaten schon), Wahrscheinlichkeit der Kenntnisnahme.
4. **Melden** an die Aufsichtsbehörde binnen 72 h, außer die Verletzung führt voraussichtlich nicht zu einem Risiko. Inhalte nach Art. 33 Abs. 3 (Vorlage unten). Teilmeldungen sind zulässig.
5. **Benachrichtigen** der Betroffenen (Art. 34) bei voraussichtlich **hohem** Risiko – in klarer, einfacher Sprache. Entfällt u. a., wenn die Daten durch Verschlüsselung für Unbefugte unzugänglich sind (Art. 34 Abs. 3 lit. a).
6. **Beheben und Lernen**: Ursache beheben, Passwörter ändern lassen, ggf. Server neu aufsetzen und aus geprüftem Backup wiederherstellen, `lexichat verify-audit` ausführen, Maßnahmen dokumentieren.
7. **Dokumentieren** (Art. 33 Abs. 5): jeder Vorfall – auch nicht meldepflichtige – im Vorfallregister.

## 3. Technische Hilfen in LexiChat

| Frage | Werkzeug |
|---|---|
| Wer hat sich wann angemeldet / wurde gesperrt? | Audit-Log (Admin-Web-App), IP nur als Pseudonym |
| Wurde das Audit-Log manipuliert? | `docker compose exec server /app/lexichat verify-audit --dir /pb_data` |
| Welche Geräte sind angemeldet? | Benutzer → Verwalten → Sitzungen |
| Alle Sitzungen einer Person beenden | Deaktivieren oder Passwort zurücksetzen |
| Wurden Schlüssel ersetzt (MITM-Verdacht)? | Audit `auth.keys_changed`, Sicherheitsnummern vergleichen |

## 4. Vorlage Meldung an die Aufsichtsbehörde

- Verantwortlicher, DSB-Kontakt
- Art der Verletzung, Zeitpunkt (Eintritt / Kenntnis), Kategorien und ungefähre Zahl der Betroffenen und Datensätze
- Wahrscheinliche Folgen
- Ergriffene / geplante Maßnahmen
- Begründung bei verspäteter Meldung

## 5. Vorfallregister (Muster)

| Nr. | Datum Kenntnis | Beschreibung | Betroffene Daten | Risiko | Gemeldet (Datum) | Betroffene informiert | Maßnahmen |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | | |

## 6. Übungen

Jährlich ein Planspiel (z. B. „Laptop gestohlen“, „Admin-Passwort geleakt“) mit Admins und DSB; Ergebnis im Register vermerken.
