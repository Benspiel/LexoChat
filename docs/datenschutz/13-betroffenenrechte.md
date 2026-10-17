# Prozess Betroffenenrechte (Art. 15–21 DSGVO) – LexiChat

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

## 1. Eingang und Fristen

- Anträge formlos an {{Praxisleitung / DSB}}; Eingang mit Datum dokumentieren.
- Identität prüfen (bei Beschäftigten in der Regel bekannt; bei ehemaligen Beschäftigten Identitätsnachweis).
- Antwort **unverzüglich, spätestens innerhalb eines Monats** (Art. 12 Abs. 3), Verlängerung um zwei Monate nur mit Begründung.
- Kostenfrei; die Verwaltungsvorgänge (Export, Anonymisierung, Löschung) werden im Audit-Log festgehalten.

## 2. Umsetzung je Recht

| Recht | Technische Umsetzung in LexiChat | Wer |
|---|---|---|
| **Auskunft (Art. 15)** | Selbstbedienung: Windows-App → „App und Daten“ → „Meine Daten exportieren“ (JSON). Verwaltung: Admin-Web-App → Benutzer → Verwalten → „Datenauskunft (Art. 15)“. Der Export enthält Konto-, Sitzungs-, Chat-Metadaten, Lesebestätigungen und Audit-Einträge zur Person. Nachrichteninhalte kennt der Server nicht (E2EE) – die Person hat sie auf ihrem Gerät. | Person selbst / Admin |
| **Berichtigung (Art. 16)** | Anzeigename und Avatar ändert die Person selbst (Profil); Benutzername/Rolle durch Admin. | Person / Admin |
| **Löschung (Art. 17)** | Konto **anonymisieren** (Standard bei Ausscheiden) oder **löschen** (entfernt auch alle 1:1-Chats der Person). Einzelne Nachrichten: „Löschen für alle“ durch die absendende Person. Automatische Fristen siehe Löschkonzept. | Admin / Person |
| **Einschränkung (Art. 18)** | Konto deaktivieren (keine Anmeldung, Daten bleiben bis zur Klärung). | Admin |
| **Datenübertragbarkeit (Art. 20)** | JSON-Export (maschinenlesbar, `lexichat-export-v1`), siehe Art. 15. | Person / Admin |
| **Widerspruch (Art. 21)** | Gegen Verarbeitungen auf Grundlage berechtigter Interessen (z. B. Sicherheitsprotokollierung): Einzelfallprüfung durch DSB. Privatsphäre-Funktionen (Lesebestätigung, Online-Status) kann die Person selbst ausschalten. | DSB |

## 3. Grenzen und Abwägungen

- **Audit-Log**: Einträge werden nicht auf Verlangen gelöscht, solange sie zur Nachweisführung der Sicherheit erforderlich sind (Art. 17 Abs. 3 lit. b/e; Aufbewahrung {{365}} Tage).
- **Nachrichten anderer**: Löschen der eigenen Nachrichten ist möglich; Nachrichten anderer Personen an die betroffene Person werden mit Ablauf der Frist bzw. bei Kontolöschung entfernt.
- **Backups**: Gelöschte Daten verbleiben bis zum Ablauf der Backup-Frist ({{30}} Tage) in verschlüsselten Backups; keine gezielte Löschung aus Backups (unverhältnismäßig), Schutz durch Verschlüsselung und Fristablauf.

## 4. Dokumentation

| Nr. | Eingang | Person | Recht | Maßnahme | Erledigt am | Bearbeiter:in |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
