'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentType    = 'wifi';
let currentQR      = null;   // { dataUrl|svg, format, label }
let logoFile       = null;
let generateTimer  = null;
let currentDotStyle = 'square';
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
document.getElementById('togglePwd').addEventListener('click', () => {
  const input = document.getElementById('wifi-password');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  document.querySelector('.eye-open').style.display  = isHidden ? 'none'  : '';
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
  scheduleGenerate();
});

document.getElementById('logoRemove').addEventListener('click', () => {
  logoFile = null;
  document.getElementById('logoFile').value = '';
  document.getElementById('logoName').textContent = 'brak';
  document.getElementById('logoRemove').classList.add('hidden');
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

function hasEnoughData(data) {
  switch (currentType) {
    case 'wifi':   return data.ssid && data.ssid.trim().length > 0;
    case 'url':    return data.url  && data.url.trim().length > 3;
    case 'text':   return data.text && data.text.trim().length > 0;
    case 'email':  return data.to   && data.to.trim().length > 0;
    case 'phone':  return data.phone && data.phone.trim().length > 0;
    case 'sms':    return data.phone && data.phone.trim().length > 0;
    case 'vcard':  return (data.firstName || data.lastName || data.phone || data.email) &&
                          (data.firstName + data.lastName + data.phone + data.email).trim().length > 0;
    default:       return false;
  }
}

// ── Debounced generation trigger ──────────────────────────────────────────────
function scheduleGenerate() {
  clearTimeout(generateTimer);
  generateTimer = setTimeout(generateQR, 300);
}

// ── Generate QR ───────────────────────────────────────────────────────────────
async function generateQR() {
  const data = collectData();
  if (!hasEnoughData(data)) {
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

  showSpinner();

  try {
    let result;

    if (logoFile) {
      result = await generateWithLogo(data, options);
    } else {
      const resp = await fetch('/api/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: currentType, data, options }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      result = await resp.json();
    }

    displayQR(result, data);
    saveToHistory(result, data);

  } catch (err) {
    console.error('Błąd generowania QR:', err);
    showPlaceholder();
    showToast('Błąd generowania – sprawdź dane');
  }
}

async function generateWithLogo(data, options) {
  const form = new FormData();
  form.append('payload', JSON.stringify({ type: currentType, data, options }));
  form.append('logo', logoFile);

  const resp = await fetch('/api/generate-with-logo', { method: 'POST', body: form });
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

// ── Display result ────────────────────────────────────────────────────────────
function displayQR(result, data) {
  qrSpinner.classList.add('hidden');
  qrPlaceholder.classList.add('hidden');

  // Store for download/copy
  currentQR = { ...result, rawData: JSON.stringify(data) };

  if (result.format === 'svg') {
    qrImage.classList.add('hidden');
    qrSvgWrap.classList.remove('hidden');
    qrSvgWrap.innerHTML = result.qr;
  } else {
    qrSvgWrap.classList.add('hidden');
    qrSvgWrap.innerHTML = '';
    qrImage.classList.remove('hidden');
    qrImage.src = result.qr;
  }

  previewActs.style.display = 'flex';
}

function showPlaceholder() {
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
}

// ── Download ──────────────────────────────────────────────────────────────────
async function downloadQR(requestedFormat) {
  if (!currentQR) return;

  const label = makeSafeLabel();

  // If format matches what we have, use directly
  if (requestedFormat === 'svg' && currentQR.format === 'svg') {
    downloadBlob(
      new Blob([currentQR.qr], { type: 'image/svg+xml' }),
      `${label}.svg`
    );
    return;
  }

  if (requestedFormat === 'png' && currentQR.format === 'png') {
    downloadDataUrl(currentQR.qr, `${label}.png`);
    return;
  }

  // Convert: need to re-request in the other format
  const data    = collectData();
  const options = {
    format:               requestedFormat,
    width:                parseInt(document.getElementById('opt-size').value),
    margin:               parseInt(document.getElementById('opt-margin').value),
    errorCorrectionLevel: document.getElementById('opt-ecl').value,
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
    const result = await resp.json();

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
  a.href     = dataUrl;
  a.download = filename;
  a.click();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function makeSafeLabel() {
  const TYPE_LABELS = {
    wifi: 'wifi', url: 'url', text: 'tekst',
    email: 'email', phone: 'telefon', sms: 'sms', vcard: 'kontakt',
  };
  return `qr-${TYPE_LABELS[currentType] || currentType}-${Date.now()}`;
}

// ── History ───────────────────────────────────────────────────────────────────
function saveToHistory(result, data) {
  if (result.format !== 'png') return; // only store thumbnails for PNG

  const history = loadHistory();
  const TYPE_LABELS = {
    wifi: 'WiFi', url: 'URL', text: 'Tekst',
    email: 'Email', phone: 'Telefon', sms: 'SMS', vcard: 'Kontakt',
  };

  // Build a preview label (exclude WiFi password)
  let preview = '';
  switch (currentType) {
    case 'wifi':   preview = data.ssid || '–'; break;
    case 'url':    preview = data.url  || '–'; break;
    case 'text':   preview = (data.text || '').slice(0, 40); break;
    case 'email':  preview = data.to   || '–'; break;
    case 'phone':  preview = data.phone || '–'; break;
    case 'sms':    preview = data.phone || '–'; break;
    case 'vcard':  preview = `${data.firstName || ''} ${data.lastName || ''}`.trim() || '–'; break;
  }

  history.unshift({
    type:    currentType,
    label:   TYPE_LABELS[currentType],
    preview,
    thumb:   result.qr,
    ts:      Date.now(),
  });

  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  renderHistory();
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function renderHistory() {
  const history = loadHistory();

  if (!history.length) {
    historyList.innerHTML = '<li class="history-empty">Brak historii</li>';
    return;
  }

  historyList.innerHTML = history.map((item, i) => `
    <li class="history-item" data-index="${i}" role="button" tabindex="0" title="Kliknij, aby zobaczyć ponownie">
      <img src="${item.thumb}" alt="QR ${item.label}" loading="lazy" />
      <div class="history-meta">
        <strong>${item.label}</strong>
        <span>${escapeHtml(item.preview)}</span>
      </div>
    </li>
  `).join('');

  historyList.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = history[el.dataset.index];
      displayQR({ qr: item.thumb, format: 'png' }, {});
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') el.click();
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}
