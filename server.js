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

// S4: trust reverse proxy so req.ip reflects the real client IP
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],
      imgSrc:         ["'self'", "data:", "blob:"],
      connectSrc:     ["'self'"],
      fontSrc:        ["'self'"],
      objectSrc:      ["'none'"],
      frameSrc:       ["'none'"],
      frameAncestors: ["'none'"],   // S5: prevent clickjacking via iframe embedding
      baseUri:        ["'self'"],   // SEC-03: prevent base tag injection
      formAction:     ["'self'"],   // SEC-03: restrict form submission targets
      workerSrc:      ["'self'"],   // SEC-03: restrict Web Worker sources
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Named constants (Q2) ──────────────────────────────────────────────────────
const RATE_WIN_MS     = 60_000;          // rate-limit window (ms)
const RATE_MAX        = 100;             // max requests per window
const MAX_RATE_IPS    = 10_000;          // SEC-01: cap rateMap size to prevent memory DoS
const MAX_FILE_SIZE   = 2 * 1024 * 1024; // 2 MB
const LOGO_SIZE_RATIO = 0.20;            // logo = 20 % of QR width
const SHARP_TIMEOUT_MS = 5_000;          // SEC-04: max time for sharp image processing
const isDev           = process.env.NODE_ENV !== 'production';

// ── Rate limiting (in-memory, per IP) ─────────────────────────────────────────
const rateMap = new Map();
function rateLimit(req, res, next) {
  const ip  = req.ip || 'unknown';
  const now = Date.now();
  const rec = rateMap.get(ip);
  if (!rec || now - rec.start > RATE_WIN_MS) {
    // SEC-01: evict oldest entry when map is full to prevent unbounded memory growth
    if (rateMap.size >= MAX_RATE_IPS) {
      rateMap.delete(rateMap.keys().next().value);
    }
    rateMap.delete(ip);
    rateMap.set(ip, { count: 1, start: now });
    return next();
  }
  if (rec.count >= RATE_MAX) return res.status(429).json({ error: 'Too many requests' });
  rec.count++;
  next();
}

// SEC-04: wrap sharp toBuffer() with a timeout to prevent hanging on large/malicious files
function withSharpTimeout(sharpInstance) {
  return Promise.race([
    sharpInstance.toBuffer(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Sharp processing timeout')), SHARP_TIMEOUT_MS)
    ),
  ]);
}

// ── QR data formatters ────────────────────────────────────────────────────────
const ALLOWED_TYPES = ['url', 'wifi', 'text', 'email', 'phone', 'sms', 'vcard'];

function escapeWifi(s) {
  return String(s).replace(/[\\;,"]/g, c => '\\' + c);
}
function escapeVCard(s) {
  // RFC 6350: escape \, ;, and , in property values
  return String(s).replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');
}
function escapeMATMSG(s) {
  // MATMSG spec: escape \ and ; in field values
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
        url   ? `URL:${escapeVCard(url)}`     : null,  // F1: was missing escapeVCard
        'END:VCARD',
      ].filter(Boolean).join('\n');
    }

    default:
      return '';
  }
}

// ── Multer: memory only, images ≤ MAX_FILE_SIZE ───────────────────────────────
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    cb(null, ALLOWED_MIME.has(file.mimetype));
  },
});

// ── Magic byte validation (S2) ────────────────────────────────────────────────
// MIME type from the client can be spoofed; verify the actual file headers.
const MAGIC_CHECKS = {
  'image/png':     buf => buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47,
  'image/jpeg':    buf => buf[0] === 0xFF && buf[1] === 0xD8,
  'image/webp':    buf => buf.slice(0, 4).toString('ascii') === 'RIFF' &&
                          buf.slice(8, 12).toString('ascii') === 'WEBP',
  'image/svg+xml': buf => {
    // SVG is XML text with no fixed binary magic; require <svg or <?xml preamble
    // SEC-02: also match <svg: namespace prefix and self-closing <svg/>
    const head = buf.slice(0, 512).toString('utf8').trimStart();
    return /^\s*(<\?xml|<svg[\s\/>:])/i.test(head);
  },
};

function validateMagicBytes(buffer, mimetype) {
  const check = MAGIC_CHECKS[mimetype];
  return check ? check(buffer) : false;
}

// ── SVG logo sanitizer (S3) ───────────────────────────────────────────────────
// Strip dangerous constructs from user-uploaded SVG files before rasterising.
function sanitizeSvgLogo(buffer) {
  let svg = buffer.toString('utf8');
  svg = svg.replace(/<script[\s\S]*?<\/script\s*>/gi, '');           // remove <script> blocks
  svg = svg.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, ''); // remove on* handlers
  svg = svg.replace(/(?:href|xlink:href)\s*=\s*["'][^"']*javascript:[^"']*["']/gi, ''); // js: hrefs
  if (/<script/i.test(svg) || /javascript\s*:/i.test(svg)) {
    throw new Error('SVG zawiera niedozwoloną treść');
  }
  return Buffer.from(svg);
}

// ── Helper: normalise options ─────────────────────────────────────────────────
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

// ── Custom SVG builder (rounded / circle dot styles) ─────────────────────────
function buildCustomSVG(text, qrOpts) {
  const { dotStyle, width, margin, errorCorrectionLevel, color } = qrOpts;
  const dark  = color.dark;
  const light = color.light;

  const qr      = QRCode.create(text, { errorCorrectionLevel });
  const size    = qr.modules.size;
  const modules = qr.modules.data;
  const total   = size + margin * 2;
  const cell    = width / total;

  const parts = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!modules[r * size + c]) continue;
      // Convert grid coordinates to SVG pixel positions, centred on each cell
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

// ── POST /api/generate ────────────────────────────────────────────────────────
app.post('/api/generate', rateLimit, async (req, res) => {
  try {
    const { type, data, options } = req.body;

    if (!ALLOWED_TYPES.includes(type))
      return res.status(400).json({ error: 'Nieprawidłowy typ QR' });

    const qrData = buildQRData(type, data || {});
    if (!qrData || !qrData.trim())
      return res.status(400).json({ error: 'Brak danych do zakodowania' });

    const format  = options?.format === 'svg' ? 'svg' : 'png';
    const qrOpts  = normaliseOptions(options);

    const { dotStyle } = qrOpts;
    const useCustom = dotStyle !== 'square';

    // Q1: per-request metadata only in development
    if (isDev) console.log(`[QR] type=${type} format=${format} size=${qrOpts.width} dots=${dotStyle}`);

    if (useCustom || format === 'svg') {
      const svg = buildCustomSVG(qrData, qrOpts);
      if (format === 'svg') return res.json({ qr: svg, format: 'svg' });
      const pngBuf = await withSharpTimeout(sharp(Buffer.from(svg)).png());
      return res.json({ qr: `data:image/png;base64,${pngBuf.toString('base64')}`, format: 'png' });
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
    try { payload = JSON.parse(req.body.payload || '{}'); } catch (e) {
      console.error('[QR] Nieprawidłowy JSON payload:', e.message);
      return res.status(400).json({ error: 'Nieprawidłowy format danych' });
    }

    const { type, data, options } = payload;

    if (!ALLOWED_TYPES.includes(type))
      return res.status(400).json({ error: 'Nieprawidłowy typ QR' });

    const qrData = buildQRData(type, data || {});
    if (!qrData || !qrData.trim())
      return res.status(400).json({ error: 'Brak danych do zakodowania' });

    const qrOpts    = normaliseOptions(options, 'H');
    const useCustom = qrOpts.dotStyle !== 'square';
    const qrBuffer  = useCustom
      ? await withSharpTimeout(sharp(Buffer.from(buildCustomSVG(qrData, qrOpts))).png())
      : await QRCode.toBuffer(qrData, qrOpts);

    if (!req.file) {
      return res.json({
        qr: `data:image/png;base64,${qrBuffer.toString('base64')}`,
        format: 'png',
      });
    }

    // S2: validate file magic bytes to prevent MIME spoofing
    if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ error: 'Nieprawidłowy format pliku' });
    }

    // S3: sanitize SVG logos before passing to sharp
    let logoBuffer = req.file.buffer;
    if (req.file.mimetype === 'image/svg+xml') {
      try {
        logoBuffer = sanitizeSvgLogo(logoBuffer);
      } catch {
        return res.status(400).json({ error: 'Plik SVG zawiera niedozwoloną treść' });
      }
    }

    // Resize logo to LOGO_SIZE_RATIO of QR width, preserve transparency
    const logoSize    = Math.floor(qrOpts.width * LOGO_SIZE_RATIO);
    const logoResized = await withSharpTimeout(
      sharp(logoBuffer)
        .resize(logoSize, logoSize, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .png()
    );

    const composited = await withSharpTimeout(
      sharp(qrBuffer)
        .composite([{ input: logoResized, gravity: 'center', blend: 'over' }])
        .png()
    );

    if (isDev) console.log(`[QR] type=${type} format=png+logo size=${qrOpts.width}`);
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
