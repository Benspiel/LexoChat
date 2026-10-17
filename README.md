# LexiChat

Interner, Ende-zu-Ende-verschlüsselter Messenger für Arztpraxen (1:1-Chats und Broadcasts).

> **Status: Phase 2.** Server, Rechtekonzept, Deployment, Sicherheitsdokumentation und Admin-Web-App (inkl. 2FA) sind umgesetzt. Die Windows-App folgt in Phase 3. Nicht produktiv einsetzen, bevor alle Phasen abgeschlossen und die Datenschutzdokumente geprüft sind.

| Komponente | Technik | Ort |
|---|---|---|
| Server | PocketBase v0.40.5 als Go-Bibliothek + LexiChat-Hooks | `apps/server` |
| Admin-Web-App | React + Vite | `apps/admin-web` |
| Windows-App | Tauri v2 + React | `apps/desktop` (Phase 3) |
| Deployment | Docker Compose, Caddy (TLS 1.3, Rate-Limits) | `deploy` |

## Dokumentation

- [Architektur und Annahmen](docs/00-architektur.md)
- [Bedrohungsmodell (STRIDE)](docs/01-bedrohungsmodell.md)
- [Rechtekonzept / API-Rules](docs/02-rechtekonzept.md)
- [Design-System](docs/03-design-system.md)
- [Betriebshandbuch](docs/betriebshandbuch.md)

## Entwicklung

```bash
cd apps/server
go test ./...                      # inkl. API-Rule-Tests gegen echte PocketBase-Instanzen
LEXICHAT_SERVER_SECRET=$(openssl rand -base64 48) go run . serve --dev
```
Go 1.27.2 wird über `toolchain` in `go.mod` automatisch geladen (`GOTOOLCHAIN=auto`).

```bash
corepack enable && pnpm install
pnpm typecheck && pnpm test         # TS-Pakete (KDF-Testvektor, Passwort-Policy, API-Client, Kontraste)
pnpm --filter @lexichat/admin-web dev   # http://localhost:5173, API-Proxy auf 127.0.0.1:8090
pnpm e2e:admin                      # baut Server + Web-App, Playwright inkl. axe und Produktions-CSP
```
