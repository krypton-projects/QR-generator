<div align="center">

```
██████╗ ██████╗      ██████╗ ███████╗███╗   ██╗
██╔═══██╗██╔══██╗    ██╔════╝ ██╔════╝████╗  ██║
██║   ██║██████╔╝    ██║  ███╗█████╗  ██╔██╗ ██║
██║▄▄ ██║██╔══██╗    ██║   ██║██╔══╝  ██║╚██╗██║
╚██████╔╝██║  ██║    ╚██████╔╝███████╗██║ ╚████║
 ╚══▀▀═╝ ╚═╝  ╚═╝     ╚═════╝ ╚══════╝╚═╝  ╚═══╝
```

**A secure, fully local QR code generator that runs in your browser.**
No data ever leaves your machine.

---

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.3-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Security](https://img.shields.io/badge/Security-Helmet%20%2B%20CSP-green?style=flat-square&logo=shield&logoColor=white)](https://helmetjs.github.io)
[![WCAG](https://img.shields.io/badge/Accessibility-WCAG%202.1%20AA-purple?style=flat-square)](https://www.w3.org/WAI/WCAG21/quickref/)

</div>

---

## Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Project Structure](#-project-structure)
- [API Reference](#-api-reference)
- [Security](#-security)
- [Accessibility](#-accessibility-a11y)
- [Dependencies](#-dependencies)

---

## Features

### Supported QR Code Types

| Type | Icon | Description |
|------|------|-------------|
| **WiFi** | 📶 | Auto-connect to a network (SSID, password, WPA / WEP / open) |
| **URL** | 🔗 | Website address (http / https with validation) |
| **Text** | 📝 | Any plain text content (up to 900 characters) |
| **Email** | ✉️ | Ready-to-send message with recipient, subject, and body |
| **Phone** | 📞 | Phone number to dial |
| **SMS** | 💬 | Phone number + predefined message body (up to 160 characters) |
| **Contact (vCard)** | 👤 | Business card: first/last name, phone, email, organization, URL |

### Appearance Options

<table>
<tr>
<td>

**Format & Size**
- 🖼️ SVG (scalable) or PNG (raster)
- 📐 Size: 100–1000 px
- ↔️ Margin: 0–10 modules

</td>
<td>

**Dot Style**
- ⬛ Square (default)
- 🔲 Rounded
- 🔵 Circle

</td>
<td>

**Advanced**
- 🎨 Custom module and background colors
- 🛡️ Error correction: L / M / Q / H
- 🖼️ Logo overlay centered on QR (max 2 MB)

</td>
</tr>
</table>

### Other Features

| Feature | Description |
|---------|-------------|
| ⚡ Live Preview | QR regenerates automatically (300 ms debounce) |
| 💾 Export | Download PNG or SVG directly from the browser |
| 📋 Copy Data | Encoded content copied to clipboard in one click |
| 🕒 History | Last 10 generated codes saved in `localStorage` |
| 🌙 Themes | Light / dark mode with persistence between sessions |

---

## 🚀 Quick Start

### Requirements

- **Node.js** ≥ 20.3.0
- **npm** ≥ 9

### Installation

```bash
# One-liner
git clone https://github.com/krypton-projects/QR-generator && cd QR-generator && npm install && npm start
```

Or step by step:

```bash
# 1. Clone the repository
git clone https://github.com/krypton-projects/QR-generator
cd QR-generator

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

> The app automatically opens in your browser at **`http://localhost:3000`**.

> [!NOTE]
> The server listens exclusively on `127.0.0.1` — it is not accessible from external networks.

---

## 📁 Project Structure

```
QR-generator/
├── 📄 server.js            # Express server — API + static file serving
├── 📦 package.json
├── 📂 public/
│   ├── 📄 index.html       # Single-page application (SPA)
│   ├── 📂 css/
│   │   └── 🎨 style.css   # Design system — custom properties, dark mode
│   └── 📂 js/
│       └── ⚡ app.js       # Client logic — forms, generation, history
└── 📖 README.md
```

### Data Flow

```
┌─────────────────────────────────────┐
│         Browser (app.js)            │
│  collectData() ──► JSON payload     │
└──────────────┬──────────────────────┘
               │
       ┌───────▼────────┐
       │  POST /api/…   │  ← JSON or multipart/form-data
       └───────┬────────┘
               │
┌──────────────▼──────────────────────┐
│             server.js               │
│                                     │
│  rateLimit()        per-IP, FIFO cap│
│  buildQRData()      WiFi/vCard/…    │
│  normaliseOptions() option validation│
│  buildCustomSVG()   custom renderer │
│  validateMagicBytes() magic bytes   │
│  sanitizeSvgLogo()  strip XSS       │
│  sharp / qrcode     generation      │
└──────────────┬──────────────────────┘
               │
       ┌───────▼───────────────────────┐
       │  { qr: "…", format: "…" }     │
       └───────────────────────────────┘
```

---

## 📡 API Reference

### `POST /api/generate`

Generates a QR code without a logo.

```http
POST /api/generate
Content-Type: application/json
```

**Request body:**

```json
{
  "type": "wifi",
  "data": {
    "ssid": "MyNetwork",
    "password": "secretpassword",
    "security": "WPA",
    "hidden": false
  },
  "options": {
    "format": "svg",
    "width": 300,
    "margin": 2,
    "errorCorrectionLevel": "M",
    "dotStyle": "rounded",
    "color": {
      "dark": "#000000",
      "light": "#ffffff"
    }
  }
}
```

**Allowed `type` values:**

```
url  |  wifi  |  text  |  email  |  phone  |  sms  |  vcard
```

**Response (`200 OK`):**

```json
{ "qr": "<svg xmlns=…>…</svg>",     "format": "svg" }
{ "qr": "data:image/png;base64,…",  "format": "png" }
```

---

### `POST /api/generate-with-logo`

Generates a QR code with an overlaid logo. Always returns PNG.

```http
POST /api/generate-with-logo
Content-Type: multipart/form-data
```

| Field | Type | Description |
|-------|------|-------------|
| `payload` | `string` (JSON) | Same object as the `/api/generate` body |
| `logo` | `File` | PNG / JPG / WebP / SVG, max 2 MB |

**Response (`200 OK`):**

```json
{ "qr": "data:image/png;base64,…", "format": "png" }
```

**Error codes:**

| Code | Meaning |
|------|---------|
| `400` | Invalid QR type, missing data, or bad file format |
| `429` | Rate limit exceeded (100 req / min / IP) |
| `500` | Generation error (e.g. Sharp timeout) |

---

## 🔒 Security

The application uses multi-layered protection — each layer operates independently:

```
HTTP Request
     │
     ▼
┌─────────────────────────────────────────────────────┐
│ 🛡️  Layer 1 – HTTP Headers (Helmet)                  │
│     CSP · frame-ancestors · base-uri · form-action  │
├─────────────────────────────────────────────────────┤
│ 🚦  Layer 2 – Rate Limiting                          │
│     100 req/min/IP · map capped at 10,000 (FIFO)    │
├─────────────────────────────────────────────────────┤
│ 📁  Layer 3 – Upload Validation                      │
│     Magic bytes · MIME whitelist · 2 MB limit       │
├─────────────────────────────────────────────────────┤
│ 🧹  Layer 4 – SVG Sanitization                       │
│     Strips <script> <style> on* javascript:href     │
├─────────────────────────────────────────────────────┤
│ ✏️  Layer 5 – QR Data Escaping                       │
│     WiFi · vCard RFC 6350 · MATMSG                  │
├─────────────────────────────────────────────────────┤
│ ⏱️  Layer 6 – Processing Timeout                     │
│     Sharp max 5 s · clearTimeout on success         │
├─────────────────────────────────────────────────────┤
│ 🖥️  Layer 7 – Safe SVG Rendering                     │
│     DOMParser instead of innerHTML · importNode     │
└─────────────────────────────────────────────────────┘
```

---

## ♿ Accessibility (a11y)

The application meets the **WCAG 2.1 AA** standard:

| Criterion | Implementation |
|-----------|---------------|
| **Contrast** | ≥ 4.5:1 for normal text in both themes |
| **Keyboard Navigation** | `:focus-visible` on all interactive elements |
| **Screen Readers** | `aria-label` on icon buttons, `aria-describedby` on color pickers |
| **Live Regions** | `role="alert"` + `aria-live="polite"` on validation and toasts |
| **Character Counters** | Visible on textareas (color changes at 90% and 100% of limit) |
| **Animations** | Disabled when `prefers-reduced-motion: reduce` is set |

---

## 📦 Dependencies

| Package | Version | Role |
|---------|:-------:|------|
| [`express`](https://expressjs.com) | ^5.2 | HTTP server |
| [`helmet`](https://helmetjs.github.io) | ^8.1 | Security headers (CSP, HSTS, …) |
| [`multer`](https://github.com/expressjs/multer) | ^2.1 | File upload handling (multipart) |
| [`qrcode`](https://github.com/soldair/node-qrcode) | ^1.5 | QR matrix and SVG / PNG generation |
| [`sharp`](https://sharp.pixelplumbing.com) | ^0.34 | Image resize and compositing (logo) |
| [`open`](https://github.com/sindresorhus/open) | ^10.1 | Auto-open browser on start |

---

## 📄 License

This project is available under the **MIT License**.

---

<div align="center">

*All data is processed locally — nothing leaves your machine.*

</div>
