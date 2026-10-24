# LexiChat auf Windows mit Docker

Der komplette Server (LexiChat-Server + Caddy-Webserver + Admin-Web-App) läuft mit ganz normalem **Docker Compose** – auf Windows mit Docker Desktop genauso wie auf Linux. Node, Go oder pnpm braucht es nicht; alles wird in Docker gebaut. Eine Konfigurationsdatei ist für den Start **nicht** nötig.

## Voraussetzungen

- **Docker Desktop** (WSL-2-Backend) ist installiert und läuft: <https://www.docker.com/products/docker-desktop/>
- Ports **80** und **443** sind frei (kein IIS oder anderer Webserver).
- Der LexiChat-Ordner liegt auf dem PC (Git-Clone oder ZIP von GitHub entpackt).

## Starten

Im LexiChat-Ordner (PowerShell oder Eingabeaufforderung):

```powershell
docker compose up -d --build
```

Das war's. Der erste Build dauert einige Minuten. Danach:

| Was | Adresse |
|---|---|
| Admin-Web-App | <https://admin.localhost> |
| Server für die Windows-App | `https://chat.localhost` |

Ohne Konfiguration nutzt Caddy ein eigenes, lokales Zertifikat und der Server erzeugt beim ersten Start ein zufälliges Geheimnis (gespeichert im Daten-Volume). LexiChat startet mit Docker Desktop automatisch wieder (`restart: unless-stopped`).

`docker compose` funktioniert im Hauptordner und in `deploy\` gleich – es ist dasselbe Projekt mit denselben Daten.

## Erstes Admin-Konto

```powershell
docker compose exec server /app/lexichat bootstrap-admin --dir /pb_data --username praxisadmin --name "Praxis-Administration"
```

Das Einmalpasswort erscheint **nur einmal** – notieren. Dann <https://admin.localhost> öffnen, anmelden, eigenes Passwort und Zwei-Faktor-Anmeldung einrichten.

## Zertifikat vertrauen (lokales Zertifikat)

Damit Browser und Windows-App dem lokalen Zertifikat vertrauen:

```powershell
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt lexichat-root.crt
Import-Certificate -FilePath lexichat-root.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Windows fragt nach – mit **Ja** bestätigen. (Alternativ `lexichat-root.crt` doppelklicken → „Zertifikat installieren“ → „Vertrauenswürdige Stammzertifizierungsstellen“.)

## Nützliche Befehle

| Was | Befehl |
|---|---|
| Status | `docker compose ps` |
| Protokolle | `docker compose logs --tail 200` |
| Stoppen (Daten bleiben) | `docker compose stop` |
| Wieder starten | `docker compose start` |
| Update nach neuem Code | `docker compose up -d --build` |
| Alles inkl. Daten löschen | `docker compose down -v` ⚠️ |

## Eigene Domain / Praxisnetz

Für mehr als „nur dieser PC“ die Datei `deploy\.env.example` nach `deploy\.env` kopieren und anpassen (danach `docker compose up -d`):

- **Praxisnetz ohne Internet-Domain:** `LEXICHAT_DOMAIN`, `LEXICHAT_ADMIN_DOMAIN` setzen und `LEXICHAT_TLS=internal`. Beide Namen müssen im Router/DNS oder in der `hosts`-Datei der PCs auf die IP dieses PCs zeigen; das Zertifikat (siehe oben) auf jedem PC installieren; in der Windows-Firewall eingehend TCP 80/443 erlauben.
- **Öffentliche Domain:** zusätzlich `ACME_EMAIL` setzen und `LEXICHAT_TLS=` leer lassen → Let's-Encrypt-Zertifikat. DNS auf die öffentliche IP, Ports 80/443 im Router weiterleiten.

`LEXICHAT_APP_URL`, `LEXICHAT_ADMIN_ORIGIN` und `LEXICHAT_ALLOWED_ORIGINS` werden aus den Domains abgeleitet, wenn sie nicht gesetzt sind.

## Windows-App

Die Windows-App wird fest mit der Server-Adresse gebaut (Schutz gegen Phishing):

```powershell
$env:LEXICHAT_SERVER = "https://chat.localhost"
pnpm --filter @lexichat/desktop build:windows
```

Mitarbeitende melden sich in der App **einmal** mit Benutzername und Passwort an. Danach öffnet sich LexiChat auf diesem PC ohne Passwort – auch nach einem Neustart. Die Anmeldung liegt DPAPI-geschützt im Windows-Anmeldeinformationsspeicher des jeweiligen Windows-Kontos und endet erst durch „Abmelden“, eine Passwortänderung, einen Admin-Reset, die Deaktivierung des Kontos, „Sitzung beenden“ in der Sitzungsliste oder nach 365 Tagen ohne Nutzung.

**Wichtig:** Weil das Passwort nicht mehr abgefragt wird, schützt die **Windows-Anmeldung** den Zugang. Jede Person braucht ein eigenes Windows-Konto (kein Sammelkonto), und die automatische Bildschirmsperre sollte per GPO aktiv sein.

## Backup

Die Daten (inkl. des erzeugten Server-Geheimnisses) liegen im Docker-Volume `lexichat_pb_data`. Die Backup-Skripte unter `deploy\scripts` sind für Linux (bash + `age`); unter Windows laufen sie in WSL. Ein eigenes Windows-Backup gibt es noch nicht.

## Getestet

Unter Linux mit Docker Engine geprüft: `docker compose up` ohne `.env` aus dem Hauptordner und aus `deploy/` (gleiches Projekt, gleiche Volumes), Healthcheck, HTTPS auf `chat.localhost`/`admin.localhost` mit lokalem Zertifikat, Admin-Web-App, `bootstrap-admin`, Geheimnis bleibt über Neustarts gleich. Auf echtem Windows mit Docker Desktop wurde es **nicht** ausprobiert.
