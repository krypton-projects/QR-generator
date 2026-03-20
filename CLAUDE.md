# CLAUDE.md — Developer Guidelines for AI Assistants

This file provides context and guidelines for AI assistants (Claude Code and similar tools) working on the QR Generator project.

---

## Project Overview

**QR Generator** is a privacy-first, client-side PWA. The entire app runs in the browser — no server, no build step, no dependencies to install. Open `public/index.html` and it works.

**Core principle:** _Everything runs in the browser. Nothing leaves the user's machine._

---

## Architecture

The whole application lives in `public/`:

```
public/
├── index.html          # App shell and UI (single page)
├── css/style.css       # Design system (custom properties, dark mode)
├── js/app.js           # All app logic: forms, QR generation, history, export
├── js/qrcode.min.js    # Vendored qrcode@1.5.4 (bundled, do not modify)
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (cache-first, offline support)
└── icon.svg            # App icon
```

`server.js` and `package.json` exist in the repo root but are **legacy / optional**. They provide a convenience Node.js server for local development only. The app does not depend on them.

---

## How the App Works

- **QR generation** — `window.QRCode` from `qrcode.min.js` creates the QR matrix. `buildCustomSVG()` in `app.js` renders rounded/circle dot styles directly as SVG.
- **PNG export** — `svgToPng()` converts SVG to PNG via the Canvas API.
- **Logo compositing** — `compositeLogoOnQR()` draws the QR and logo onto a Canvas element, then exports as PNG.
- **Offline** — the Service Worker (`sw.js`) caches all assets on first load with a cache-first strategy.
- **History** — last 10 generated codes stored in `localStorage` (QR content only, no images).
- **Theme** — light/dark preference persisted in `localStorage`.

---

## Security Model (Browser-Side)

| Mechanism | Details |
|-----------|---------|
| CSP | Strict `Content-Security-Policy` meta tag in `index.html` — no inline scripts, no external sources |
| Safe SVG rendering | `DOMParser` + `importNode` used instead of `innerHTML` for all SVG display |
| No external calls | `app.js` makes no `fetch()` calls to any external URL |
| Data isolation | All user input stays in memory / `localStorage`; never transmitted |

---

## Development Rules

### Do
- Keep all logic in `public/js/app.js` — no server dependencies.
- Follow the existing code style: no transpilation, vanilla JS, `'use strict'`.
- Test across all 7 QR types and both SVG + PNG output paths.
- Keep the Service Worker cache version (`CACHE` constant in `sw.js`) up to date when adding new assets.

### Don't
- Don't add `fetch()` calls to external APIs or any server endpoint.
- Don't modify `qrcode.min.js` — it is a vendored bundle. If an upgrade is needed, re-bundle from npm.
- Don't use `innerHTML` to render SVG content.
- Don't add a build pipeline unless strictly necessary — the app intentionally requires no build step.
- Don't store user QR content in `localStorage` beyond the history feature (last 10 items only).

---

## Running Locally

Open directly in a browser — no setup needed:
```
public/index.html
```

Or use the optional Node.js convenience server:
```bash
npm install
npm start   # opens http://localhost:3000
```

---

## Manual Testing Checklist

- [ ] All 7 QR types generate correctly (WiFi, URL, Text, Email, Phone, SMS, vCard)
- [ ] SVG and PNG export both work
- [ ] Logo upload works (PNG, JPG, WebP, SVG)
- [ ] Rounded and circle dot styles render correctly
- [ ] Custom colors apply correctly
- [ ] Live preview updates on input change
- [ ] History panel shows last 10 codes
- [ ] Dark mode toggle persists after page reload
- [ ] App works offline after first load (test with DevTools → Network → Offline)
- [ ] App can be installed as PWA on desktop and mobile

---

## Commit Guidelines

- Use imperative messages: `fix: …`, `feat: …`, `docs: …`, `refactor: …`
- Do not commit `node_modules/` or any credentials.
