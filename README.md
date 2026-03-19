<div align="center">

```
██████╗ ██████╗      ██████╗ ███████╗███╗   ██╗
██╔═══██╗██╔══██╗    ██╔════╝ ██╔════╝████╗  ██║
██║   ██║██████╔╝    ██║  ███╗█████╗  ██╔██╗ ██║
██║▄▄ ██║██╔══██╗    ██║   ██║██╔══╝  ██║╚██╗██║
╚██████╔╝██║  ██║    ╚██████╔╝███████╗██║ ╚████║
 ╚══▀▀═╝ ╚═╝  ╚═╝     ╚═════╝ ╚══════╝╚═╝  ╚═══╝
```

**Bezpieczny, w pełni lokalny generator kodów QR działający w przeglądarce.**
Żadne dane nie opuszczają Twojego komputera.

---

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.3-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5.x-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![License](https://img.shields.io/badge/Licencja-MIT-blue?style=flat-square)](LICENSE)
[![Security](https://img.shields.io/badge/Bezpiecze%C5%84stwo-Helmet%20%2B%20CSP-green?style=flat-square&logo=shield&logoColor=white)](https://helmetjs.github.io)
[![WCAG](https://img.shields.io/badge/Dost%C4%99pno%C5%9B%C4%87-WCAG%202.1%20AA-purple?style=flat-square)](https://www.w3.org/WAI/WCAG21/quickref/)

</div>

---

## Zawartość

- [Funkcje](#-funkcje)
- [Szybki start](#-szybki-start)
- [Struktura projektu](#-struktura-projektu)
- [API](#-api)
- [Bezpieczeństwo](#-bezpieczeństwo)
- [Dostępność](#-dostępność-a11y)
- [Zależności](#-zależności)

---

## ✨ Funkcje

### Obsługiwane typy kodów QR

| Typ | Ikona | Opis |
|-----|-------|------|
| **WiFi** | 📶 | Automatyczne połączenie z siecią (SSID, hasło, WPA / WEP / otwarta) |
| **URL** | 🔗 | Adres strony internetowej (http / https z walidacją) |
| **Tekst** | 📝 | Dowolna treść (do 900 znaków) |
| **Email** | ✉️ | Gotowa wiadomość z odbiorcą, tematem i treścią |
| **Telefon** | 📞 | Numer do zadzwonienia |
| **SMS** | 💬 | Numer + predefiniowana treść wiadomości (do 160 znaków) |
| **Kontakt (vCard)** | 👤 | Wizytówka: imię, nazwisko, telefon, email, organizacja, www |

### Opcje wyglądu

<table>
<tr>
<td>

**Format i rozmiar**
- 🖼️ SVG (skalowalny) lub PNG (rastrowy)
- 📐 Rozmiar: 100–1000 px
- ↔️ Margines: 0–10 modułów

</td>
<td>

**Styl modułów**
- ⬛ Kwadrat (domyślny)
- 🔲 Zaokrąglony
- 🔵 Kółko

</td>
<td>

**Zaawansowane**
- 🎨 Dowolne kolory modułów i tła
- 🛡️ Korekcja błędów: L / M / Q / H
- 🖼️ Logo nakładane na środek (max 2 MB)

</td>
</tr>
</table>

### Inne

| Funkcja | Opis |
|---------|------|
| ⚡ Podgląd na żywo | Kod regeneruje się automatycznie (debounce 300 ms) |
| 💾 Eksport | Pobieranie PNG lub SVG bezpośrednio z przeglądarki |
| 📋 Kopiuj dane | Zakodowana treść trafia do schowka jednym kliknięciem |
| 🕒 Historia | Ostatnie 10 kodów zapisanych w `localStorage` |
| 🌙 Motywy | Jasny / ciemny z persystencją między sesjami |

---

## 🚀 Szybki start

### Wymagania

- **Node.js** ≥ 20.3.0
- **npm** ≥ 9

### Instalacja

```bash
# 1. Sklonuj repozytorium
git clone <url-repozytorium>
cd QR-generator

# 2. Zainstaluj zależności
npm install

# 3. Uruchom
npm start
```

> Aplikacja automatycznie otwiera się w przeglądarce pod adresem **`http://localhost:3000`**.

> [!NOTE]
> Serwer nasłuchuje wyłącznie na `127.0.0.1` — nie jest dostępny z sieci zewnętrznej.

---

## 📁 Struktura projektu

```
QR-generator/
├── 📄 server.js            # Serwer Express – API + serwowanie plików statycznych
├── 📦 package.json
├── 📂 public/
│   ├── 📄 index.html       # Jednostronicowa aplikacja (SPA)
│   ├── 📂 css/
│   │   └── 🎨 style.css   # Design system – custom properties, dark mode
│   └── 📂 js/
│       └── ⚡ app.js       # Logika klienta – formularze, generowanie, historia
└── 📖 README.md
```

### Przepływ danych

```
┌─────────────────────────────────────┐
│         Przeglądarka (app.js)       │
│  collectData() ──► JSON payload     │
└──────────────┬──────────────────────┘
               │
       ┌───────▼────────┐
       │  POST /api/…   │  ← JSON lub multipart/form-data
       └───────┬────────┘
               │
┌──────────────▼──────────────────────┐
│             server.js               │
│                                     │
│  rateLimit()       per-IP, FIFO cap │
│  buildQRData()     WiFi/vCard/…     │
│  normaliseOptions() walidacja opcji │
│  buildCustomSVG()  własny renderer  │
│  validateMagicBytes() magic bytes   │
│  sanitizeSvgLogo()  strip XSS       │
│  sharp / qrcode    generowanie      │
└──────────────┬──────────────────────┘
               │
       ┌───────▼───────────────────────┐
       │  { qr: "…", format: "…" }     │
       └───────────────────────────────┘
```

---

## 📡 API

### `POST /api/generate`

Generuje kod QR bez logo.

```http
POST /api/generate
Content-Type: application/json
```

**Ciało żądania:**

```json
{
  "type": "wifi",
  "data": {
    "ssid": "MojaSiec",
    "password": "tajnehaslo",
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

**Dozwolone wartości `type`:**

```
url  |  wifi  |  text  |  email  |  phone  |  sms  |  vcard
```

**Odpowiedź (`200 OK`):**

```json
{ "qr": "<svg xmlns=…>…</svg>",      "format": "svg" }
{ "qr": "data:image/png;base64,…",   "format": "png" }
```

---

### `POST /api/generate-with-logo`

Generuje kod QR z nałożonym logo. Zawsze zwraca PNG.

```http
POST /api/generate-with-logo
Content-Type: multipart/form-data
```

| Pole | Typ | Opis |
|------|-----|------|
| `payload` | `string` (JSON) | Identyczny obiekt jak ciało `/api/generate` |
| `logo` | `File` | PNG / JPG / WebP / SVG, max 2 MB |

**Odpowiedź (`200 OK`):**

```json
{ "qr": "data:image/png;base64,…", "format": "png" }
```

**Kody błędów:**

| Kod | Znaczenie |
|-----|-----------|
| `400` | Nieprawidłowy typ QR, brak danych, zły format pliku |
| `429` | Przekroczony limit żądań (100 req / min / IP) |
| `500` | Błąd generowania (np. timeout Sharp) |

---

## 🔒 Bezpieczeństwo

Aplikacja stosuje wielowarstwową ochronę — każda warstwa działa niezależnie:

```
Żądanie HTTP
     │
     ▼
┌─────────────────────────────────────────────────────┐
│ 🛡️  Warstwa 1 – Nagłówki HTTP (Helmet)               │
│     CSP · frame-ancestors · base-uri · form-action  │
├─────────────────────────────────────────────────────┤
│ 🚦  Warstwa 2 – Rate Limiting                        │
│     100 req/min/IP · mapa max 10 000 wpisów (FIFO)  │
├─────────────────────────────────────────────────────┤
│ 📁  Warstwa 3 – Walidacja uploadu                    │
│     Magic bytes · MIME whitelist · limit 2 MB       │
├─────────────────────────────────────────────────────┤
│ 🧹  Warstwa 4 – Sanitizacja SVG                      │
│     Usuwanie <script> <style> on* javascript:href   │
├─────────────────────────────────────────────────────┤
│ ✏️  Warstwa 5 – Escaping danych QR                   │
│     WiFi · vCard RFC 6350 · MATMSG                  │
├─────────────────────────────────────────────────────┤
│ ⏱️  Warstwa 6 – Timeout przetwarzania                │
│     Sharp max 5 s · clearTimeout po sukcesie        │
├─────────────────────────────────────────────────────┤
│ 🖥️  Warstwa 7 – Bezpieczne renderowanie SVG          │
│     DOMParser zamiast innerHTML · importNode        │
└─────────────────────────────────────────────────────┘
```

---

## ♿ Dostępność (a11y)

Aplikacja spełnia standard **WCAG 2.1 AA**:

| Kryterium | Implementacja |
|-----------|--------------|
| **Kontrast** | ≥ 4,5:1 dla tekstu normalnego w obu motywach |
| **Nawigacja klawiaturą** | `:focus-visible` na wszystkich elementach interaktywnych |
| **Screen readery** | `aria-label` na przyciskach ikonowych, `aria-describedby` na color pickerach |
| **Live regions** | `role="alert"` + `aria-live="polite"` na walidacji i toastach |
| **Liczniki znaków** | Widoczne przy textarea (zmiana koloru przy 90% i 100% limitu) |
| **Animacje** | Wyłączane przy `prefers-reduced-motion: reduce` |

---

## 📦 Zależności

| Pakiet | Wersja | Rola |
|--------|:------:|------|
| [`express`](https://expressjs.com) | ^5.2 | Serwer HTTP |
| [`helmet`](https://helmetjs.github.io) | ^8.1 | Nagłówki bezpieczeństwa (CSP, HSTS, …) |
| [`multer`](https://github.com/expressjs/multer) | ^2.1 | Obsługa przesyłania plików (multipart) |
| [`qrcode`](https://github.com/soldair/node-qrcode) | ^1.5 | Generowanie matrycy i SVG / PNG kodów QR |
| [`sharp`](https://sharp.pixelplumbing.com) | ^0.34 | Resize i kompozytowanie obrazów (logo) |
| [`open`](https://github.com/sindresorhus/open) | ^10.1 | Automatyczne otwarcie przeglądarki po starcie |

---

## 📄 Licencja

Projekt dostępny na licencji **MIT**.

---

<div align="center">

*Dane przetwarzane wyłącznie lokalnie — nic nie opuszcza Twojej maszyny.*

</div>
