'use strict';

// window.QRCode is provided by js/qrcode.min.js (bundled from qrcode@1.5.4)

// ── Constants ─────────────────────────────────────────────────────────────────
const LOGO_SIZE_RATIO      = 0.20;   // logo covers 20 % of QR width
const CIRCLE_RADIUS_FACTOR = 0.42;   // circle dot radius  = cell × factor
const ROUNDED_SIZE_FACTOR  = 0.88;   // rounded dot size   = cell × factor
const ROUNDED_RX_FACTOR    = 0.35;   // rounded dot corner = size × factor
const SPINNER_TIMEOUT_MS   = 10_000; // abort spinner after 10 s
const LOGO_MAX_BYTES       = 2 * 1024 * 1024; // 2 MB hard cap on logo upload
const PHONE_RE             = /^\+?[\d\s\-().]{6,20}$/;

// ── State ─────────────────────────────────────────────────────────────────────
let currentType     = 'wifi';
let currentQR       = null;   // { qr, format, rawData }
let logoFile        = null;
let generateTimer   = null;
let currentDotStyle = 'square';
let spinnerTimeout  = null;
let genSeq          = 0;      // monotonic counter to discard stale results

const TYPE_LABELS = {
  wifi: 'WiFi', url: 'URL', text: 'Tekst',
  email: 'Email', phone: 'Telefon', sms: 'SMS', vcard: 'Kontakt',
};
const TYPE_SAFE_NAMES = {
  wifi: 'wifi', url: 'url', text: 'tekst',
  email: 'email', phone: 'telefon', sms: 'sms', vcard: 'kontakt',
};

const HISTORY_KEY = 'qr-history';
const MAX_HISTORY = 10;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const qrImage       = document.getElementById('qrImage');
const qrSvgWrap     = document.getElementById('qrSvgWrap');
const qrPlaceholder = document.getElementById('qrPlaceholder');
const qrSpinner     = document.getElementById('qrSpinner');
const previewActs   = document.getElementById('previewActions');
const toast         = document.getElementById('toast');
const historyList   = document.getElementById('historyList');
const sizeVal       = document.getElementById('sizeVal');
const marginVal     = document.getElementById('marginVal');
const darkHex       = document.getElementById('darkHex');
const lightHex      = document.getElementById('lightHex');
const togglePwdBtn  = document.getElementById('togglePwd');
const formHint      = document.getElementById('formHint');

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err =>
    console.warn('[SW] Rejestracja nie powiodła się:', err)
  );
}

// ── Theme ─────────────────────────────────────────────────────────────────────
(function initTheme() {
  try {
    const saved = localStorage.getItem('qr-theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  } catch {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

document.getElementById('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('qr-theme', next); } catch { /* ok */ }
});

// ── Type buttons ──────────────────────────────────────────────────────────────
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    currentType = btn.dataset.type;
    document.querySelectorAll('.form-fields').forEach(f => f.classList.add('hidden'));
    document.getElementById(`form-${currentType}`).classList.remove('hidden');
    const firstField = document.querySelector(`#form-${currentType} input, #form-${currentType} textarea, #form-${currentType} select`);
    if (firstField) firstField.focus();
    scheduleGenerate();
  });
});

// ── Form input listeners (real-time) — only form fields, not style controls ───
document.querySelectorAll('#formCard input, #formCard select, #formCard textarea').forEach(el => {
  el.addEventListener('input', scheduleGenerate);
  el.addEventListener('change', scheduleGenerate);
});

// ── Customise controls ────────────────────────────────────────────────────────
document.getElementById('opt-size').addEventListener('input', e => {
  sizeVal.textContent = e.target.value;
  scheduleGenerate();
});

document.getElementById('opt-margin').addEventListener('input', e => {
  marginVal.textContent = e.target.value;
  scheduleGenerate();
});

document.getElementById('opt-dark').addEventListener('input', e => {
  darkHex.textContent = e.target.value;
  scheduleGenerate();
});

document.getElementById('opt-light').addEventListener('input', e => {
  lightHex.textContent = e.target.value;
  scheduleGenerate();
});

document.getElementById('opt-ecl').addEventListener('change', scheduleGenerate);

document.querySelectorAll('input[name="format"]').forEach(r =>
  r.addEventListener('change', scheduleGenerate)
);

// ── Dot style buttons ─────────────────────────────────────────────────────────
document.querySelectorAll('.dot-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dot-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    currentDotStyle = btn.dataset.dot;
    scheduleGenerate();
  });
});

// ── Char counters ─────────────────────────────────────────────────────────────
[
  { textarea: 'text-content',  count: 'textCount',       wrapper: 'textCounter',       max: 900 },
  { textarea: 'email-body',    count: 'emailBodyCount',   wrapper: 'emailBodyCounter',  max: 500 },
  { textarea: 'sms-message',   count: 'smsMessageCount',  wrapper: 'smsMessageCounter', max: 160 },
].forEach(({ textarea, count, wrapper, max }) => {
  const ta   = document.getElementById(textarea);
  const cnt  = document.getElementById(count);
  const wrap = document.getElementById(wrapper);
  if (!ta || !cnt || !wrap) return;
  ta.addEventListener('input', () => {
    const len = ta.value.length;
    cnt.textContent = len;
    wrap.className = 'char-counter' +
      (len >= max ? ' at-limit' : len >= max * 0.9 ? ' near-limit' : '');
  });
});

// ── Password toggle ───────────────────────────────────────────────────────────
togglePwdBtn.addEventListener('click', () => {
  const input    = document.getElementById('wifi-password');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  togglePwdBtn.setAttribute('aria-pressed', String(isHidden));
  document.querySelector('.eye-open').style.display  = isHidden ? 'none' : '';
  document.querySelector('.eye-closed').style.display = isHidden ? '' : 'none';
});

// ── Disable WiFi password field when security = nopass ────────────────────────
document.getElementById('wifi-security').addEventListener('change', e => {
  const pwdInput = document.getElementById('wifi-password');
  const isOpen   = e.target.value === 'nopass';
  pwdInput.disabled = isOpen;
  if (isOpen) pwdInput.value = '';
});

// ── Logo upload ───────────────────────────────────────────────────────────────
document.getElementById('logoPickBtn').addEventListener('click', () =>
  document.getElementById('logoFile').click()
);

async function validateMagicBytes(file) {
  if (file.type === 'image/svg+xml') {
    // Validate SVG content starts with XML/SVG declaration — prevents MIME spoofing
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const text = new TextDecoder().decode(new Uint8Array(e.target.result));
        const t = text.trimStart();
        resolve(t.startsWith('<?xml') || t.startsWith('<svg'));
      };
      reader.onerror = () => resolve(false);
      reader.readAsArrayBuffer(file.slice(0, 256));
    });
  }
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const buf = new Uint8Array(e.target.result);
      if (file.type === 'image/png')
        resolve(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47);
      else if (file.type === 'image/jpeg')
        resolve(buf[0] === 0xFF && buf[1] === 0xD8);
      else if (file.type === 'image/webp')
        resolve(String.fromCharCode(...buf.slice(0,4)) === 'RIFF' &&
                String.fromCharCode(...buf.slice(8,12)) === 'WEBP');
      else
        resolve(false);
    };
    reader.onerror = () => resolve(false);
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

document.getElementById('logoFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > LOGO_MAX_BYTES) {
    showToast('Plik za duży — maksymalny rozmiar to 2 MB.', 'error');
    e.target.value = '';
    return;
  }
  if (!await validateMagicBytes(file)) {
    showToast('Nieprawidłowy format — użyj PNG, JPG, WebP lub SVG.', 'error');
    e.target.value = '';
    return;
  }
  logoFile = file;
  document.getElementById('logoName').textContent = file.name;
  document.getElementById('logoRemove').classList.remove('hidden');

  const preview = document.getElementById('logoPreview');
  const reader  = new FileReader();
  reader.onload = ev => {
    preview.src = ev.target.result;
    preview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);

  scheduleGenerate();
});

document.getElementById('logoRemove').addEventListener('click', () => {
  logoFile = null;
  document.getElementById('logoFile').value = '';
  document.getElementById('logoName').textContent = 'brak';
  document.getElementById('logoRemove').classList.add('hidden');
  const preview = document.getElementById('logoPreview');
  preview.removeAttribute('src');  // avoid empty-src network request
  preview.classList.add('hidden');
  scheduleGenerate();
});

// ── Download buttons ──────────────────────────────────────────────────────────
document.getElementById('dlPng').addEventListener('click', () => downloadQR('png'));
document.getElementById('dlSvg').addEventListener('click', () => downloadQR('svg'));

document.getElementById('copyBtn').addEventListener('click', () => {
  if (!currentQR) return;
  navigator.clipboard.writeText(currentQR.rawData || '')
    .then(() => showToast('Skopiowano dane!', 'success'))
    .catch(() => showToast('Nie można skopiować do schowka', 'error'));
});

// ── History ───────────────────────────────────────────────────────────────────
document.getElementById('clearHistory').addEventListener('click', () => {
  if (!confirm('Wyczyścić całą historię?')) return;
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

renderHistory();

// ── QR data formatters (mirrors server-side logic) ────────────────────────────
function escapeWifi(s) {
  // Per zxing WiFi QR spec: escape \  ;  ,  "  :
  return String(s).replace(/[\\;,":]/g, c => '\\' + c);
}
function escapeVCard(s) {
  return String(s).replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
}
function escapeMATMSG(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;');
}

function buildQRData(type, data) {
  switch (type) {
    case 'url':
      return String(data.url || '').trim();

    case 'wifi': {
      const { ssid = '', password = '', security = 'WPA', hidden = false } = data;
      return `WIFI:T:${security};S:${escapeWifi(ssid)};P:${escapeWifi(password)};H:${hidden ? 'true' : 'false'};;`;
    }

    case 'text':
      return String(data.text || '').trim();

    case 'email': {
      const { to = '', subject = '', body = '' } = data;
      return `MATMSG:TO:${escapeMATMSG(to)};SUB:${escapeMATMSG(subject)};BODY:${escapeMATMSG(body)};;`;
    }

    case 'phone':
      return `tel:${String(data.phone || '').trim()}`;

    case 'sms': {
      const { phone = '', message = '' } = data;
      const msg = message ? `?body=${encodeURIComponent(message)}` : '';
      return `smsto:${phone}${msg}`;
    }

    case 'vcard': {
      const {
        firstName = '', lastName = '',
        phone = '', email = '',
        org = '', url = '',
      } = data;
      return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`,
        `FN:${escapeVCard(`${firstName} ${lastName}`.trim())}`,
        phone ? `TEL:${escapeVCard(phone)}`   : null,
        email ? `EMAIL:${escapeVCard(email)}` : null,
        org   ? `ORG:${escapeVCard(org)}`     : null,
        url   ? `URL:${escapeVCard(url)}`     : null,
        'END:VCARD',
      ].filter(Boolean).join('\r\n');  // RFC 2426: CRLF line endings
    }

    default:
      return '';
  }
}

// ── Options normalisation ─────────────────────────────────────────────────────
const VALID_DOT_STYLES = ['square', 'rounded', 'circle'];

function normaliseOptions(opts = {}, defaultECL = 'M') {
  return {
    errorCorrectionLevel: ['L','M','Q','H'].includes(opts.errorCorrectionLevel)
      ? opts.errorCorrectionLevel : defaultECL,
    margin:   Math.min(Math.max(parseInt(opts.margin) || 2, 0), 10),
    width:    Math.min(Math.max(parseInt(opts.width)  || 300, 100), 1000),
    dotStyle: VALID_DOT_STYLES.includes(opts.dotStyle) ? opts.dotStyle : 'square',
    color: {
      dark:  /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(opts.color?.dark)
               ? opts.color.dark : '#000000',
      light: /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(opts.color?.light)
               ? opts.color.light : '#ffffff',
    },
  };
}

// ── Finder pattern helpers (for custom SVG) ───────────────────────────────────
function isFinderRegion(r, c, size) {
  return (r < 7 && c < 7) ||
         (r < 7 && c >= size - 7) ||
         (r >= size - 7 && c < 7);
}

function finderRect(cx, cy, n, cell, fill, rx) {
  const half = (n / 2) * cell;
  const x = (cx - half).toFixed(2);
  const y = (cy - half).toFixed(2);
  const s = (n * cell).toFixed(2);
  return `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${rx.toFixed(2)}" fill="${fill}"/>`;
}

function drawFinder(cx, cy, cell, dark, light, dotStyle) {
  if (dotStyle === 'circle') {
    return [
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(3.5 * cell).toFixed(2)}" fill="${dark}"/>`,
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(2.5 * cell).toFixed(2)}" fill="${light}"/>`,
      `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(1.5 * cell).toFixed(2)}" fill="${dark}"/>`,
    ].join('');
  }
  const outerRx = dotStyle === 'rounded' ? cell       : 0;
  const innerRx = dotStyle === 'rounded' ? cell * 0.5 : 0;
  return finderRect(cx, cy, 7, cell, dark,  outerRx)
       + finderRect(cx, cy, 5, cell, light, outerRx * 0.6)
       + finderRect(cx, cy, 3, cell, dark,  innerRx);
}

function buildCustomSVG(text, qrOpts) {
  const { dotStyle, width, margin, errorCorrectionLevel, color } = qrOpts;
  const dark  = color.dark;
  const light = color.light;

  // window.QRCode is the bundled qrcode@1.5.4 library
  const qr      = QRCode.create(text, { errorCorrectionLevel });
  const size    = qr.modules.size;
  const modules = qr.modules.data;
  const total   = size + margin * 2;
  const cell    = width / total;

  const parts = [];

  const finderCenters = [
    [margin + 3.5, margin + 3.5],
    [margin + 3.5, margin + size - 3.5],
    [margin + size - 3.5, margin + 3.5],
  ];
  for (const [row, col] of finderCenters) {
    parts.push(drawFinder(col * cell, row * cell, cell, dark, light, dotStyle));
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r * size + c]) continue;
      if (isFinderRegion(r, c, size)) continue;
      const cx = (c + margin + 0.5) * cell;
      const cy = (r + margin + 0.5) * cell;

      if (dotStyle === 'circle') {
        const radius = (cell * CIRCLE_RADIUS_FACTOR).toFixed(2);
        parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius}" fill="${dark}"/>`);
      } else if (dotStyle === 'rounded') {
        const s  = cell * ROUNDED_SIZE_FACTOR;
        const rx = (s  * ROUNDED_RX_FACTOR).toFixed(2);
        const x  = (cx - s / 2).toFixed(2);
        const y  = (cy - s / 2).toFixed(2);
        parts.push(`<rect x="${x}" y="${y}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" rx="${rx}" fill="${dark}"/>`);
      } else {
        const x = (cx - cell / 2).toFixed(2);
        const y = (cy - cell / 2).toFixed(2);
        parts.push(`<rect x="${x}" y="${y}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${dark}"/>`);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}"><rect width="${width}" height="${width}" fill="${light}"/>${parts.join('')}</svg>`;
}

// ── SVG → PNG via Canvas ──────────────────────────────────────────────────────
function svgToPng(svgString, size) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Canvas context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/png');
      canvas.width = 0; // release GPU memory
      resolve(dataUrl);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG render failed')); };
    img.src = url;
  });
}

// ── Logo compositing via Canvas ───────────────────────────────────────────────
function compositeLogoOnQR(qrDataUrl, file, qrWidth) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width  = qrWidth;
    canvas.height = qrWidth;
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('Canvas context unavailable')); return; }

    const qrImg = new Image();
    qrImg.onload = () => {
      ctx.drawImage(qrImg, 0, 0, qrWidth, qrWidth);

      const logoImg = new Image();
      const logoUrl = URL.createObjectURL(file);
      logoImg.onload = () => {
        const logoSize = Math.floor(qrWidth * LOGO_SIZE_RATIO);
        const offset   = (qrWidth - logoSize) / 2;
        ctx.drawImage(logoImg, offset, offset, logoSize, logoSize);
        URL.revokeObjectURL(logoUrl);
        const dataUrl = canvas.toDataURL('image/png');
        canvas.width = 0; // release GPU memory
        resolve(dataUrl);
      };
      logoImg.onerror = () => { URL.revokeObjectURL(logoUrl); reject(new Error('Logo load failed')); };
      logoImg.src = logoUrl;
    };
    qrImg.onerror = () => reject(new Error('QR image load failed'));
    qrImg.src = qrDataUrl;
  });
}

// ── Local QR generation (no server required) ──────────────────────────────────
async function generateQRLocally(type, data, options, logo = null) {
  const qrData = buildQRData(type, data);
  // Force ECL=H when logo is overlaid — mandatory for reliable scanning
  const effectiveOpts = logo ? { ...options, errorCorrectionLevel: 'H' } : options;
  const qrOpts  = normaliseOptions(effectiveOpts);
  const format  = options.format === 'svg' ? 'svg' : 'png';
  const useCustom = qrOpts.dotStyle !== 'square';

  if (useCustom || format === 'svg') {
    const svg = buildCustomSVG(qrData, qrOpts);
    if (format === 'svg') return { qr: svg, format: 'svg' };
    const pngDataUrl = await svgToPng(svg, qrOpts.width);
    return { qr: pngDataUrl, format: 'png' };
  }

  const dataUrl = await QRCode.toDataURL(qrData, {
    errorCorrectionLevel: qrOpts.errorCorrectionLevel,
    margin: qrOpts.margin,
    width:  qrOpts.width,
    color:  qrOpts.color,
    type:   'image/png',
  });
  return { qr: dataUrl, format: 'png' };
}

// ── Core: collect form data ───────────────────────────────────────────────────
function collectData() {
  switch (currentType) {
    case 'wifi':
      return {
        ssid:     document.getElementById('wifi-ssid').value,
        password: document.getElementById('wifi-password').value,
        security: document.getElementById('wifi-security').value,
        hidden:   document.getElementById('wifi-hidden').checked,
      };
    case 'url':
      return { url: document.getElementById('url-link').value };
    case 'text':
      return { text: document.getElementById('text-content').value };
    case 'email':
      return {
        to:      document.getElementById('email-to').value,
        subject: document.getElementById('email-subject').value,
        body:    document.getElementById('email-body').value,
      };
    case 'phone':
      return { phone: document.getElementById('phone-number').value };
    case 'sms':
      return {
        phone:   document.getElementById('sms-phone').value,
        message: document.getElementById('sms-message').value,
      };
    case 'vcard':
      return {
        firstName: document.getElementById('vcard-first').value,
        lastName:  document.getElementById('vcard-last').value,
        phone:     document.getElementById('vcard-phone').value,
        email:     document.getElementById('vcard-email').value,
        org:       document.getElementById('vcard-org').value,
        url:       document.getElementById('vcard-url').value,
      };
    default:
      return {};
  }
}

// ── Validation ────────────────────────────────────────────────────────────────
function getValidationError(data) {
  switch (currentType) {
    case 'wifi':
      if (!data.ssid?.trim()) return 'Podaj nazwę sieci (SSID).';
      if (data.security !== 'nopass' && !data.password?.length) return 'Podaj hasło sieci.';
      return null;

    case 'url': {
      const url = data.url?.trim() || '';
      if (!url) return 'Podaj adres URL.';
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return 'URL musi zaczynać się od http:// lub https://.';
        }
      } catch {
        return 'Nieprawidłowy format URL (np. https://example.com).';
      }
      return null;
    }

    case 'text':
      return data.text?.trim() ? null : 'Wpisz treść tekstu.';

    case 'email': {
      const email = data.to?.trim() || '';
      if (!email) return 'Podaj adres email odbiorcy.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Nieprawidłowy format adresu email.';
      return null;
    }

    case 'phone': {
      const phone = data.phone?.trim() || '';
      if (!phone) return 'Podaj numer telefonu.';
      if (!PHONE_RE.test(phone)) return 'Nieprawidłowy format numeru (np. +48123456789).';
      return null;
    }

    case 'sms': {
      const phone = data.phone?.trim() || '';
      if (!phone) return 'Podaj numer telefonu.';
      if (!PHONE_RE.test(phone)) return 'Nieprawidłowy format numeru (np. +48123456789).';
      return null;
    }

    case 'vcard':
      return (data.firstName + data.lastName + data.phone + data.email).trim()
        ? null : 'Podaj co najmniej jedno pole kontaktu.';

    default:
      return 'Brak danych.';
  }
}

function hasEnoughData(data) {
  return getValidationError(data) === null;
}

// Returns the DOM id of the first invalid field (for .has-error highlight)
function getErrorFieldId(data) {
  switch (currentType) {
    case 'wifi':
      if (!data.ssid?.trim()) return 'wifi-ssid';
      if (data.security !== 'nopass' && !data.password?.length) return 'wifi-password';
      return null;
    case 'url':    return (!data.url?.trim() || (() => { try { new URL(data.url); return false; } catch { return true; } })()) ? 'url-link' : null;
    case 'text':   return data.text?.trim() ? null : 'text-content';
    case 'email':  return (!data.to?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.to)) ? 'email-to' : null;
    case 'phone':  return (!data.phone?.trim() || !PHONE_RE.test(data.phone)) ? 'phone-number' : null;
    case 'sms':    return (!data.phone?.trim() || !PHONE_RE.test(data.phone)) ? 'sms-phone' : null;
    default:       return null;
  }
}

// ── Collect current UI options ────────────────────────────────────────────────
function collectOptions(formatOverride) {
  return {
    format:               formatOverride ?? (document.querySelector('input[name="format"]:checked')?.value ?? 'png'),
    width:                parseInt(document.getElementById('opt-size').value),
    margin:               parseInt(document.getElementById('opt-margin').value),
    errorCorrectionLevel: document.getElementById('opt-ecl').value,
    dotStyle:             currentDotStyle,
    color: {
      dark:  document.getElementById('opt-dark').value,
      light: document.getElementById('opt-light').value,
    },
  };
}

// ── Debounced generation trigger ──────────────────────────────────────────────
function scheduleGenerate() {
  clearTimeout(generateTimer);
  generateTimer = setTimeout(generateQR, 300);
}

// ── Generate QR (fully local — no server) ─────────────────────────────────────
async function generateQR() {
  const data  = collectData();
  const error = getValidationError(data);

  // Clear previous field-level error state
  document.querySelectorAll('#formCard .field-group.has-error').forEach(fg => fg.classList.remove('has-error'));

  if (formHint) {
    if (error) {
      formHint.textContent = error;
      formHint.classList.remove('hidden');
      // Apply .has-error to the specific field that triggered the error
      const errorFieldId = getErrorFieldId(data);
      if (errorFieldId) {
        document.getElementById(errorFieldId)?.closest('.field-group')?.classList.add('has-error');
      }
    } else {
      formHint.textContent = '';
      formHint.classList.add('hidden');
    }
  }

  if (error) {
    showPlaceholder();
    return;
  }

  let options = collectOptions();
  const logo    = logoFile;  // snapshot — prevents race if user removes logo during async ops

  // Logo is not composited onto SVG — warn and switch to PNG automatically
  if (logo && options.format === 'svg') {
    showToast('Logo nie jest nakładane na SVG — format zmieniony na PNG.', 'warning');
    options = { ...options, format: 'png' };
    const pngRadio = document.querySelector('input[name="format"][value="png"]');
    if (pngRadio) pngRadio.checked = true;
  }

  const seq = ++genSeq;
  showSpinner();

  try {
    const result = await generateQRLocally(currentType, data, options, logo);
    if (seq !== genSeq) return; // superseded by newer call

    if (logo && result.format === 'png') {
      const composited = await compositeLogoOnQR(result.qr, logo, Math.max(100, Math.min(1000, options.width || 300)));
      if (seq !== genSeq) return; // check AFTER async compositing too
      const final = { ...result, qr: composited };
      displayQR(final, data);
      saveToHistory(final, data);
    } else {
      displayQR(result, data);
      saveToHistory(result, data);
    }

  } catch (err) {
    if (seq !== genSeq) return;
    console.error('Błąd generowania QR:', err);
    showPlaceholder();
    showToast('Błąd generowania – sprawdź dane', 'error');
  }
}

// ── Display result ────────────────────────────────────────────────────────────
function displayQR(result, data) {
  clearTimeout(spinnerTimeout);
  qrSpinner.classList.add('hidden');
  qrPlaceholder.classList.add('hidden');

  currentQR = { ...result, rawData: JSON.stringify(data) };

  if (result.format === 'svg') {
    // Validate SVG before display
    const parser = new DOMParser();
    const doc    = parser.parseFromString(result.qr, 'image/svg+xml');
    const svgEl  = doc.documentElement;
    if (svgEl.nodeName === 'parsererror' || svgEl.querySelector('parsererror')) {
      showPlaceholder();
      showToast('Błąd renderowania SVG', 'error');
      return;
    }
    // Display via data URL — <img> sandbox prevents any SVG script execution
    qrSvgWrap.classList.add('hidden');
    qrImage.classList.remove('hidden');
    qrImage.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(result.qr);
  } else {
    qrSvgWrap.classList.add('hidden');
    qrImage.classList.remove('hidden');
    qrImage.src = result.qr;
  }

  previewActs.classList.remove('hidden');
}

function showPlaceholder() {
  clearTimeout(spinnerTimeout);
  qrSpinner.classList.add('hidden');
  qrImage.classList.add('hidden');
  qrSvgWrap.classList.add('hidden');
  qrSvgWrap.innerHTML = '';
  qrPlaceholder.classList.remove('hidden');
  previewActs.classList.add('hidden');
  currentQR = null;
}

function showSpinner() {
  qrPlaceholder.classList.add('hidden');
  qrSpinner.classList.remove('hidden');
  clearTimeout(spinnerTimeout);
  spinnerTimeout = setTimeout(() => {
    qrSpinner.classList.add('hidden');
    qrPlaceholder.classList.remove('hidden');
    showToast('Przekroczono czas oczekiwania. Spróbuj ponownie lub zmień parametry.', 'warning');
  }, SPINNER_TIMEOUT_MS);
}

// ── Download ──────────────────────────────────────────────────────────────────
async function downloadQR(requestedFormat) {
  if (!currentQR) return;

  const label = `qr-${(TYPE_SAFE_NAMES[currentType] || 'qr').replace(/[^a-z0-9-]/gi, '')}-${Date.now()}`;

  if (requestedFormat === 'svg' && currentQR.format === 'svg') {
    downloadBlob(new Blob([currentQR.qr], { type: 'image/svg+xml' }), `${label}.svg`);
    showToast('Pobrano plik SVG', 'success');
    return;
  }
  if (requestedFormat === 'png' && currentQR.format === 'png') {
    downloadDataUrl(currentQR.qr, `${label}.png`);
    showToast('Pobrano plik PNG', 'success');
    return;
  }

  // Re-generate in the requested format (don't overwrite currentQR.format)
  const data    = collectData();
  const options = collectOptions(requestedFormat);

  try {
    const result = await generateQRLocally(currentType, data, options);
    // Only update currentQR if the requested format matches what's displayed
    if (requestedFormat === currentQR.format) currentQR = { ...currentQR, ...result };

    if (requestedFormat === 'svg') {
      downloadBlob(new Blob([result.qr], { type: 'image/svg+xml' }), `${label}.svg`);
    } else {
      downloadDataUrl(result.qr, `${label}.png`);
    }
    showToast(`Pobrano plik ${requestedFormat.toUpperCase()}`, 'success');
  } catch (err) {
    console.error('Błąd pobierania:', err);
    showToast('Błąd pobierania', 'error');
  }
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename; a.click();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url); // safe to revoke immediately — browser has already queued the download
}

// ── History ───────────────────────────────────────────────────────────────────
// Types whose QR payload contains sensitive data — thumbnails not stored
const SENSITIVE_TYPES = new Set(['wifi']);

function saveToHistory(result, data) {
  const history = loadHistory();
  let preview = '';
  switch (currentType) {
    case 'wifi':   preview = data.ssid   || '–'; break;
    case 'url':    preview = data.url    || '–'; break;
    case 'text':   preview = (data.text  || '').slice(0, 40); break;
    case 'email':  preview = data.to     || '–'; break;
    case 'phone':  preview = data.phone  || '–'; break;
    case 'sms':    preview = data.phone  || '–'; break;
    case 'vcard':  preview = `${data.firstName || ''} ${data.lastName || ''}`.trim() || '–'; break;
  }

  // Don't store thumbnail for sensitive types (WiFi QR encodes the password)
  // Also skip for SVG format (not a PNG data URL)
  const thumb = (!SENSITIVE_TYPES.has(currentType) && result.format === 'png')
    ? result.qr : null;

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const rawData = SENSITIVE_TYPES.has(currentType) ? null : JSON.stringify(data);
  history.unshift({ id, type: currentType, label: TYPE_LABELS[currentType], preview, thumb, rawData, ts: Date.now() });
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      showToast('Brak miejsca w historii – wyczyść ją, aby zwolnić pamięć.', 'warning');
    }
  }
  renderHistory();
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

// ── Relative time helper ──────────────────────────────────────────────────────
function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)     return 'przed chwilą';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)} min temu`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} godz. temu`;
  return new Date(ts).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
}

// ── Delegated history list listeners (ONE listener — no memory leak) ──────────
historyList.addEventListener('click', e => {
  const delBtn = e.target.closest('.history-item-delete');
  if (delBtn) {
    const li = delBtn.closest('.history-item');
    if (!li || !confirm('Usunąć ten wpis z historii?')) return;
    const updated = loadHistory().filter(h => (h.id || String(h.ts)) !== li.dataset.historyId);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(updated)); } catch { /* ok */ }
    renderHistory();
    return;
  }
  const li = e.target.closest('.history-item');
  if (!li) return;
  const entry = loadHistory().find(h => (h.id || String(h.ts)) === li.dataset.historyId);
  if (!entry?.thumb) {
    const reason = SENSITIVE_TYPES.has(entry?.type)
      ? 'Kod WiFi nie zapisuje podglądu ze względów bezpieczeństwa.'
      : 'Brak miniatury — wygeneruj kod ponownie.';
    showToast(reason, 'info');
    return;
  }
  const restoredData = entry.rawData ? JSON.parse(entry.rawData) : {};
  displayQR({ qr: entry.thumb, format: 'png' }, restoredData);
});

historyList.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const li = e.target.closest('.history-item[role="button"]');
  if (li) { e.preventDefault(); li.click(); }
});

function renderHistory() {
  const history = loadHistory();

  const countEl = document.getElementById('historyCount');
  if (countEl) countEl.textContent = history.length ? `(${history.length}/10)` : '';

  if (!history.length) {
    historyList.innerHTML = '<li class="history-empty">Brak historii</li>';
    return;
  }

  // Use replaceChildren to avoid innerHTML but also clear old nodes cleanly
  historyList.replaceChildren();

  history.forEach(item => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.dataset.historyId = item.id || String(item.ts);
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.title = 'Kliknij, aby zobaczyć ponownie';

    // Thumbnail or placeholder
    if (item.thumb) {
      const img    = document.createElement('img');
      img.src      = item.thumb;
      img.alt      = `QR ${item.label}`;
      img.loading  = 'lazy';
      img.width    = 40;
      img.height   = 40;
      li.append(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'history-thumb-placeholder';
      ph.setAttribute('aria-hidden', 'true');
      // Static SVG icon — hardcoded, safe to use innerHTML here
      ph.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="5" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="16" y="5" width="3" height="3" fill="currentColor" stroke="none"/><rect x="5" y="16" width="3" height="3" fill="currentColor" stroke="none"/><rect x="14" y="14" width="2" height="2" fill="currentColor" stroke="none"/><rect x="18" y="14" width="2" height="2" fill="currentColor" stroke="none"/><rect x="14" y="18" width="2" height="2" fill="currentColor" stroke="none"/><rect x="18" y="18" width="2" height="2" fill="currentColor" stroke="none"/></svg>';
      li.append(ph);
    }

    // Meta: label + preview + relative time
    const meta   = document.createElement('div');
    meta.className = 'history-meta';
    const strong = document.createElement('strong');
    strong.textContent = item.label;
    const span = document.createElement('span');
    span.textContent = item.preview;
    const time = document.createElement('small');
    time.className = 'history-time';
    time.textContent = formatRelativeTime(item.ts);
    meta.append(strong, span, time);

    // Delete button with SVG × icon
    const delBtn = document.createElement('button');
    delBtn.className = 'history-item-delete';
    delBtn.setAttribute('type', 'button');
    delBtn.setAttribute('aria-label', `Usuń ${item.label}`);
    delBtn.innerHTML = '<svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="11" y2="11"/><line x1="11" y1="1" x2="1" y2="11"/></svg>';

    li.append(meta, delBtn);
    historyList.append(li);
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
/**
 * @param {string} msg
 * @param {'info'|'success'|'error'|'warning'} [type]
 */
function showToast(msg, type = 'info') {
  toast.textContent = msg;
  toast.className = `toast show toast--${type}`;
  // Use assertive role for errors/warnings so AT announces immediately
  toast.setAttribute('role', (type === 'error' || type === 'warning') ? 'alert' : 'status');
  clearTimeout(toastTimer);
  const duration = Math.max(3500, msg.length * 60); // longer messages stay longer
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

toast.addEventListener('click', () => {
  clearTimeout(toastTimer);
  toast.classList.remove('show');
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && toast.classList.contains('show')) {
    clearTimeout(toastTimer);
    toast.classList.remove('show');
  }
});
