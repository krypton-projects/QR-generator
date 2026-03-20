# CLAUDE.md — Developer Guidelines for AI Assistants

This file provides context and guidelines for AI assistants (Claude Code and similar tools) working on the QR Generator project.

---

## Project Overview

**QR Generator** is a privacy-first, locally-hosted QR code generator. It runs as a minimal Node.js/Express server that serves a single-page application. All QR generation happens on the server via the `qrcode` and `sharp` packages; no external APIs are called and no user data is transmitted anywhere.

**Core principle:** _Nothing leaves the user's machine._

---

## Architecture

```
server.js          Express API + static file server (entry point)
public/
  index.html       Single-page application shell
  css/style.css    Design system (custom properties, dark mode)
  js/app.js        Client-side logic (forms, live preview, history)
  js/qrcode.min.js Vendored QR library (client-side fallback, not the main generator)
  manifest.json    PWA manifest
  sw.js            Service Worker
package.json
```

The server exposes two API endpoints:
- `POST /api/generate` — JSON body, returns SVG or PNG as base64
- `POST /api/generate-with-logo` — multipart/form-data, always returns PNG

---

## Security Model

This project has a deliberate, multi-layer security design. **Do not weaken any of these layers without a strong reason and explicit user approval.**

| Layer | What it does |
|-------|-------------|
| Helmet + CSP | Restricts script/style/frame sources; prevents clickjacking |
| Rate limiting | 100 req/min/IP, FIFO-capped map (max 10,000 entries) |
| Magic byte validation | Verifies uploaded files match their declared MIME type |
| SVG sanitization | Strips `<script>`, `<style>`, `on*` handlers, and `javascript:` hrefs before passing to Sharp |
| Data escaping | WiFi, vCard (RFC 6350), and MATMSG formats are properly escaped |
| Sharp timeout | Processing is aborted after 5 seconds to prevent DoS via malicious images |
| Safe SVG rendering | Client uses `DOMParser` + `importNode`, never `innerHTML` |

When modifying server.js, verify that none of these layers are bypassed.

---

## Development Rules

### Do
- Keep all processing local — no outbound HTTP calls, no external services.
- Validate and sanitize all user input on the server side (never trust the client).
- Follow the existing code style: `'use strict'`, named constants in UPPER_SNAKE_CASE, clear comments.
- Keep error messages generic in API responses (no stack traces or internal details).
- Log detailed errors only in development (`isDev` flag guards `console.log`/`console.error` detail level).
- Test both SVG and PNG output paths, and all seven QR types.

### Don't
- Don't add new npm dependencies without a clear justification — the dependency surface is intentionally small.
- Don't send user data to any external API or analytics service.
- Don't store any user input beyond the in-memory `rateMap` (which holds only IPs and counters, not QR content).
- Don't remove or relax security headers, rate limiting, or file validation.
- Don't use `innerHTML` to render SVG content on the client side.
- Don't expose stack traces or internal error details in API responses.
- Don't change the server bind address away from `127.0.0.1` without explicit user intent.

---

## Running Locally

```bash
npm install
npm start
# Opens http://localhost:3000 automatically
```

**Node.js ≥ 20.3.0 is required** (for the `open` package ESM dynamic import).

There is no test suite currently. Manual testing steps:
1. Generate each of the 7 QR types in both SVG and PNG format.
2. Test logo upload with PNG, JPG, WebP, and SVG files.
3. Verify rate limiting triggers after 100 rapid requests.
4. Check dark mode toggle persistence.
5. Confirm history panel shows the last 10 codes.

---

## Sensitive Areas

- `sanitizeSvgLogo()` in `server.js` — any change here must be carefully reviewed for XSS bypass.
- `validateMagicBytes()` — must correctly reject files with spoofed MIME types.
- `buildQRData()` escape helpers (`escapeWifi`, `escapeVCard`, `escapeMATMSG`) — incorrect escaping can corrupt QR payloads or cause injection in QR-reading apps.
- CSP directives in the Helmet configuration — loosening `scriptSrc` or `styleSrc` can open XSS vectors.

---

## Commit Guidelines

- Use clear, imperative commit messages: `fix: …`, `feat: …`, `docs: …`, `refactor: …`, `security: …`.
- Keep security-related changes in their own commits and describe _why_, not just _what_.
- Do not commit `node_modules/`, `.env` files, or any credentials.
