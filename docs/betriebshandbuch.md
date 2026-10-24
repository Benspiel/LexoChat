# LexiChat – Betriebshandbuch

> Stand: Phase 6 (Server, Admin-Web-App, Windows-App).

## 1. Voraussetzungen

- Linux-Server (z. B. Debian 12/13) bei einem Hoster in Deutschland/EU, **Auftragsverarbeitungsvertrag** abgeschlossen.
- **Festplattenverschlüsselung** (LUKS) für das Docker-Datenverzeichnis bzw. das gesamte System.
- Docker Engine + Compose-Plugin, `age` (für Backups), `ufw` o. ä., `fail2ban` für SSH.
- DNS: `LEXICHAT_DOMAIN` und `LEXICHAT_ADMIN_DOMAIN` zeigen auf den Server.

### Firewall (Beispiel ufw)
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # besser: nur aus dem Praxis-/VPN-Netz
ufw allow 80/tcp      # ACME + Redirect
ufw allow 443/tcp
ufw enable
```
Hinweis: Docker veröffentlicht Ports an ufw vorbei. Der PocketBase-Port ist deshalb in `docker-compose.yml` nur an `127.0.0.1` gebunden.

### fail2ban (SSH)
```ini
# /etc/fail2ban/jail.d/sshd.local
[sshd]
enabled  = true
maxretry = 5
findtime = 10m
bantime  = 1h
```
SSH nur mit Schlüssel (`PasswordAuthentication no`, `PermitRootLogin no`).

## 2. Erstinstallation

> **Nur ausprobieren / Windows mit Docker Desktop?** `docker compose up -d --build` im Hauptordner reicht – ohne `.env` (lokale Adressen `chat.localhost`/`admin.localhost`, Server-Geheimnis wird automatisch erzeugt). Siehe [LexiChat auf Windows mit Docker](windows-docker.md).

```bash
git clone <repo> /opt/lexichat && cd /opt/lexichat/deploy
cp .env.example .env && chmod 600 .env
openssl rand -base64 48            # -> LEXICHAT_SERVER_SECRET in .env
$EDITOR .env                       # Domains, E-Mail, Origins
# die Admin-Web-App wird im Caddy-Image mitgebaut (kein Node/pnpm auf dem Server nötig)
docker compose up -d --build
docker compose ps                  # beide Dienste "healthy"/"running"
./scripts/create-first-admin.sh praxisadmin "Praxis-Administration"
```
Das Einmalpasswort erscheint **nur einmal** im Terminal. Erste Anmeldung unter `https://<LEXICHAT_ADMIN_DOMAIN>`:
1. Mit Einmalpasswort anmelden → persönliches Passwort festlegen → erneut anmelden.
2. Zwei-Faktor-Anmeldung einrichten (Authenticator-App auf dem Diensthandy, Pflicht für Admins).
3. Zweites Admin-Konto anlegen (Vertretung, Notfall).
Die Chat-Schlüssel des Admin-Kontos werden erst bei der ersten Anmeldung in der Windows-App erzeugt.

Optional (Notfallzugang): PocketBase-Superuser anlegen, Passwort im Tresor hinterlegen:
```bash
docker compose exec server /app/lexichat superuser upsert notfall@praxis.example '<langes-passwort>' --dir /pb_data
```
Dashboard nur per SSH-Tunnel: `ssh -L 8090:127.0.0.1:8090 admin@server` → `http://localhost:8090/_/`.

## 3. Updates

```bash
cd /opt/lexichat && git pull
cd deploy && ./scripts/backup.sh          # vor jedem Update
docker compose build --pull && docker compose up -d
docker compose exec server /app/lexichat verify-audit --dir /pb_data
```
Migrationen laufen beim Start automatisch. PocketBase-Updates vorher lokal testen (Changelog lesen; v0.40 hat z. B. auf `encoding/json/v2` umgestellt).

## 4. Backup

- Einmalig: Schlüsselpaar **auf einem anderen Rechner** erzeugen: `age-keygen -o age-identity.txt` (privat, offline/Tresor, zweite Kopie getrennt aufbewahren). Die Zeile `# public key: age1…` als `/etc/lexichat/age-recipients.txt` auf den Server legen.
- Täglich per Cron: `./scripts/backup.sh` (Backup wird direkt aus dem Container in `age` gestreamt, kein Klartext auf dem Host; Aufbewahrung `KEEP_DAYS`, Standard 30).
- Backups zusätzlich auf ein zweites System in der EU kopieren (z. B. `rsync`), AV-Vertrag beachten.

## 5. Wiederherstellung (Restore)

```bash
./scripts/restore.sh /srv/lexichat-backups/lexichat-<ts>.zip.age /pfad/age-identity.txt
```
Das Skript prüft die Prüfsumme, sichert den aktuellen Stand verschlüsselt, spielt das Backup ein und prüft die Audit-Kette. Danach Test-Anmeldung.

**Restore-Test:** mindestens halbjährlich auf einem separaten System durchführen und protokollieren.

| Datum | Backup-Datei | Umgebung | Schritte | Ergebnis | Person |
|---|---|---|---|---|---|
| 2026-10 (Entwicklung) | Test-Backup, mit `age` verschlüsselt | Entwicklungsumgebung, Server-Binary **ohne Docker** | Backup über die API gestreamt → `age`-verschlüsselt (kein ZIP-Header im Chiffrat sichtbar) → entschlüsselt → in leeres `pb_data` entpackt → Server gestartet | `/api/health` 200; Prelogin liefert gespeicherten Salt; `verify-audit` intakt; automatisierter Test `TestBackupRestoreRoundtrip` (Nachricht vorhanden, Anmeldung und Lesen funktionieren, Audit-Kette gültig) grün | Entwicklung |
| 2026-10-17 (Entwicklung) | `lexichat-20261017T193026Z.zip.age` (Test) | Docker Compose lokal, Testdomains `chat.localhost`/`admin.localhost` | `create-first-admin.sh` → `backup.sh` → Änderung (Notfall-Superuser angelegt) → `restore.sh` | Prüfsumme OK, vorheriger Stand verschlüsselt gesichert, Änderung nach Restore entfernt, Admin-Konto vorhanden, Audit-Kette intakt, Health 200 | Entwicklung |
| | | Produktivserver | | **ausstehend** – vor Produktivstart auf dem echten Server wiederholen | |


## 5a. Admin-Web-App aktualisieren

```bash
cd /opt/lexichat && git pull && cd deploy && docker compose up -d --build caddy
```
Die Admin-Web-App ist Teil des Caddy-Images (`deploy/caddy/Dockerfile`); `index.html` wird nicht gecacht.

## 5b. Windows-App bauen, signieren und verteilen

**Einmalig (Betreiber):**
1. **Update-Schlüssel** auf einem sicheren Rechner erzeugen: `pnpm --filter @lexichat/desktop tauri signer generate -w lexichat-updater.key`. Privaten Schlüssel + Passwort nur im Secret-Store ablegen (GitHub-Secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), öffentlichen Schlüssel als `LEXICHAT_UPDATER_PUBKEY`. **Geht der private Schlüssel verloren, können installierte Apps keine Updates mehr annehmen** (Neuinstallation nötig).
2. **Code-Signing-Zertifikat** (OV/EV, ausgestellt auf die Praxis) als Base64-PFX in `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD`. Ohne Signatur warnt Windows SmartScreen. EV-Zertifikate liegen meist auf einem Hardware-Token und lassen sich dann **nicht** in GitHub Actions nutzen – in dem Fall lokal auf einem Windows-Build-Rechner bauen (ich kann nicht beurteilen, welches Zertifikatsprodukt Sie wählen; bitte mit dem Anbieter klären).
3. `LEXICHAT_SERVER` = `https://<api-domain>` (wird fest in die App einkompiliert, inkl. CSP und Update-Endpunkt).

**Je Release:**
1. Version in `apps/desktop/src-tauri/tauri.conf.json` und `Cargo.toml` erhöhen.
2. GitHub → Actions → „Release Windows“ manuell starten (oder lokal auf Windows: `pnpm --filter @lexichat/desktop build:windows` mit denselben Umgebungsvariablen).
3. Artefakte (NSIS-Installer `*-setup.exe`, MSI, `.sig`-Dateien, `SHA256SUMS.txt`) herunterladen, Prüfsummen vergleichen.
4. Auf dem Server unter `deploy/updates/` ablegen: Installer + `latest.json`, z. B.
   ```json
   {
     "version": "1.0.1",
     "notes": "Fehlerbehebungen",
     "pub_date": "2026-10-17T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<Inhalt der .sig-Datei des NSIS-Installers>",
         "url": "https://<api-domain>/updates/LexiChat_1.0.1_x64-setup.exe"
       }
     }
   }
   ```
   Caddy liefert `deploy/updates/` unter `/updates/` aus. Die App prüft die Signatur mit dem einkompilierten öffentlichen Schlüssel; manipulierte Dateien werden abgelehnt.
5. Erstinstallation per Softwareverteilung/GPO (`msiexec /i LexiChat_….msi /qn`) oder NSIS-Installer (Installation für alle Benutzer).

**Empfohlene Windows-Einstellungen (GPO):**
- Benachrichtigungen auf dem Sperrbildschirm aus (Benutzerkonfiguration → Administrative Vorlagen → Startmenü und Taskleiste → Benachrichtigungen → „Popupbenachrichtigungen auf dem Sperrbildschirm deaktivieren“) – die genaue Bezeichnung kann je nach Windows-Version abweichen.
- BitLocker, automatische Bildschirmsperre, keine lokalen Admin-Rechte, Windows-Updates.

**Hinweis:** Die nativen Funktionen (Credential Manager, Toasts, Screenshot-Schutz, Tray, Autostart, Updater) wurden in der Entwicklungsumgebung nur gegen das Windows-Ziel kompiliert, **nicht auf echtem Windows ausgeführt**. Vor dem Rollout auf einem Test-PC prüfen: Anmeldung, „Einmal anmelden“ (nach PC-Neustart ohne Passwort im Chat), Toast ohne Inhalt, Screenshot zeigt schwarzes Fenster, Tray „Sperren“, Update von Version n auf n+1.

## 6. Notfälle

| Situation | Vorgehen |
|---|---|
| Admin hat Authenticator-Gerät verloren | Zweiter Admin: Benutzer → Verwalten → „2FA zurücksetzen“. Danach bei der nächsten Anmeldung neu einrichten. |
| `LEXICHAT_SERVER_SECRET` musste geändert werden | Alle 2FA-Einrichtungen werden ungültig (verschlüsselte Secrets). Per Superuser-Dashboard bei allen Admins `totp_enabled` auf false setzen, danach neu einrichten lassen. |
| Person hat Passwort vergessen | Admin: „Passwort zurücksetzen“ → Einmalpasswort persönlich übergeben. Mit Wiederherstellungsschlüssel bleiben alte Nachrichten lesbar, sonst nicht. |
| Gerät verloren/gestohlen | Admin: Sitzungen der Person beenden (oder Konto deaktivieren). Wirkt sofort. |
| Admin ausgesperrt, anderer Admin vorhanden | Zweiter Admin setzt das Passwort zurück. |
| Alle Admins ausgesperrt | Per SSH-Tunnel als Superuser im Dashboard `must_change_password` prüfen bzw. – falls kein Superuser existiert – `superuser upsert` ausführen, dann im Dashboard einem Konto die Rolle `admin` geben und anschließend über die Admin-Web-App ein neues Einmalpasswort setzen. Vorgang dokumentieren. |
| Verdacht auf Serverkompromittierung | Incident-Response-Plan (`docs/datenschutz/08-incident-response.md`): Server vom Netz, Beweise sichern, neu aufsetzen, Backup prüfen, alle Passwörter ändern lassen, Meldepflicht Art. 33 DSGVO prüfen (72 h). |
| Audit-Kette meldet Fehler | Als Sicherheitsvorfall behandeln (Manipulation der Datenbank möglich). |

## 7. Monitoring (ohne personenbezogene Daten)

- `docker compose ps` / Healthcheck (`/api/health`), Speicherplatz, Zertifikatslaufzeit.
- Externes Uptime-Monitoring nur auf `/api/health` (enthält keine Daten).
- Audit-Log regelmäßig in der Admin-Web-App sichten (gehäufte `auth.account_locked`, `admin.user_password_reset`).
