# LexiChat – Design-System

> Paket: `packages/ui` (CSS-Variablen in `src/styles.css`, React-Komponenten in `src/components.tsx`, Tokens + Kontrasttests in `src/tokens.ts`).
> Grundlage: [`/design/DESIGN.md`](../design/DESIGN.md) (Mobbin-Analyse), seit Phase 3 im Repository; das Design-System wurde daran angeglichen. Abweichungen sind unten begründet.

## Tokens

| Token | Wert | Verwendung |
|---|---|---|
| `--ink` | `#141414` | Text, Primary-Button, Fokusring, aktive Navigation |
| `--canvas` | `#ffffff` | Hintergrund, Karten |
| `--canvas-soft` | `#f3f3f3` | Flächen (Login-Hintergrund, Soft-Buttons, Hinweise), Sidebar (Desktop) |
| `--field` | `#f0f0f0` | Eingabefelder |
| `--hairline` / `--hairline-soft` | `#e0e0e0` / `#f0f0f0` | Rahmen, Trennlinien |
| `--muted` | `#707070` | Sekundärtext auf Weiß (4,95:1) |
| `--muted-strong` | `#696969` | **Abweichung:** Sekundärtext/Platzhalter auf grauen Flächen (4,8:1) |
| `--faint` | `#adadad` | nur dekorativ, **nie für Text** (2,24:1) |
| `--accent` | `#0066ff` | sparsam: Ungelesen-Badge, Broadcast-Label (4,83:1 mit Weiß) |

Abstände 4/8/12/16/24/32/48 px · Radien: Pills `9999px`, Karten/Dialoge 24 px, Inputs/Kacheln 16 px · keine Schatten, keine Verläufe.

Typografie: **Inter Variable, lokal eingebunden** (`@fontsource-variable/inter`, keine Google Fonts). Gewichte laut DESIGN.md als Tokens: `--w-heading` 652 (Zeilenhöhe 1,1), `--w-body` 456, `--w-lead` 300, `--w-strong` 600 (Titel, Links, Labels). Sentence-Case, Überschriften enden mit Punkt. Die Mobbin-Hausschrift ist proprietär; Inter ist die freie, lokal ausgelieferte Entsprechung.

## Komponenten

`Button` (primary · outline · soft · ghost; sm/md; Ladezustand), `TextField`, `SelectField`, `Toggle` (`role="switch"`), `Card`, `Badge` (neutral · outline · ink · accent), `Notice` (info · success · warning · error), `Avatar` (Initialen-Fallback), `Dialog` (natives `<dialog>`, Fokusfalle durch den Browser, Esc schließt außer bei `persistent`), `EmptyState`, `Spinner`, `Icon` (Inline-SVG, keine Icon-Fonts), `Segmented` (Segmented Control: Stadion-Spur in `canvas-soft`, aktive Option als weiße Pill, `aria-pressed`), `Toast` (Kartenform, `role="status"`), `Logomark` (Squircle-App-Icon). CSS-Muster: `.lx-navpill` (schwebende Navigations-Pill), `.lx-footer` (Ink-Band mit abgerundeten oberen Ecken, Polaritätsumkehr).

## Abweichungen und Auslegungen (bewusst)

1. **`--muted-strong`**: `#707070` erreicht auf `#f3f3f3` nur 4,46:1 und auf `#f0f0f0` 4,35:1 (unter WCAG AA 4,5:1). Für Text auf grauen Flächen wird deshalb `#696969` verwendet. Automatisiert geprüft in `tokens.test.ts`.
2. **Fehler-/Warnzustände ohne Rot**: Icon + Text + Gewicht + Ink-Rahmen (2 px bei Fehlern). Bisher war keine Rot-Ausnahme nötig.
3. **Akzentblau** nur für Ungelesen-Badge und Broadcast-Label (im Original nur für kommerzielle Signale).
4. **Eingabefelder ohne Rand** (laut Design): Die Füllfarbe hebt sich mit 1,13:1 nur schwach von Weiß ab. WCAG 1.4.11 (Nicht-Text-Kontrast) wird hier unterschiedlich ausgelegt; wir stellen sicher, dass jedes Feld ein **sichtbares Label** hat und der Fokusring 2 px Ink (18:1) beträgt. axe meldet keinen Verstoß, eine manuelle Prüfung mit Betroffenen wird trotzdem empfohlen.
5. **Native `<select>`**: Systemdarstellung des Pfeils, dafür volle Tastatur- und Screenreader-Unterstützung.
6. **Keine Schatten**: DESIGN.md sieht für Toast/Modal einen mittleren Schatten vor; wir verwenden stattdessen eine Hairline (`--hairline`), weil sie auch im Hochkontrastmodus von Windows sichtbar bleibt und das Gesamtbild flach hält.
7. **Fotografie/Marketing-Elemente** (Hero-Collagen, Preiskarten) aus DESIGN.md entfallen – LexiChat ist ein Arbeitswerkzeug.

## CSP-Verträglichkeit

Keine Inline-Skripte, kein `<style>`-Element, keine `style`-Attribute im HTML. React setzt dynamische Styles über das CSSOM (erlaubt unter `style-src 'self'`). Schriften und Assets werden nie als `data:`-URL eingebettet (`assetsInlineLimit: 0`). Die E2E-Tests laufen mit der Produktions-CSP und schlagen bei jeder CSP-Verletzung fehl.

## Barrierefreiheit

- axe-core (WCAG 2.1 A/AA) in den E2E-Tests – Admin-Web-App: Login, Passwortwechsel, 2FA-Einrichtung, Benutzerliste, Dialog „Neues Konto“, Audit-Log, Einstellungen, Mein Konto; Windows-App (im Browser-Modus): Hinweis beim ersten Start, Anmeldung, Passwort festlegen, Wiederherstellungsschlüssel, Hauptansicht, Chat, Einstellungen – **0 Verstöße**.
- Sichtbarer Fokus überall, „Zum Inhalt springen“, Landmarks (`header`, `nav`, `main`, `footer`), Tabellen mit `caption`/`scope`, Fehler- und Statusmeldungen als `role="alert"`/`status`, Passwortregeln als `aria-live`-Liste.
- Automatische Tests ersetzen keine manuelle Prüfung mit Screenreader (NVDA/JAWS) – **nicht durchgeführt**, vor dem Rollout empfohlen.
