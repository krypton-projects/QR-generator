<div align="center">

```
██████╗ ██████╗      ██████╗ ███████╗███╗   ██╗
██╔═══██╗██╔══██╗    ██╔════╝ ██╔════╝████╗  ██║
██║   ██║██████╔╝    ██║  ███╗█████╗  ██╔██╗ ██║
██║▄▄ ██║██╔══██╗    ██║   ██║██╔══╝  ██║╚██╗██║
╚██████╔╝██║  ██║    ╚██████╔╝███████╗██║ ╚████║
 ╚══▀▀═╝ ╚═╝  ╚═╝     ╚═════╝ ╚══════╝╚═╝  ╚═══╝
```

**A private QR code generator that runs entirely in your browser.**

[![No install needed](https://img.shields.io/badge/No%20install-open%20in%20browser-5b6ee1?style=flat-square)](public/index.html)
[![PWA](https://img.shields.io/badge/PWA-installable-5b6ee1?style=flat-square&logo=pwa&logoColor=white)](public/manifest.json)
[![Works offline](https://img.shields.io/badge/Works-offline-green?style=flat-square)]()
[![WCAG](https://img.shields.io/badge/Accessibility-WCAG%202.1%20AA-purple?style=flat-square)](https://www.w3.org/WAI/WCAG21/quickref/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

</div>

---

## Features

### QR Code Types

| Type | Icon | Description |
|------|------|-------------|
| **WiFi** | 📶 | Auto-connect to a network (SSID, password, WPA / WEP / open) |
| **URL** | 🔗 | Website address with validation |
| **Text** | 📝 | Any plain text (up to 900 characters) |
| **Email** | ✉️ | Pre-filled message with recipient, subject, and body |
| **Phone** | 📞 | Phone number to dial |
| **SMS** | 💬 | Phone number + predefined message (up to 160 characters) |
| **Contact (vCard)** | 👤 | Business card: name, phone, email, organization, URL |

### Appearance

<table>
<tr>
<td>

**Format & Size**
- 🖼️ SVG (scalable) or PNG
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
- 🖼️ Logo overlay (PNG / JPG / WebP / SVG, max 2 MB)

</td>
</tr>
</table>

### More

| Feature | Description |
|---------|-------------|
| ⚡ Live preview | QR regenerates automatically as you type (300 ms debounce) |
| 💾 Export | Download SVG or PNG directly from the browser |
| 📋 Copy | Copy encoded content to clipboard in one click |
| 🕒 History | Last 10 generated codes saved in `localStorage` |
| 🌙 Themes | Light / dark mode with persistence between sessions |
| 📲 Installable | Add to Home Screen on mobile or install as desktop PWA |
| ✈️ Works offline | Fully functional after first load (Service Worker caching) |

---

## Getting Started

**No installation needed.** Just open the app in any modern browser:

```
public/index.html
```

Clone the repo and open the file:

```bash
git clone https://github.com/krypton-projects/QR-generator
# Then open public/index.html in your browser
```

Or deploy the `public/` folder to any static host (GitHub Pages, Netlify, Vercel, etc.) — no build step required.

---

## Project Structure

The entire app lives in the `public/` folder:

```
public/
├── index.html          # App shell and UI
├── css/
│   └── style.css       # Design system (custom properties, dark mode)
├── js/
│   ├── app.js          # All app logic: forms, QR generation, history
│   └── qrcode.min.js   # Bundled qrcode@1.5.4 library
├── manifest.json        # PWA manifest
├── sw.js               # Service Worker (offline caching)
└── icon.svg            # App icon
```

---

## Privacy

Everything runs in the browser. No data is ever sent to a server.

- QR codes are generated locally using the bundled `qrcode.min.js` library
- Logo compositing is done with the Canvas API
- The only persistent storage is `localStorage` for history and theme preference

---

## Accessibility

Meets **WCAG 2.1 AA**:

| Criterion | Implementation |
|-----------|---------------|
| **Contrast** | ≥ 4.5:1 for normal text in both themes |
| **Keyboard navigation** | `:focus-visible` on all interactive elements |
| **Screen readers** | `aria-label` on icon buttons, `aria-describedby` on color pickers |
| **Live regions** | `role="alert"` + `aria-live="polite"` for validation and toasts |
| **Character counters** | Visible on textareas, change color at 90% and 100% of limit |
| **Animations** | Disabled when `prefers-reduced-motion: reduce` is set |

---

## License

MIT

---

<div align="center">

*All data stays in your browser — nothing leaves your machine.*

</div>
