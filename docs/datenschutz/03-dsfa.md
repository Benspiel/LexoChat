# Datenschutz-Folgenabschätzung (Art. 35 DSGVO) – LexiChat

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

## 1. Notwendigkeit

Eine DSFA wird durchgeführt, weil

- Nachrichten Gesundheitsdaten (Art. 9 DSGVO) enthalten können und Berufsgeheimnisse (§ 203 StGB) betroffen sind,
- Beschäftigtendaten verarbeitet werden (Abhängigkeitsverhältnis, Gefahr der Verhaltenskontrolle),
- eine neue Technologie (Messenger mit Ende-zu-Ende-Verschlüsselung) eingeführt wird.

Ob die Schwelle „umfangreiche Verarbeitung“ (Art. 35 Abs. 3 lit. b) bei einer einzelnen Praxis erreicht ist, ist **unsicher**; die DSFA wird vorsorglich durchgeführt. Die Muss-Liste der zuständigen Aufsichtsbehörde ({{ZUSTAENDIGE_AUFSICHTSBEHOERDE}}) ist zu prüfen.

## 2. Systematische Beschreibung

Siehe [Verarbeitungsverzeichnis](02-verarbeitungsverzeichnis.md) und [Architektur](../00-architektur.md). Kernpunkte:

- Server (PocketBase, selbst gehostet bei {{HOSTING_ANBIETER}} in DE/EU), Admin-Web-App (nur Kontoverwaltung), Windows-App (Chat).
- Nachrichteninhalte werden auf dem Endgerät verschlüsselt (X25519/XChaCha20-Poly1305, Ed25519-Signaturen). Der Server speichert nur Chiffretexte.
- Das Passwort verlässt das Gerät nie; der Server erhält nur einen per Argon2id abgeleiteten Anmeldeschlüssel.

## 3. Notwendigkeit und Verhältnismäßigkeit

| Grundsatz | Umsetzung |
|---|---|
| Zweckbindung | ausschließlich dienstliche Kommunikation; keine Auswertung zur Leistungskontrolle |
| Datenminimierung | keine E-Mail-Adresse nötig, keine Telefonnummer, keine Kontaktlisten-Synchronisation; kein `last_login`-Feld; IP nur als gekürzter HMAC; Lesebestätigung/Tipp-/Online-Status standardmäßig aus und nur gegenseitig |
| Speicherbegrenzung | automatische Löschung von Nachrichten, Sitzungen, Audit, Backups; Anonymisierung deaktivierter Konten |
| Richtigkeit | Beschäftigte pflegen Anzeigename/Avatar selbst; Admins Rolle/Status |
| Integrität/Vertraulichkeit | siehe Abschnitt 5 und [TOMs](04-toms.md) |
| Transparenz | Datenschutzhinweise, Hinweis beim ersten Start der App |
| Betroffenenrechte | Selbstauskunft in der App, Export/Anonymisierung im Admin-UI |

Alternativen: Öffentliche Messenger (z. B. mit US-Bezug, Kontaktlisten-Upload) wurden verworfen (Drittland, fehlende Kontrolle, § 203 StGB). Für Kommunikation mit Patient:innen/anderen Leistungserbringern ist der TI-Messenger vorgesehen; LexiChat ist ausdrücklich nur intern.

## 4. Risiken für die Rechte und Freiheiten

| # | Risiko | Eintritt (vor Maßnahmen) | Schwere | Maßnahmen | Restrisiko |
|---|---|---|---|---|---|
| R1 | Unbefugte Kenntnis von Patientendaten durch Server-/Hoster-Kompromittierung | mittel | sehr hoch | E2EE, Zero-Knowledge-Passwort, Härtung, verschlüsselte Backups, Volume-Verschlüsselung | **gering** (Metadaten bleiben sichtbar) |
| R2 | Kenntnis durch Admins | mittel | hoch | Admins sehen keine Inhalte; können keine Schlüssel setzen; Audit-Log; Schlüsselwechsel-Warnung bei Missbrauch des Passwort-Resets | gering |
| R3 | Verlust/Diebstahl eines Arbeitsplatz-PCs | mittel | hoch | App-Sperre, Sitzungswiderruf, verschlüsselter Cache, BitLocker (organisatorisch) | gering–mittel |
| R4 | Shoulder Surfing / Benachrichtigungen | hoch | mittel | Benachrichtigungen ohne Inhalt, Vorschau aus, Sperre, Bildschirmschutz optional | gering |
| R5 | Verhaltens-/Leistungskontrolle der Beschäftigten | mittel | mittel | Privacy by Default, Gegenseitigkeit bei Online-/Tipp-Status, keine Login-Historie, Zweckbindung in Nutzungsrichtlinie/BV | gering |
| R6 | Fehlversand (falsche Person, Broadcast) | mittel | hoch | Bestätigungsdialog mit Personenzahl, Löschen für alle, Schulung | mittel (gesendete Inhalte können gelesen worden sein) |
| R7 | Datenverlust (Schlüsselverlust, Serverausfall) | mittel | mittel | Wiederherstellungsschlüssel, tägliche verschlüsselte Backups, Restore-Prozess | gering |
| R8 | Kompromittierung privater Schlüssel (Malware) | gering | sehr hoch | Endpoint-Schutz, Updates, kurze Aufbewahrung; **keine Forward Secrecy** | mittel |
| R9 | Missbrauch für Dokumentation statt PVS (Unvollständigkeit der Patientenakte) | mittel | mittel | Nutzungsrichtlinie, Hinweis beim ersten Start, Auto-Löschung | gering–mittel |
| R10 | Unbefugte Anmeldung (Passwort-Raten) | mittel | hoch | Argon2id, Sperre mit Backoff, Rate-Limits, 2FA (Pflicht für Admins, optional für Nutzer) | gering |

## 5. Abhilfemaßnahmen

Vollständige Liste: [TOMs](04-toms.md), [Bedrohungsmodell](../01-bedrohungsmodell.md).

Organisatorisch zusätzlich erforderlich (Verantwortung der Praxis):

1. Festplattenverschlüsselung (BitLocker) und Bildschirmsperre auf allen Arbeitsplätzen.
2. Mindestens zwei Admins, Vier-Augen-Prinzip bei Passwort-Resets, Identitätsprüfung.
3. Schulung zur Nutzungsrichtlinie vor Freischaltung.
4. AV-Verträge mit Hoster/IT-Dienstleister; Verpflichtung auf § 203 StGB.
5. Halbjährlicher Restore-Test, jährliche Überprüfung dieser DSFA.
6. Beteiligung des Betriebsrats, sofern vorhanden (§ 87 Abs. 1 Nr. 6 BetrVG).

## 6. Ergebnis

Nach Umsetzung der Maßnahmen wird das Restrisiko als **{{gering / vertretbar}}** bewertet. Eine vorherige Konsultation der Aufsichtsbehörde (Art. 36) ist {{nicht}} erforderlich.

Stellungnahme DSB: {{…}}
Freigabe Verantwortlicher: {{Name, Datum, Unterschrift}}
Nächste Überprüfung: {{DATUM + 12 Monate}} bzw. bei wesentlichen Änderungen.
