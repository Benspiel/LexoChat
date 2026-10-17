# Impressum-Vorlage und Hinweistexte für die Admin-Web-App

> **Entwurf – ersetzt keine Rechtsberatung. Vor Produktivbetrieb durch Datenschutzbeauftragte(n)/Rechtsanwalt prüfen lassen.**

## 1. Impressum (§ 5 DDG)

Ob für eine **nicht öffentlich** beworbene, nur für Beschäftigte zugängliche Verwaltungsoberfläche eine Impressumspflicht besteht, ist zweifelhaft (keine „geschäftsmäßigen“ Telemedien gegenüber der Allgemeinheit). Vorsorglich:

> **Impressum**
> {{PRAXIS_NAME}}, {{ADRESSE}}
> Vertreten durch: {{PRAXISINHABER}}
> Kontakt: {{TELEFON}}, {{EMAIL}}
> Berufsbezeichnung: {{Ärztin/Arzt}}, verliehen in {{Deutschland}}; zuständige Kammer: {{Ärztekammer}}; Berufsordnung: {{Link}}
> Zuständige Kassenärztliche Vereinigung: {{KV}}
> Aufsichtsbehörde Datenschutz: {{ZUSTAENDIGE_AUFSICHTSBEHOERDE}}

## 2. Hinweis zu Cookies und Speicherung (Admin-Web-App)

Bereits in der Fußzeile der Admin-Web-App umgesetzt:

> „Datenschutz: Diese Oberfläche setzt keine Cookies und speichert nichts im Browser. Die Anmeldung besteht nur im Arbeitsspeicher dieses Tabs und endet beim Schließen.“

Technischer Hintergrund: Die Anmeldung wird ausschließlich im Arbeitsspeicher gehalten (kein Cookie, kein `localStorage`/`sessionStorage`), es werden keine Dritt-Ressourcen geladen (keine CDNs, Schriften lokal). Ein Cookie-Banner ist daher nicht erforderlich (§ 25 TDDDG greift mangels Speicherung/Zugriff auf Endgeräteinformationen nicht; selbst dann wäre es „unbedingt erforderlich“).

## 3. Hinweis auf der Anmeldeseite (optional)

> „Zugang nur für berechtigte Administratorinnen und Administratoren der {{PRAXIS_NAME}}. Anmeldungen und Verwaltungsaktionen werden zur Sicherheit protokolliert. Informationen zum Datenschutz: {{Link zu den Datenschutzhinweisen für Beschäftigte}}.“
