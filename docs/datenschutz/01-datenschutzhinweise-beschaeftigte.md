# Datenschutzhinweise für Beschäftigte zur Nutzung von LexiChat (Art. 13 DSGVO)

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

## 1. Verantwortlicher

{{PRAXIS_NAME}}, {{ADRESSE}}, vertreten durch {{PRAXISINHABER}}
Telefon {{TELEFON}}, E-Mail {{EMAIL}}

## 2. Datenschutzbeauftragte(r)

{{DSB_KONTAKT}} (falls benannt; Pflicht u. a. nach § 38 BDSG ab 20 Personen, die ständig mit der automatisierten Verarbeitung personenbezogener Daten beschäftigt sind, oder bei Erforderlichkeit einer DSFA).

## 3. Zweck der Verarbeitung

LexiChat ist der interne Messenger der Praxis für die dienstliche Kommunikation zwischen Beschäftigten (1:1-Nachrichten und Rundnachrichten/„Broadcasts“). Verarbeitet werden Ihre Daten,

- um Ihnen ein Konto bereitzustellen und Sie sicher anzumelden,
- um Nachrichten zuzustellen,
- um den Dienst vor Missbrauch zu schützen (Anmeldeschutz, Protokollierung von Verwaltungs- und Sicherheitsereignissen),
- um Ihre Betroffenenrechte zu erfüllen.

Eine Verhaltens- oder Leistungskontrolle ist **nicht** Zweck von LexiChat. Lesebestätigungen, Tipp-Anzeige und Online-Status sind standardmäßig ausgeschaltet; Anmeldezeitpunkte werden nicht als Liste ausgewertet.

## 4. Kategorien personenbezogener Daten

| Kategorie | Daten | Wo |
|---|---|---|
| Kontodaten | Benutzername, Anzeigename, optional Avatar, Rolle, Status (aktiv/deaktiviert) | Server |
| Sicherheitsdaten | abgeleiteter, gehashter Anmeldeschlüssel (nicht Ihr Passwort), Salt, öffentliche Schlüssel, verschlüsselte private Schlüssel, verschlüsseltes 2FA-Geheimnis, Fehlversuchszähler | Server |
| Sitzungen | Gerätebezeichnung, Anmeldezeitpunkt, „zuletzt aktiv“, gekürzter Hashwert der IP-Adresse | Server |
| Nachrichten | **Ende-zu-Ende-verschlüsselte** Inhalte (für den Server nicht lesbar), Absender, Chat, Zeitpunkt, Bearbeitungszeitpunkt | Server (verschlüsselt), Endgeräte (Klartext) |
| Zustellung | Zeitpunkt der Zustellung, optional Lesezeitpunkt (nur wenn Sie Lesebestätigungen einschalten) | Server |
| Einstellungen | Ihre Privatsphäre-Einstellungen | Server |
| Audit-Log | Verwaltungs- und Sicherheitsereignisse (z. B. Anmeldung, Fehlversuch, Passwortänderung, Kontosperre) ohne Nachrichteninhalte | Server |
| Lokale Daten | Verschlüsselter Zwischenspeicher (bekannte Sicherheitsnummern, Lesestand), optional gespeicherte Sitzung im Windows-Anmeldeinformationsspeicher | Ihr Arbeitsplatz-PC |

Nachrichten können Gesundheitsdaten von Patientinnen und Patienten enthalten (besondere Kategorien, Art. 9 DSGVO). Hierfür gelten die Nutzungsrichtlinie und die Schweigepflicht.

## 5. Rechtsgrundlagen

- Durchführung des Beschäftigungsverhältnisses: Art. 6 Abs. 1 lit. b, Art. 88 DSGVO i. V. m. § 26 Abs. 1 BDSG {{HINWEIS: Nach dem EuGH-Urteil vom 30.03.2023 (C-34/21) ist die Anwendbarkeit von § 26 Abs. 1 BDSG umstritten; ggf. ergänzend Art. 6 Abs. 1 lit. b/c/f DSGVO – juristisch prüfen lassen}}.
- Sicherheit der Verarbeitung und Missbrauchsschutz: Art. 6 Abs. 1 lit. c i. V. m. Art. 32 DSGVO, Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem sicheren Betrieb).
- Gesundheitsdaten Dritter in Nachrichten: Art. 9 Abs. 2 lit. h, Abs. 3 DSGVO i. V. m. § 22 Abs. 1 Nr. 1 lit. b BDSG (Versorgung im Gesundheitsbereich durch schweigepflichtiges Personal).
- {{Falls Betriebsvereinbarung: Art. 88 DSGVO i. V. m. § 26 Abs. 4 BDSG und die Betriebsvereinbarung vom {{DATUM}}}}

Eine Einwilligung ist nicht erforderlich.

## 6. Empfänger

- Administratorinnen und Administratoren der Praxis (nur Konto- und Audit-Daten, **keine Nachrichteninhalte**).
- IT-Dienstleister/Hoster als Auftragsverarbeiter (Art. 28 DSGVO): {{HOSTING_ANBIETER}}, {{IT_DIENSTLEISTER}}. Sie sehen höchstens verschlüsselte Inhalte.
- Keine Übermittlung in Drittländer. Keine Analyse-, Tracking- oder Werbedienste.

## 7. Speicherdauer

| Daten | Dauer |
|---|---|
| Nachrichten | automatische Löschung nach {{AUFBEWAHRUNG_NACHRICHTEN}} Tagen (Standard 90) |
| Sitzungen | bis Abmeldung, max. {{SITZUNG_MAX}} Tage bzw. nach {{LEERLAUF}} Stunden Inaktivität |
| Audit-Log | {{AUFBEWAHRUNG_AUDIT}} Tage (Standard 365) |
| Server-Protokolle (Requests) | 30 Tage, ohne IP-Adresse |
| Konto | bis zum Ausscheiden; danach Deaktivierung und Anonymisierung nach {{FRIST_ANONYMISIERUNG}} Tagen (Standard 180) |
| Backups | {{BACKUP_AUFBEWAHRUNG}} Tage (Standard 30), verschlüsselt |

Details: [Löschkonzept](05-loeschkonzept.md).

## 8. Ihre Rechte

Sie haben das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21 DSGVO). Eine Datenauskunft können Sie selbst in der App unter „App und Daten → Meine Daten exportieren“ erstellen. Ablauf: [Betroffenenrechte](13-betroffenenrechte.md).

Sie können sich bei einer Datenschutz-Aufsichtsbehörde beschweren, insbesondere bei {{ZUSTAENDIGE_AUFSICHTSBEHOERDE}}.

## 9. Pflicht zur Bereitstellung

Die Nutzung von LexiChat ist für die dienstliche Kommunikation {{vorgesehen/verpflichtend gemäß Dienstanweisung}}. Ohne Konto ist die Teilnahme an der Kommunikation über LexiChat nicht möglich.

## 10. Keine automatisierte Entscheidungsfindung

Es findet keine automatisierte Entscheidungsfindung einschließlich Profiling statt. Die automatische, vorübergehende Kontosperre nach mehreren falschen Anmeldeversuchen dient allein der Sicherheit und kann von der Verwaltung aufgehoben werden.

Stand: {{DATUM}}
