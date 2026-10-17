# LexiChat

Interner, Ende-zu-Ende-verschlüsselter Messenger für Arztpraxen (1:1-Chats und Broadcasts).

> **Status: alle 6 Phasen umgesetzt (MVP).** Vor dem Produktivbetrieb noch nötig: externer Penetrationstest, Prüfung der Datenschutz-Entwürfe durch DSB/Rechtsberatung, Code-Signing-Zertifikat + Update-Schlüssel, Test der Windows-App auf echten Praxis-PCs, Restore-Test auf dem echten Server. Details: [Security-Review](docs/04-security-review.md).

| Komponente | Technik | Ort |
|---|---|---|
| Server | PocketBase v0.40.5 als Go-Bibliothek + LexiChat-Hooks | `apps/server` |
| Admin-Web-App | React + Vite | `apps/admin-web` |
| Windows-App | Tauri v2 + React | `apps/desktop` |
| Krypto | libsodium (E2EE, KDF, Signaturen) | `packages/crypto` |
| Deployment | Docker Compose, Caddy (TLS 1.3, Rate-Limits) | `deploy` |

## Dokumentation

- [Architektur und Annahmen](docs/00-architektur.md)
- [Bedrohungsmodell (STRIDE)](docs/01-bedrohungsmodell.md)
- [Rechtekonzept / API-Rules](docs/02-rechtekonzept.md)
- [Design-System](docs/03-design-system.md)
- [Security-Review](docs/04-security-review.md) · [ASVS-L2-Checkliste](docs/05-asvs-checkliste.md)
- [Betriebshandbuch](docs/betriebshandbuch.md) (Installation, Backup/Restore, Windows-Release)
- [Datenschutz-Paket (Entwürfe)](docs/datenschutz/README.md)
- [Design-Vorlage](design/DESIGN.md)

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

```bash
# Windows-App
pnpm --filter @lexichat/desktop dev       # UI im Browser (native Funktionen als In-Memory-Fallback)
pnpm --filter @lexichat/desktop e2e       # Playwright gegen echten Server: E2EE-Chat, Broadcast, Sperre, Wiederherstellung, axe
pnpm --filter @lexichat/desktop tauri dev # native App (Windows mit WebView2 + Rust-Toolchain)
LEXICHAT_SERVER=https://chat.praxis.example LEXICHAT_UPDATER_PUBKEY=… pnpm --filter @lexichat/desktop build:windows
```
