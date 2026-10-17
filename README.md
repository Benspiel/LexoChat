# LexiChat

Interner, Ende-zu-Ende-verschlüsselter Messenger für Arztpraxen (1:1-Chats und Broadcasts).

> **Status: Phase 1 (Fundament).** Server, Rechtekonzept, Deployment und Sicherheitsdokumentation sind umgesetzt. Admin-Web-App (Phase 2) und Windows-App (Phase 3) folgen. Nicht produktiv einsetzen, bevor alle Phasen abgeschlossen und die Datenschutzdokumente geprüft sind.

| Komponente | Technik | Ort |
|---|---|---|
| Server | PocketBase v0.40.5 als Go-Bibliothek + LexiChat-Hooks | `apps/server` |
| Admin-Web-App | React + Vite | `apps/admin-web` (Phase 2) |
| Windows-App | Tauri v2 + React | `apps/desktop` (Phase 3) |
| Deployment | Docker Compose, Caddy (TLS 1.3, Rate-Limits) | `deploy` |

## Dokumentation

- [Architektur und Annahmen](docs/00-architektur.md)
- [Bedrohungsmodell (STRIDE)](docs/01-bedrohungsmodell.md)
- [Rechtekonzept / API-Rules](docs/02-rechtekonzept.md)
- [Betriebshandbuch](docs/betriebshandbuch.md)

## Entwicklung

```bash
cd apps/server
go test ./...                      # inkl. API-Rule-Tests gegen echte PocketBase-Instanzen
LEXICHAT_SERVER_SECRET=$(openssl rand -base64 48) go run . serve --dev
```
Go 1.27.2 wird über `toolchain` in `go.mod` automatisch geladen (`GOTOOLCHAIN=auto`).
