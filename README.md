# Generator QR

Bezpieczny, w pełni lokalny generator kodów QR działający w przeglądarce. Żadne dane nie opuszczają Twojego komputera.

## Funkcje

### Obsługiwane typy kodów QR

| Typ | Opis |
|-----|------|
| **WiFi** | Automatyczne połączenie z siecią (SSID, hasło, WPA/WEP/otwarta) |
| **URL** | Adres strony internetowej (http / https) |
| **Tekst** | Dowolna treść (do 900 znaków) |
| **Email** | Gotowa wiadomość z odbiorcą, tematem i treścią |
| **Telefon** | Numer do zadzwonienia |
| **SMS** | Numer + predefiniowana treść wiadomości |
| **Kontakt (vCard)** | Wizytówka: imię, nazwisko, telefon, email, organizacja, www |

### Opcje wyglądu

- **Format wyjściowy** — SVG (skalowalny) lub PNG (rastrowy)
- **Rozmiar** — 100–1000 px
- **Kolory** — dowolny kolor modułów i tła
- **Kształt modułów** — kwadrat, zaokrąglony, kółko
- **Margines** — 0–10 modułów
- **Korekcja błędów** — L (7%) / M (15%) / Q (25%) / H (30%)
- **Logo** — nałożenie obrazu na środek kodu (PNG / JPG / WebP / SVG, max 2 MB)

### Pozostałe

- Podgląd w czasie rzeczywistym (debounce 300 ms)
- Pobieranie jako PNG lub SVG
- Kopiowanie zakodowanych danych do schowka
- Historia ostatnich 10 kodów (localStorage)
- Motyw jasny / ciemny z persystencją

---

## Wymagania

- **Node.js** ≥ 20.3.0
- **npm** ≥ 9

---

## Instalacja i uruchomienie

```bash
# 1. Sklonuj repozytorium
git clone <url-repozytorium>
cd QR-generator

# 2. Zainstaluj zależności
npm install

# 3. Uruchom
npm start
```

Aplikacja automatycznie otworzy się w przeglądarce pod adresem `http://localhost:3000`.

> Serwer nasłuchuje wyłącznie na `127.0.0.1` — nie jest dostępny z sieci zewnętrznej.

---

## Struktura projektu

```
QR-generator/
├── server.js               # Serwer Express – API + serwowanie statycznych plików
├── package.json
├── public/
│   ├── index.html          # Jednostronna aplikacja (SPA)
│   ├── css/
│   │   └── style.css       # Design system – CSS custom properties, dark mode
│   └── js/
│       └── app.js          # Logika klienta – formularze, generowanie, historia
└── README.md
```

### Przepływ danych

```
Przeglądarka (app.js)
  │  collectData() → JSON payload
  │
  ▼
POST /api/generate          ← bez logo (JSON)
POST /api/generate-with-logo ← z logo (multipart/form-data)
  │
  ▼
server.js
  ├── rateLimit()           rate limiting per IP
  ├── buildQRData()         formatowanie danych (WiFi/vCard/MATMSG/…)
  ├── normaliseOptions()    walidacja i sanitizacja opcji
  ├── buildCustomSVG()      własny renderer SVG (rounded/circle dots)
  ├── validateMagicBytes()  weryfikacja pliku po magic bytes
  ├── sanitizeSvgLogo()     sanitizacja SVG przed rasteryzacją
  └── sharp / qrcode        generowanie PNG lub SVG
  │
  ▼
{ qr: "data:image/png;base64,…" | "<svg…>", format: "png"|"svg" }
```

---

## API

### `POST /api/generate`

Generuje kod QR bez logo.

**Nagłówek:** `Content-Type: application/json`

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

**Dozwolone wartości `type`:** `url` | `wifi` | `text` | `email` | `phone` | `sms` | `vcard`

**Odpowiedź:**

```json
{ "qr": "<svg xmlns=…>…</svg>", "format": "svg" }
{ "qr": "data:image/png;base64,…", "format": "png" }
```

---

### `POST /api/generate-with-logo`

Generuje kod QR z nałożonym logo. Zawsze zwraca PNG.

**Nagłówek:** `Content-Type: multipart/form-data`

**Pola:**

| Pole | Typ | Opis |
|------|-----|------|
| `payload` | `string` (JSON) | Identyczny obiekt jak ciało `/api/generate` |
| `logo` | `File` | Plik obrazu (PNG / JPG / WebP / SVG, max 2 MB) |

**Odpowiedź:**

```json
{ "qr": "data:image/png;base64,…", "format": "png" }
```

---

## Bezpieczeństwo

Aplikacja stosuje wielowarstwową ochronę:

| Obszar | Zabezpieczenie |
|--------|---------------|
| **Nagłówki HTTP** | Helmet z CSP, `frame-ancestors: none`, `base-uri: self`, `form-action: self` |
| **Rate limiting** | 100 req / min / IP, mapa ograniczona do 10 000 wpisów (eviction FIFO) |
| **Upload plików** | Weryfikacja magic bytes dla PNG / JPEG / WebP / SVG, limit 2 MB |
| **Sanitizacja SVG** | Usuwanie `<script>`, `<style>`, atrybutów `on*`, `javascript:` href |
| **Formatowanie danych** | Escaping specyficzny dla formatu (WiFi, vCard RFC 6350, MATMSG) |
| **Przetwarzanie obrazów** | Timeout 5 s na operacje Sharp (ochrona przed DoS przez duże pliki) |
| **Wyświetlanie SVG** | `DOMParser` zamiast `innerHTML` – bez ryzyka XSS po stronie klienta |
| **Lokalność** | Serwer wyłącznie na `127.0.0.1` – brak ekspozycji w sieci |

---

## Dostępność (a11y)

- Kontrast kolorów spełnia **WCAG 2.1 AA** (≥ 4,5:1) w obu motywach
- Nawigacja klawiaturą z widocznym `:focus-visible` na wszystkich elementach interaktywnych
- `aria-label` na przyciskach ikonowych, `aria-describedby` na color pickerach
- `role="alert"` i `aria-live="polite"` na komunikatach walidacji i toastach
- Liczniki znaków przy textarea z kolorami ostrzegawczymi (90% / 100% limitu)
- Animacje wyłączane przy `prefers-reduced-motion: reduce`

---

## Zależności

| Pakiet | Wersja | Rola |
|--------|--------|------|
| `express` | ^5.2 | Serwer HTTP |
| `helmet` | ^8.1 | Nagłówki bezpieczeństwa |
| `multer` | ^2.1 | Obsługa przesyłania plików |
| `qrcode` | ^1.5 | Generowanie kodów QR |
| `sharp` | ^0.34 | Przetwarzanie obrazów (resize, composite) |
| `open` | ^10.1 | Automatyczne otwarcie przeglądarki |

---

## Licencja

MIT
