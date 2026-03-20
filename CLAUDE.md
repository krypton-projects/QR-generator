# CLAUDE.md — AI Assistant Guide for QR-Generator

## Project Overview

A **zero-build, security-first, locally-run QR code generator** built with vanilla JS and Node.js/Express. It generates QR codes for WiFi, URL, vCard, Email, Phone, SMS, and plain Text. Processing happens entirely on localhost — no data leaves the machine.

---

## Repository Structure

```
QR-generator/
├── server.js              # Express backend (API endpoints, security, QR rendering)
├── package.json           # Dependencies and npm scripts
├── public/                # Static files served directly to browser
│   ├── index.html         # Single-page application (408 lines)
│   ├── manifest.json      # PWA manifest
│   ├── sw.js              # Service Worker for offline support
│   ├── icon.svg           # App icon
│   ├── css/
│   │   └── style.css      # Complete styling with CSS custom properties (790 lines)
│   └── js/
│       ├── app.js         # Client-side application logic (998 lines)
│       └── qrcode.min.js  # Bundled QRCode library (qrcode@1.5.4, do not edit)
└── README.md              # User-facing documentation (Polish)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥20.3.0 |
| Backend framework | Express 5.x |
| Security headers | Helmet 8.x |
| File uploads | Multer 2.x |
| QR matrix generation | qrcode 1.5.4 |
| Image processing | Sharp 0.34.x |
| Browser auto-open | open 10.x (ESM-only, use dynamic import) |
| Frontend | Vanilla JS, CSS3, HTML5 (no frameworks) |

**No build system** — files are served as-is. No webpack, Vite, Babel, ESLint, or Prettier.

---

## Development Workflow

### Start the server
```bash
npm install
npm start
```
- Server binds to `127.0.0.1:3000` (localhost only)
- Browser opens automatically via the `open` package
- Static files from `public/` are served directly
- No hot reload — refresh browser manually after frontend changes; restart server after `server.js` changes

### No build step required
Edit HTML/CSS/JS directly and refresh. The only npm script is `start`.

---

## API Endpoints

### `POST /api/generate`
Generate a QR code without a logo.

```json
// Request body (JSON)
{
  "type": "wifi|url|text|email|phone|sms|vcard",
  "data": { /* type-specific fields */ },
  "options": {
    "ecl": "L|M|Q|H",
    "width": 100-1000,
    "margin": 0-10,
    "darkColor": "#000000",
    "lightColor": "#ffffff",
    "dotStyle": "square|rounded|circle"
  }
}

// Response
{ "qr": "<svg>...</svg>", "format": "svg" }
// or
{ "qr": "data:image/png;base64,...", "format": "png" }
```

### `POST /api/generate-with-logo`
Generate a QR code with a logo overlay (multipart).

- Field `payload`: JSON string (same shape as `/api/generate` body)
- Field `logo`: image file (PNG, JPG, GIF, WebP, or SVG; max 2 MB)
- Response: `{ "qr": "data:image/png;base64,...", "format": "png" }`
- Logo is resized to 20% of QR width and centered

---

## Architecture & Key Design Decisions

### Dual rendering (server + client)
QR generation logic is **duplicated** on purpose — `buildQRData()`, `normaliseOptions()`, and `buildCustomSVG()` exist in both `server.js` and `public/js/app.js`. The client renders locally for speed; the server endpoint exists as an API. When modifying QR logic, **update both files**.

### Custom SVG renderer (`buildCustomSVG`)
The bundled `qrcode` library only generates square dots. For `rounded` and `circle` dot styles, a custom SVG renderer is implemented from scratch using the QR code matrix. Finder patterns (the three corner squares) are rendered as unified shapes with smooth corners. This code spans ~242 lines in both `server.js` and `app.js`.

### Security architecture (7 layers)
1. **Network isolation** — binds to `127.0.0.1` only
2. **Rate limiting** — 100 req/60s per IP; memory-bounded FIFO map (max 10k IPs)
3. **Helmet CSP** — strict Content-Security-Policy, frame-ancestors: 'none'
4. **Magic byte validation** — checks file signatures before MIME type
5. **SVG sanitization** — strips `<script>`, `<style>`, `on*` attributes, `javascript:` URIs before Sharp processing
6. **Sharp timeout** — 5-second timeout via `Promise.race()` to prevent resource exhaustion
7. **DOM safety** — no `innerHTML` on user data; uses `DOMParser` + `importNode`

---

## Code Conventions

### Naming
| Element | Convention | Examples |
|---------|-----------|---------|
| Functions | camelCase | `buildQRData()`, `normaliseOptions()` |
| Variables | camelCase | `currentType`, `logoFile` |
| Constants | UPPER_SNAKE_CASE | `RATE_WIN_MS`, `MAX_FILE_SIZE`, `LOGO_SIZE_RATIO` |
| CSS classes | kebab-case | `.form-card`, `.type-btn`, `.qr-spinner` |
| CSS custom properties | `--kebab-case` | `--bg`, `--primary-h`, `--shadow-lg` |
| HTML IDs | camelCase | `#formCard`, `#qrImage` |
| Data attributes | kebab-case | `data-type="wifi"`, `data-dot="rounded"` |

### Style
- `'use strict'` at the top of `server.js` and `app.js`
- Section headers use ASCII banners: `// ── Section name ──────────`
- No JSDoc — inline comments explain logic; security notes marked `// S1:`, `// S2:`, etc.
- Arrow functions for callbacks; traditional `function` declarations for main handlers
- `try/catch` for all async operations and localStorage access

### Validation patterns used throughout
```javascript
// Hex color (with optional alpha)
/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(color)

// URL — via URL constructor (throws on invalid)
new URL(url)

// Phone
/^\+?[\d\s\-().]{6,20}$/

// SVG header detection
/^\s*(<\?xml|<svg[\s\/>:])/i.test(head)
```

### DOM patterns
- Use `replaceChildren()` instead of `innerHTML` for list updates
- Use `DOMParser` + `importNode` when inserting SVG
- Revoke blob URLs immediately after use (`URL.revokeObjectURL`)
- Set canvas width to `0` to release memory after compositing

---

## Frontend State Model (app.js)

```javascript
let currentType     = 'wifi';   // Active QR type
let currentQR       = null;     // { qr, format, rawData } — last generated result
let logoFile        = null;     // File object for logo overlay
let generateTimer   = null;     // Debounce handle (300ms)
let currentDotStyle = 'square'; // 'square' | 'rounded' | 'circle'
let spinnerTimeout  = null;     // Spinner delay handle
let genSeq          = 0;        // Monotonic counter to prevent race conditions
```

---

## QR Data Formats

| Type | Format |
|------|--------|
| WiFi | `WIFI:T:WPA;S:{ssid};P:{pass};H:false;;` |
| vCard | RFC 2.1 vCard (`BEGIN:VCARD\nVERSION:3.0\n...`) |
| Email | MATMSG format (`MATMSG:TO:{email};SUB:{subject};BODY:{body};;`) |
| SMS | `SMSTO:{phone}:{message}` |
| Phone | `tel:{phone}` |
| URL | Raw URL string |
| Text | Raw text string |

Escaping helpers: `escapeWifi()`, `escapeVCard()`, `escapeMATMSG()` — must be kept in sync between server and client.

---

## CSS Design System

CSS custom properties defined in `:root` (light) and `[data-theme="dark"]`:

```css
/* Colors */
--bg, --surface, --surface2     /* Backgrounds */
--border, --text, --text-muted  /* Text & borders */
--primary                        /* Brand indigo #4f46e5 */
--error, --warning, --success   /* State feedback */

/* Spacing & shape */
--radius, --radius-sm
--shadow, --shadow-lg

/* Animation */
--transition: 0.18s
```

Layout: CSS Grid `480px 1fr` (form | preview), collapses to single column at `max-width: 900px`.

---

## Accessibility Requirements

This project targets **WCAG 2.1 AA**. When making changes:

- Maintain color contrast ≥4.5:1 for text
- Use `aria-live` regions for dynamic validation messages
- Provide `aria-label` on all icon-only buttons
- Support keyboard navigation (focus-visible rings required)
- Include skip link to main content
- WiFi QR history entries must **not** show thumbnails (passwords encoded in QR)

---

## History & Persistence

- Last 10 generated QR codes stored in `localStorage` under key `qr-history`
- Each entry: `{ type, label, qr, format, ts }` where `ts` is ISO timestamp
- WiFi entries stored without `qr` thumbnail (privacy)
- `try/catch` guards all localStorage access (quota errors, private browsing)

---

## Service Worker (sw.js)

- Caches app shell for offline use
- Registered by `app.js` on page load
- Does **not** cache API responses

---

## Things to Avoid

- **Do not** add frontend frameworks (React, Vue, etc.) — this is intentionally vanilla
- **Do not** add a build system — zero-build is a feature
- **Do not** use `innerHTML` with user-provided data
- **Do not** remove or weaken the CSP headers in Helmet configuration
- **Do not** allow `server.js` to bind to `0.0.0.0` (must stay localhost-only)
- **Do not** skip `sanitizeSvgLogo()` before passing SVG to Sharp
- **Do not** change the `open` package import to `require()` — it is ESM-only and must use dynamic `import()`
- **Do not** modify `qrcode.min.js` — it is a vendored bundle
- When updating QR logic, **always update both** `server.js` and `public/js/app.js`

---

## Common Tasks

### Add a new QR type
1. Add a form section in `public/index.html`
2. Add a type button in the type selector
3. Handle `collectData()` in `app.js` for the new type
4. Add validation in `getValidationError()` in `app.js`
5. Add format string in `buildQRData()` in **both** `server.js` and `app.js`
6. Add label logic in `saveToHistory()` in `app.js`

### Change visual styling
Edit `public/css/style.css`. Update both light (`:root`) and dark (`[data-theme="dark"]`) custom properties when changing colors. Verify contrast ratios.

### Add a new server route
Add to `server.js` below the existing endpoints. Apply `rateLimit` middleware. Validate and sanitize all inputs. Use `withSharpTimeout()` for any Sharp operations.
