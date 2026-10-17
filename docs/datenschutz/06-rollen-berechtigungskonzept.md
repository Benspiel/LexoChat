# Rollen- und Berechtigungskonzept – LexiChat

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

Grundsatz: **minimale Rechte** („need to know“), technisch durchgesetzt und automatisiert getestet. Die technische Detailbeschreibung (API-Regeln) steht im [Rechtekonzept](../02-rechtekonzept.md).

## 1. Rollen

| Rolle | Wer | Zweck |
|---|---|---|
| Benutzer:in (`user`) | alle Beschäftigten | dienstliche Kommunikation |
| Administrator:in (`admin`) | {{2 benannte Personen, z. B. Praxismanagerin + Vertretung}} | Kontoverwaltung, Einstellungen, Audit-Sichtung |
| Superuser (technisch) | {{IT-Dienstleister / IT-Verantwortliche:r}} | nur Notfall (Datenbank-Dashboard per SSH-Tunnel), dokumentiert |
| Betrieb (Server) | {{IT-Dienstleister}} | Updates, Backups, Restore – ohne Zugriff auf Inhalte |

## 2. Berechtigungsmatrix

| Funktion | user | admin | Superuser | Betrieb |
|---|---|---|---|---|
| Eigene Chats lesen/schreiben | ✔ | ✔ | – (nur Chiffretext) | – (nur Chiffretext) |
| Fremde Chats lesen | ✘ | ✘ | ✘ (technisch unmöglich) | ✘ |
| Verzeichnis aktiver Kolleg:innen | ✔ (Name, Avatar, öffentl. Schlüssel) | ✔ | ✔ | – |
| Eigenes Profil, Passwort, 2FA, Geräte | ✔ | ✔ | – | – |
| Broadcast senden | ✔ / nur admin (Einstellung) | ✔ | – | – |
| Konten anlegen/bearbeiten/deaktivieren | ✘ | ✔ (nicht eigene Rolle/Status) | ✔ | – |
| Passwort/2FA zurücksetzen, entsperren | ✘ | ✔ (nicht für sich selbst) | ✔ | – |
| Konto löschen/anonymisieren | ✘ | ✔ (nicht sich selbst, nicht letzter Admin) | ✔ | – |
| Datenauskunft (Art. 15) | eigene | alle | – | – |
| Einstellungen (Fristen, Richtlinien) | lesen | ändern | ✔ | – |
| Audit-Log lesen | ✘ | ✔ | ✔ | – |
| Audit-Log ändern/löschen | ✘ | ✘ | ✘ (append-only) | nur automatisch nach Frist |
| Backups erstellen/wiederherstellen | – | – | – | ✔ |

## 3. Vergabe und Entzug

- Antrag: Personalverwaltung meldet Ein-/Austritt schriftlich an die Admins ({{Formular/Ticket}}).
- Admin-Rolle nur auf Anordnung der Praxisleitung; mindestens zwei Admins; 2FA verpflichtend.
- Austritt: Deaktivierung spätestens am letzten Arbeitstag (wirkt sofort), Anonymisierung nach Löschkonzept.
- Rezertifizierung: halbjährliche Prüfung der Kontenliste und Admin-Rollen durch die Praxisleitung.

## 4. Vier-Augen-Prinzip

Passwort-Resets und 2FA-Resets erfolgen nur nach Identitätsprüfung (persönlich oder Rückruf über bekannte Nummer). Resets eines Admin-Kontos führt die zweite Admin-Person durch. Alle Vorgänge stehen im Audit-Log.

## 5. Technische Absicherung

- Rollenwechsel und Kontostatus können Nutzer:innen nicht selbst ändern (Tests vorhanden).
- Admin-Funktionen sind nur mit gültiger Sitzung **und** eingerichteter 2FA erreichbar.
- Die Admin-Web-App lehnt Nicht-Admins serverseitig ab.
- Superuser-Zugang ist von außen gesperrt (nur SSH-Tunnel, IP-Allowlist).
