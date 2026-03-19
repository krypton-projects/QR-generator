'use strict';

const express = require('express');
const helmet  = require('helmet');
const multer  = require('multer');
const QRCode  = require('qrcode');
const sharp   = require('sharp');
const path    = require('path');
const open    = require('open');

const app  = express();
const PORT = 3000;

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Rate limiting (in-memory, per IP) ─────────────────────────────────────────
const rateMap = new Map();
function rateLimit(req, res, next) {
  const ip  = req.ip || 'unknown';
  const now = Date.now();
  const WIN = 60_000;
  const MAX = 100;
  const rec = rateMap.get(ip);
  if (!rec || now - rec.start > WIN) {
    rateMap.set(ip, { count: 1, start: now });
    return next();
  }
  if (rec.count >= MAX) return res.status(429).json({ error: 'Too many requests' });
  rec.count++;
  next();
}

// ── QR data formatters ────────────────────────────────────────────────────────
const ALLOWED_TYPES = ['url', 'wifi', 'text', 'email', 'phone', 'sms', 'vcard'];

function escapeWifi(s) {
  return String(s).replace(/[\\;,"]/g, c => '\\' + c);
}

function buildQRData(type, data) {
  switch (type) {
    case 'url':
      return String(data.url || '').trim();

    case 'wifi': {
      const { ssid = '', password = '', security = 'WPA', hidden = false } = data;
      // NOTE: password intentionally not logged anywhere
      return `WIFI:T:${security};S:${escapeWifi(ssid)};P:${escapeWifi(password)};H:${hidden ? 'true' : 'false'};;`;
    }

    case 'text':
      return String(data.text || '').trim();

    case 'email': {
      const { to = '', subject = '', body = '' } = data;
      return `MATMSG:TO:${to};SUB:${subject};BODY:${body};;`;
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
        `N:${lastName};${firstName};;;`,
        `FN:${firstName} ${lastName}`.trim(),
        phone ? `TEL:${phone}`   : null,
        email ? `EMAIL:${email}` : null,
        org   ? `ORG:${org}`     : null,
        url   ? `URL:${url}`     : null,
        'END:VCARD',
      ].filter(Boolean).join('\n');
    }

    default:
      return '';
  }
}

// ── Multer: memory only, images ≤ 2 MB ───────────────────────────────────────
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    cb(null, ALLOWED_MIME.has(file.mimetype));
  },
});

// ── Helper: normalise options ─────────────────────────────────────────────────
function normaliseOptions(opts = {}, defaultECL = 'M') {
  return {
    errorCorrectionLevel: ['L','M','Q','H'].includes(opts.errorCorrectionLevel)
      ? opts.errorCorrectionLevel : defaultECL,
    margin: Math.min(Math.max(parseInt(opts.margin) || 2, 0), 10),
    width:  Math.min(Math.max(parseInt(opts.width)  || 300, 100), 1000),
    color: {
      dark:  /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(opts.color?.dark)
               ? opts.color.dark : '#000000',
      light: /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(opts.color?.light)
               ? opts.color.light : '#ffffff',
    },
  };
}

// ── POST /api/generate ────────────────────────────────────────────────────────
app.post('/api/generate', rateLimit, async (req, res) => {
  try {
    const { type, data, options } = req.body;

    if (!ALLOWED_TYPES.includes(type))
      return res.status(400).json({ error: 'Nieprawidłowy typ QR' });

    const qrData = buildQRData(type, data || {});
    if (!qrData)
      return res.status(400).json({ error: 'Brak danych do zakodowania' });

    const format  = options?.format === 'svg' ? 'svg' : 'png';
    const qrOpts  = normaliseOptions(options);

    // Log only metadata – never the actual QR content
    console.log(`[QR] type=${type} format=${format} size=${qrOpts.width}`);

    if (format === 'svg') {
      const svg = await QRCode.toString(qrData, { ...qrOpts, type: 'svg' });
      return res.json({ qr: svg, format: 'svg' });
    }

    const dataUrl = await QRCode.toDataURL(qrData, qrOpts);
    res.json({ qr: dataUrl, format: 'png' });

  } catch (err) {
    console.error('[QR] Błąd generowania:', err.message);
    res.status(500).json({ error: 'Generowanie nie powiodło się' });
  }
});

// ── POST /api/generate-with-logo ──────────────────────────────────────────────
app.post('/api/generate-with-logo', rateLimit, upload.single('logo'), async (req, res) => {
  try {
    let payload = {};
    try { payload = JSON.parse(req.body.payload || '{}'); } catch { /* ignore */ }

    const { type, data, options } = payload;

    if (!ALLOWED_TYPES.includes(type))
      return res.status(400).json({ error: 'Nieprawidłowy typ QR' });

    const qrData = buildQRData(type, data || {});
    if (!qrData)
      return res.status(400).json({ error: 'Brak danych do zakodowania' });

    // Use H error correction when logo covers the center
    const qrOpts = normaliseOptions(options, 'H');
    const qrBuffer = await QRCode.toBuffer(qrData, qrOpts);

    if (!req.file) {
      return res.json({
        qr: `data:image/png;base64,${qrBuffer.toString('base64')}`,
        format: 'png',
      });
    }

    // Resize logo to ~20 % of QR width, preserve transparency
    const logoSize = Math.floor(qrOpts.width * 0.20);
    const logoResized = await sharp(req.file.buffer)
      .resize(logoSize, logoSize, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();

    const composited = await sharp(qrBuffer)
      .composite([{ input: logoResized, gravity: 'center', blend: 'over' }])
      .png()
      .toBuffer();

    console.log(`[QR] type=${type} format=png+logo size=${qrOpts.width}`);
    res.json({
      qr: `data:image/png;base64,${composited.toString('base64')}`,
      format: 'png',
    });

  } catch (err) {
    console.error('[QR] Błąd generowania z logo:', err.message);
    res.status(500).json({ error: 'Generowanie nie powiodło się' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Lokalny generator QR działa na: ${url}`);
  console.log('  Dane przetwarzane wyłącznie lokalnie – nic nie opuszcza maszyny.\n');
  open(url).catch(() => {
    console.log(`  Otwórz ręcznie: ${url}`);
  });
});
