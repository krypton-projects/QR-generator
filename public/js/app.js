'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentType     = 'wifi';
let currentQR       = null;   // { qr, format, rawData }
let logoFile        = null;
let generateTimer   = null;
let currentDotStyle = 'square';
let abortCtrl       = null;   // cancel in-flight requests
let spinnerTimeout  = null;   // prevent infinite spinner

// Q2: single source of truth for type labels
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
const formHint      = document.getElementById('formHint');  // U2: validation hint

// ── Theme ─────────────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('qr-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

document.getElementById('themeToggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('qr-theme', next);
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

// U2: returns null when data is sufficient, or a hint string why it isn't
function getValidationError(data) {
  switch (currentType) {
    case 'wifi':
      if (!data.ssid?.trim()) return 'Podaj nazwę sieci (SSID).';
      if (data.security !== 'nopass' && !data.password?.length) return 'Podaj hasło sieci.';
      return null;

    case 'url': {
      const url = data.url?.trim() || '';
      if (!url) return 'Podaj adres URL.';
      // F2: validate URL structure with the browser URL API
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
      // U4: validate email format, not just non-empty
      const email = data.to?.trim() || '';
      if (!email) return 'Podaj adres email odbiorcy.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Nieprawidłowy format adresu email.';
      return null;
    }

    case 'phone': {
      // U6: basic phone format validation
      const phone = data.phone?.trim() || '';
      if (!phone) return 'Podaj numer telefonu.';
      if (!/^\+?[\d\s\-().]{6,20}$/.test(phone)) return 'Nieprawidłowy format numeru (np. +48123456789).';
      return null;
    }

    case 'sms': {
      // U6: basic phone format validation for SMS
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

// ── Generate QR ───────────────────────────────────────────────────────────────
async function generateQR() {
  const data  = collectData();
  const error = getValidationError(data);

  // U2: show/hide inline validation hint
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

  // Cancel any previous in-flight request
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  const { signal } = abortCtrl;

  showSpinner();

  try {
    let result;

    if (logoFile) {
      result = await generateWithLogo(data, options, signal);
    } else {
      const resp = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: currentType, data, options }),
        signal,
      });
      if (!resp.ok) throw new Error(await resp.text());
      result = await resp.json();
    }

    displayQR(result, data);
    saveToHistory(result, data);

  } catch (err) {
    if (err.name === 'AbortError') return; // silently ignore cancelled requests
    console.error('Błąd generowania QR:', err);
    showPlaceholder();
    showToast('Błąd generowania – sprawdź dane');
  }
}

async function generateWithLogo(data, options, signal) {
  const form = new FormData();
  form.append('payload', JSON.stringify({ type: currentType, data, options }));
  form.append('logo', logoFile);

  const resp = await fetch('/api/generate-with-logo', { method: 'POST', body: form, signal });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
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

    // S1: use DOMParser instead of innerHTML to avoid potential XSS
    const parser = new DOMParser();
    const doc    = parser.parseFromString(result.qr, 'image/svg+xml');
    const svgEl  = doc.documentElement;
    // DOMParser signals parse errors via a <parsererror> element
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
  // auto-hide spinner after 10 s to prevent infinite state
  clearTimeout(spinnerTimeout);
  spinnerTimeout = setTimeout(() => {
    qrSpinner.classList.add('hidden');
    qrPlaceholder.classList.remove('hidden');
    showToast('Przekroczono czas oczekiwania');
  }, 10_000);
}

// ── Download ──────────────────────────────────────────────────────────────────
async function downloadQR(requestedFormat) {
  if (!currentQR) return;

  const label = `qr-${TYPE_SAFE_NAMES[currentType] || currentType}-${Date.now()}`;

  if (requestedFormat === 'svg' && currentQR.format === 'svg') {
    downloadBlob(new Blob([currentQR.qr], { type: 'image/svg+xml' }), `${label}.svg`);
    return;
  }
  if (requestedFormat === 'png' && currentQR.format === 'png') {
    downloadDataUrl(currentQR.qr, `${label}.png`);
    return;
  }

  // Re-request in the required format
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
    const resp = await fetch('/api/generate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: currentType, data, options }),
    });
    // F3: check HTTP status before parsing response body
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();

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

  // F4: use a unique id (ts + random) so stale index from another tab can't cause mismatches
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

  if (!history.length) {
    historyList.innerHTML = '<li class="history-empty">Brak historii</li>';
    return;
  }

  historyList.innerHTML = '';
  history.forEach(item => {
    const li   = document.createElement('li');
    li.className = 'history-item';
    // F4: store unique id instead of mutable index for safe lookup
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
      // F4: look up by unique id, immune to concurrent tab modifications
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
  // U5: extended duration (3.5 s) and click-to-dismiss
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}

// U5: clicking the toast dismisses it immediately
toast.addEventListener('click', () => {
  clearTimeout(toastTimer);
  toast.classList.remove('show');
});
