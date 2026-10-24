# LexiChat auf Windows mit Docker

Der komplette Server (LexiChat-Server + Caddy-Webserver + Admin-Web-App) läuft auf einem Windows-PC mit **Docker Desktop**. Node, Go oder pnpm braucht es dafür nicht – alles wird in Docker gebaut.

## Voraussetzungen

- Windows 10/11 (64 Bit) mit **Docker Desktop** (WSL-2-Backend): <https://www.docker.com/products/docker-desktop/>
- Docker Desktop ist gestartet („Engine running“).
- Ports **80** und **443** sind frei (kein IIS oder anderer Webserver).
- Der LexiChat-Ordner liegt auf dem PC (Git-Clone oder ZIP von GitHub entpackt).

## Starten (ein Doppelklick)

1. Ordner `deploy\windows` öffnen.
2. **`LexiChat-Starten.bat`** doppelklicken.
3. Beim ersten Start fragt das Skript:
   - **Server-Name** – einfach **Enter** = nur auf diesem PC testen (`https://chat.localhost`, Admin-Web-App `https://admin.localhost`). Oder einen Namen eingeben, z. B. `chat.praxis-mueller.de`.
   - Bei eigenem Namen: ob er **öffentlich im Internet** erreichbar ist (dann Let's-Encrypt-Zertifikat) oder nur im Praxisnetz (dann eigenes, internes Zertifikat).
4. Das Skript erzeugt `deploy\.env` (inkl. zufälligem Server-Geheimnis), baut und startet alles. Der erste Build dauert einige Minuten.
5. Bei internem Zertifikat fragt Windows, ob Sie der „Caddy Local Authority“ vertrauen – mit **Ja** bestätigen.
6. Zum Schluss wird das **erste Admin-Konto** angelegt. Das Einmalpasswort erscheint **nur einmal** im Fenster – notieren!
7. Admin-Web-App im Browser öffnen (Adresse steht am Ende im Fenster), mit dem Einmalpasswort anmelden, eigenes Passwort und Zwei-Faktor-Anmeldung einrichten.

Danach startet LexiChat mit Docker Desktop automatisch wieder (`restart: unless-stopped`).

## Weitere Befehle

| Was | Wie |
|---|---|
| Stoppen (Daten bleiben) | `LexiChat-Stoppen.bat` |
| Status | `powershell -ExecutionPolicy Bypass -File deploy\windows\LexiChat.ps1 status` |
| Protokolle | `... LexiChat.ps1 logs` |
| Weiteres Admin-Konto (nur wenn noch keins existiert) | `... LexiChat.ps1 admin` |
| Update (nach neuem Code) | `... LexiChat.ps1 update` |
| Lokales Zertifikat erneut installieren | `... LexiChat.ps1 zertifikat` |

Einstellungen ändern: `deploy\.env` bearbeiten (oder löschen und neu starten, dann wird erneut gefragt – das Server-Geheimnis ändert sich dabei).

## Andere Praxis-PCs

- **Nur dieser PC (`*.localhost`)** ist zum Ausprobieren gedacht – andere PCs erreichen ihn so nicht.
- **Praxisnetz mit internem Zertifikat:** Beide Namen (Server und `admin.…`) müssen im Router/DNS oder in der `hosts`-Datei der PCs auf die IP dieses PCs zeigen. Die Datei `deploy\lexichat-root.crt` auf jedem PC per Doppelklick unter **„Vertrauenswürdige Stammzertifizierungsstellen“** installieren. In der Windows-Firewall eingehend TCP 80 und 443 erlauben.
- **Öffentliche Domain:** DNS auf die öffentliche IP, Ports 80/443 im Router weiterleiten; Zertifikate kommen automatisch.

## Windows-App

Die Windows-App wird fest mit der Server-Adresse gebaut (Schutz gegen Phishing), z. B.:

```powershell
$env:LEXICHAT_SERVER = "https://chat.localhost"
pnpm --filter @lexichat/desktop build:windows
```

Mitarbeitende melden sich in der App **einmal** mit Benutzername und Passwort an. Danach öffnet sich LexiChat auf diesem PC ohne Passwort – auch nach einem Neustart. Die Anmeldung liegt DPAPI-geschützt im Windows-Anmeldeinformationsspeicher des jeweiligen Windows-Kontos. Sie endet erst durch „Abmelden“, eine Passwortänderung, einen Admin-Reset, die Deaktivierung des Kontos, „Sitzung beenden“ in der Sitzungsliste oder nach 365 Tagen ohne Nutzung.

**Wichtig:** Weil das Passwort nicht mehr abgefragt wird, schützt die **Windows-Anmeldung** den Zugang. Jede Person braucht ein eigenes Windows-Konto (kein Sammelkonto), und die automatische Bildschirmsperre sollte per GPO aktiv sein.

## Backup

Die Daten liegen im Docker-Volume `lexichat_pb_data`. Die Backup-Skripte unter `deploy\scripts` sind für Linux (bash + `age`). Unter Windows können sie in WSL ausgeführt werden; ein eigenes Windows-Backup-Skript gibt es noch nicht.

## Getestet

Der Docker-Stack (Build beider Images inkl. Admin-Web-App, Start, Healthcheck, HTTPS über `chat.localhost`/`admin.localhost` mit internem Zertifikat, `bootstrap-admin`) wurde unter Linux mit Docker Engine geprüft. Das PowerShell-Skript selbst konnte **nicht auf echtem Windows** ausgeführt werden – bitte beim ersten Einsatz auf einem Test-PC prüfen.
