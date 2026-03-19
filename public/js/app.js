'use strict';

// window.QRCode is provided by js/qrcode.min.js (bundled from qrcode@1.5.4)

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
  navigator.serviceWorker.register('sw.js').catch(() => {/* non-critical */});
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
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentType = btn.dataset.type;
    document.querySelectorAll('.form-fields').forEach(f => f.classList.add('hidden'));
    document.getElementById(`form-${currentType}`).classList.remove('hidden');
    scheduleGenerate();
  });
});

// ── Form input listeners (real-time) ─────────────────────────────────────────
document.querySelectorAll('input, select, textarea').forEach(el => {
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
    document.querySelectorAll('.dot-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
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

// ── Logo upload ───────────────────────────────────────────────────────────────
document.getElementById('logoPickBtn').addEventListener('click', () =>
  document.getElementById('logoFile').click()
);

document.getElementById('logoFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
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
  preview.src = '';
  preview.classList.add('hidden');
  scheduleGenerate();
});

// ── Download buttons ──────────────────────────────────────────────────────────
document.getElementById('dlPng').addEventListener('click', () => downloadQR('png'));
document.getElementById('dlSvg').addEventListener('click', () => downloadQR('svg'));

document.getElementById('copyBtn').addEventListener('click', () => {
  if (!currentQR) return;
  navigator.clipboard.writeText(currentQR.rawData || '').then(() => showToast('Skopiowano dane!'));
});

// ── History ───────────────────────────────────────────────────────────────────
document.getElementById('clearHistory').addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

renderHistory();

// ── QR data formatters (mirrors server-side logic) ────────────────────────────
function escapeWifi(s) {
  return String(s).replace(/[\\;,"]/g, c => '\\' + c);
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
      ].filter(Boolean).join('\n');
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
        const radius = (cell * 0.42).toFixed(2);
        parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius}" fill="${dark}"/>`);
      } else if (dotStyle === 'rounded') {
        const s  = cell * 0.88;
        const rx = (s * 0.35).toFixed(2);
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
      canvas.width = size;
      canvas.height = size;
      canvas.getContext('2d').drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
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

    const qrImg = new Image();
    qrImg.onload = () => {
      ctx.drawImage(qrImg, 0, 0, qrWidth, qrWidth);

      const logoImg = new Image();
      const logoUrl = URL.createObjectURL(file);
      logoImg.onload = () => {
        const logoSize = Math.floor(qrWidth * 0.20);
        const offset   = (qrWidth - logoSize) / 2;
        ctx.drawImage(logoImg, offset, offset, logoSize, logoSize);
        URL.revokeObjectURL(logoUrl);
        resolve(canvas.toDataURL('image/png'));
      };
      logoImg.onerror = () => { URL.revokeObjectURL(logoUrl); reject(new Error('Logo load failed')); };
      logoImg.src = logoUrl;
    };
    qrImg.onerror = reject;
    qrImg.src = qrDataUrl;
  });
}

// ── Local QR generation (no server required) ──────────────────────────────────
async function generateQRLocally(type, data, options) {
  const qrData  = buildQRData(type, data);
  const qrOpts  = normaliseOptions(options, logoFile ? 'H' : 'M');
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
      if (!/^\+?[\d\s\-().]{6,20}$/.test(phone)) return 'Nieprawidłowy format numeru (np. +48123456789).';
      return null;
    }

    case 'sms': {
      const phone = data.phone?.trim() || '';
      if (!phone) return 'Podaj numer telefonu.';
      if (!/^\+?[\d\s\-().]{6,20}$/.test(phone)) return 'Nieprawidłowy format numeru (np. +48123456789).';
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

// ── Debounced generation trigger ──────────────────────────────────────────────
function scheduleGenerate() {
  clearTimeout(generateTimer);
  generateTimer = setTimeout(generateQR, 300);
}

// ── Generate QR (fully local — no server) ─────────────────────────────────────
async function generateQR() {
  const data  = collectData();
  const error = getValidationError(data);

  if (formHint) {
    if (error) {
      formHint.textContent = error;
      formHint.classList.remove('hidden');
    } else {
      formHint.textContent = '';
      formHint.classList.add('hidden');
    }
  }

  if (error) {
    showPlaceholder();
    return;
  }

  const options = {
    format:               document.querySelector('input[name="format"]:checked').value,
    width:                parseInt(document.getElementById('opt-size').value),
    margin:               parseInt(document.getElementById('opt-margin').value),
    errorCorrectionLevel: document.getElementById('opt-ecl').value,
    dotStyle:             currentDotStyle,
    color: {
      dark:  document.getElementById('opt-dark').value,
      light: document.getElementById('opt-light').value,
    },
  };

  const seq = ++genSeq;
  showSpinner();

  try {
    const result = await generateQRLocally(currentType, data, options);
    if (seq !== genSeq) return; // superseded by newer call

    if (logoFile && result.format === 'png') {
      const composited = await compositeLogoOnQR(result.qr, logoFile, options.width || 300);
      if (seq !== genSeq) return;
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
    showToast('Błąd generowania – sprawdź dane');
  }
}

// ── Display result ────────────────────────────────────────────────────────────
function displayQR(result, data) {
  clearTimeout(spinnerTimeout);
  qrSpinner.classList.add('hidden');
  qrPlaceholder.classList.add('hidden');

  currentQR = { ...result, rawData: JSON.stringify(data) };

  if (result.format === 'svg') {
    qrImage.classList.add('hidden');
    qrSvgWrap.classList.remove('hidden');

    const parser = new DOMParser();
    const doc    = parser.parseFromString(result.qr, 'image/svg+xml');
    const svgEl  = doc.documentElement;
    if (svgEl.nodeName === 'parsererror' || svgEl.querySelector('parsererror')) {
      showPlaceholder();
      return;
    }
    qrSvgWrap.innerHTML = '';
    qrSvgWrap.appendChild(document.importNode(svgEl, true));
  } else {
    qrSvgWrap.classList.add('hidden');
    qrSvgWrap.innerHTML = '';
    qrImage.classList.remove('hidden');
    qrImage.src = result.qr;
  }

  previewActs.style.display = 'flex';
}

function showPlaceholder() {
  clearTimeout(spinnerTimeout);
  qrSpinner.classList.add('hidden');
  qrImage.classList.add('hidden');
  qrSvgWrap.classList.add('hidden');
  qrSvgWrap.innerHTML = '';
  qrPlaceholder.classList.remove('hidden');
  previewActs.style.display = 'none';
  currentQR = null;
}

function showSpinner() {
  qrPlaceholder.classList.add('hidden');
  qrSpinner.classList.remove('hidden');
  clearTimeout(spinnerTimeout);
  spinnerTimeout = setTimeout(() => {
    qrSpinner.classList.add('hidden');
    qrPlaceholder.classList.remove('hidden');
    showToast('Przekroczono czas oczekiwania. Spróbuj ponownie lub zmień parametry.');
  }, 10_000);
}

// ── Download ──────────────────────────────────────────────────────────────────
async function downloadQR(requestedFormat) {
  if (!currentQR) return;

  const label = `qr-${(TYPE_SAFE_NAMES[currentType] || 'qr').replace(/[^a-z0-9-]/gi, '')}-${Date.now()}`;

  if (requestedFormat === 'svg' && currentQR.format === 'svg') {
    downloadBlob(new Blob([currentQR.qr], { type: 'image/svg+xml' }), `${label}.svg`);
    return;
  }
  if (requestedFormat === 'png' && currentQR.format === 'png') {
    downloadDataUrl(currentQR.qr, `${label}.png`);
    return;
  }

  // Re-generate in the required format
  const data    = collectData();
  const options = {
    format:               requestedFormat,
    width:                parseInt(document.getElementById('opt-size').value),
    margin:               parseInt(document.getElementById('opt-margin').value),
    errorCorrectionLevel: document.getElementById('opt-ecl').value,
    dotStyle:             currentDotStyle,
    color: {
      dark:  document.getElementById('opt-dark').value,
      light: document.getElementById('opt-light').value,
    },
  };

  try {
    const result = await generateQRLocally(currentType, data, options);
    currentQR = { ...currentQR, ...result };

    if (requestedFormat === 'svg') {
      downloadBlob(new Blob([result.qr], { type: 'image/svg+xml' }), `${label}.svg`);
    } else {
      downloadDataUrl(result.qr, `${label}.png`);
    }
  } catch {
    showToast('Błąd pobierania');
  }
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = filename; a.click();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── History ───────────────────────────────────────────────────────────────────
function saveToHistory(result, data) {
  if (result.format !== 'png') return;

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

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  history.unshift({ id, type: currentType, label: TYPE_LABELS[currentType], preview, thumb: result.qr, ts: Date.now() });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  renderHistory();
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}

function renderHistory() {
  const history = loadHistory();

  const countEl = document.getElementById('historyCount');
  if (countEl) countEl.textContent = history.length ? `(${history.length}/10)` : '';

  if (!history.length) {
    historyList.innerHTML = '<li class="history-empty">Brak historii</li>';
    return;
  }

  historyList.innerHTML = '';
  history.forEach(item => {
    const li   = document.createElement('li');
    li.className = 'history-item';
    li.dataset.historyId = item.id || String(item.ts);
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.title = 'Kliknij, aby zobaczyć ponownie';

    const img  = document.createElement('img');
    img.src    = item.thumb;
    img.alt    = `QR ${item.label}`;
    img.loading = 'lazy';
    img.width  = 40;
    img.height = 40;

    const meta   = document.createElement('div');
    meta.className = 'history-meta';

    const strong = document.createElement('strong');
    strong.textContent = item.label;

    const span = document.createElement('span');
    span.textContent = item.preview;

    meta.append(strong, span);
    li.append(img, meta);
    historyList.append(li);

    li.addEventListener('click', () => {
      const current = loadHistory();
      const entry   = current.find(e => (e.id || String(e.ts)) === li.dataset.historyId);
      if (!entry) return;
      displayQR({ qr: entry.thumb, format: 'png' }, {});
    });
    li.addEventListener('keydown', e => { if (e.key === 'Enter') li.click(); });
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

toast.addEventListener('click', () => {
  clearTimeout(toastTimer);
  toast.classList.remove('show');
});
