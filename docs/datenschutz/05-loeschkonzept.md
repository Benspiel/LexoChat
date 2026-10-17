# Löschkonzept – LexiChat

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

Orientierung an DIN 66398 (Löschkonzept) in vereinfachter Form. Fristen sind in der Admin-Web-App unter „Einstellungen“ konfigurierbar und werden durch einen Server-Job alle 5 Minuten technisch umgesetzt (`RunRetention`, getestet).

## 1. Grundsatz: Chat ist keine Dokumentation

LexiChat ist kein Ort für die Patientendokumentation. Dokumentationspflichtige Inhalte (§ 630f BGB, Berufsordnung) sind in das Praxisverwaltungssystem zu übertragen. Deshalb gelten kurze Fristen. **Prüfen Sie, ob in Ihrer Praxis Aufbewahrungspflichten bestehen, die längere Fristen erfordern.**

## 2. Löschklassen

| Datenart | Regel-Löschfrist | Startereignis | Umsetzung |
|---|---|---|---|
| Nachrichten (verschlüsselt) inkl. Lesebestätigungen | {{90}} Tage (1–3650 konfigurierbar) | Erstellung | `expires_at` je Nachricht; Job löscht abgelaufene Nachrichten (Lesebestätigungen kaskadierend) |
| „Löschen für alle“ | sofort | Aktion der absendenden Person | Datensatz wird serverseitig gelöscht, Empfänger-Apps entfernen ihn |
| Broadcast-Klammer | wie Nachrichten | Erstellung | `expires_at` |
| Sitzungen | max. {{14}} Tage, Leerlauf {{8}} h | Anmeldung / letzte Aktivität | Job; Abmelden löscht sofort |
| Audit-Log | {{365}} Tage (mind. 30) | Ereignis | Job (SQL), Hash-Kette beginnt ab ältestem verbliebenen Eintrag |
| Request-Logs des Servers | 30 Tage | Anfrage | PocketBase-Einstellung, erzwungen beim Start |
| Konten ausgeschiedener Mitarbeitender | Deaktivierung am letzten Arbeitstag; Anonymisierung nach {{180}} Tagen | Deaktivierung (`deactivated_at`) | Job `anonymizeLongDeactivated`; manuell sofort möglich |
| Backups | {{30}} Tage | Erstellung | `backup.sh` (`KEEP_DAYS`) |
| Lokale Daten auf dem PC | bei Abmeldung (gespeicherte Sitzung) bzw. Deinstallation | Abmeldung | App löscht gespeicherte Sitzung; Cache enthält keine Klartexte |

## 3. Ausscheiden von Mitarbeitenden

1. Am letzten Arbeitstag: Konto **deaktivieren** (wirkt sofort auf allen Geräten). Gesprächspartner sehen „Konto deaktiviert“.
2. Nach {{180}} Tagen (konfigurierbar) automatische **Anonymisierung**: Name → „Ehemaliges Konto“, Benutzername zufällig, Avatar, Schlüssel, Einstellungen, 2FA, Lesebestätigungen und Sitzungen werden gelöscht. Nachrichten bleiben für die Gesprächspartner, bis ihre Aufbewahrungsfrist abläuft (Begründung: Die Partner haben ein eigenes Interesse an der Kommunikation; Inhalte sind ohnehin nur für sie lesbar; die Frist ist kurz).
3. Alternativ **sofortige Löschung** (Admin: „Konto löschen“): Konto und alle 1:1-Chats der Person inkl. Nachrichten werden entfernt – auch für die Gesprächspartner. Einsatz z. B. auf Löschverlangen nach Art. 17, wenn keine Interessen Dritter entgegenstehen.

Begründung der Wahl „Anonymisieren statt sofort löschen“ als Standard: Abwägung zwischen dem Löschinteresse der ausgeschiedenen Person und dem Interesse der Kolleg:innen an laufenden Absprachen; die Zuordnung zur Person entfällt sofort mit der Anonymisierung.

## 4. Backups

Gelöschte Daten bleiben bis zum Ablauf der Backup-Frist in verschlüsselten Backups enthalten. Nach einer Wiederherstellung holt der Lösch-Job abgelaufene Fristen spätestens 5 Minuten nach dem Start automatisch nach (Fristen sind datumsbasiert). Manuelle Löschungen nach Art. 17, die nach dem Backup-Zeitpunkt erfolgten, sind nach einem Restore erneut auszuführen (Löschprotokoll = Audit-Log-Export vor dem Restore sichern).

## 5. Löschprotokoll

Lösch- und Anonymisierungsvorgänge werden im Audit-Log dokumentiert (`admin.user_deleted`, `admin.user_anonymized`, `system.retention_cleanup` mit Anzahlen, ohne Inhalte).

## 6. Verantwortlichkeiten

| Aufgabe | Verantwortlich |
|---|---|
| Fristen festlegen/prüfen | Praxisleitung + DSB |
| Deaktivierung bei Ausscheiden | Admin auf Meldung der Personalverwaltung |
| Prüfung der Löschläufe (Audit) | Admin, quartalsweise |
| Backup-Aufbewahrung | Betrieb/IT |
