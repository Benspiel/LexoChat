# LexiChat – Betriebshandbuch

> Stand: Phase 2 (Server + Admin-Web-App). Abschnitte zur Windows-App folgen in Phase 3.

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

```bash
git clone <repo> /opt/lexichat && cd /opt/lexichat/deploy
cp .env.example .env && chmod 600 .env
openssl rand -base64 48            # -> LEXICHAT_SERVER_SECRET in .env
$EDITOR .env                       # Domains, E-Mail, Origins
# Admin-Web-App bauen (auf einem Build-Rechner mit Node 22 + pnpm, oder direkt auf dem Server):
(cd .. && corepack enable && pnpm install --frozen-lockfile && pnpm build:admin)
rm -rf admin-web-dist && cp -r ../apps/admin-web/dist admin-web-dist
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

**Restore-Test:** mindestens halbjährlich auf einem separaten System durchführen und protokollieren (Datum, Backup-Datei, Ergebnis, Person). Status: in der Entwicklungsumgebung wurde der Inhalt eines Backups erfolgreich entpackt und die Audit-Kette geprüft; ein vollständiger Restore-Test mit Docker steht noch aus (Phase 6).

## 5a. Admin-Web-App aktualisieren

```bash
cd /opt/lexichat && git pull && pnpm install --frozen-lockfile && pnpm build:admin
rm -rf deploy/admin-web-dist && cp -r apps/admin-web/dist deploy/admin-web-dist
```
Caddy liefert die neuen Dateien sofort aus (`index.html` wird nicht gecacht).

## 6. Notfälle

| Situation | Vorgehen |
|---|---|
| Admin hat Authenticator-Gerät verloren | Zweiter Admin: Benutzer → Verwalten → „2FA zurücksetzen“. Danach bei der nächsten Anmeldung neu einrichten. |
| `LEXICHAT_SERVER_SECRET` musste geändert werden | Alle 2FA-Einrichtungen werden ungültig (verschlüsselte Secrets). Per Superuser-Dashboard bei allen Admins `totp_enabled` auf false setzen, danach neu einrichten lassen. |
| Person hat Passwort vergessen | Admin: „Passwort zurücksetzen“ → Einmalpasswort persönlich übergeben. Mit Wiederherstellungsschlüssel bleiben alte Nachrichten lesbar, sonst nicht. |
| Gerät verloren/gestohlen | Admin: Sitzungen der Person beenden (oder Konto deaktivieren). Wirkt sofort. |
| Admin ausgesperrt, anderer Admin vorhanden | Zweiter Admin setzt das Passwort zurück. |
| Alle Admins ausgesperrt | Per SSH-Tunnel als Superuser im Dashboard `must_change_password` prüfen bzw. – falls kein Superuser existiert – `superuser upsert` ausführen, dann im Dashboard einem Konto die Rolle `admin` geben und anschließend über die Admin-Web-App ein neues Einmalpasswort setzen. Vorgang dokumentieren. |
| Verdacht auf Serverkompromittierung | Incident-Response-Plan (`docs/datenschutz/08-…`, Phase 5): Server vom Netz, Beweise sichern, neu aufsetzen, Backup prüfen, alle Passwörter ändern lassen, Meldepflicht Art. 33 DSGVO prüfen (72 h). |
| Audit-Kette meldet Fehler | Als Sicherheitsvorfall behandeln (Manipulation der Datenbank möglich). |

## 7. Monitoring (ohne personenbezogene Daten)

- `docker compose ps` / Healthcheck (`/api/health`), Speicherplatz, Zertifikatslaufzeit.
- Externes Uptime-Monitoring nur auf `/api/health` (enthält keine Daten).
- Audit-Log regelmäßig in der Admin-Web-App sichten (gehäufte `auth.account_locked`, `admin.user_password_reset`).
