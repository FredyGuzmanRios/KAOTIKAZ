/* ============================================================
   KAOTIKAZ — Backend de referencia (Node + Express)
   Este archivo muestra CÓMO se vuelve seguro el sistema.
   No es la versión final: es el esqueleto correcto para crecer.

   Instalar:  npm i express helmet express-rate-limit multer dotenv
   Ejecutar:  node server.js   (con un archivo .env, ver .env.example)
   ============================================================ */

require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const multer    = require('multer');
const crypto    = require('crypto');
const path      = require('path');

const app = express();

/* ─────────────────────────────────────────────
   1. CABECERAS DE SEGURIDAD (helmet)
   CSP, no-sniff, frame deny, etc. en una línea.
   ───────────────────────────────────────────── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:'],
      scriptSrc:  ["'self'"],
    },
  },
}));

/* ─────────────────────────────────────────────
   2. RATE LIMIT — frena bots y fuerza bruta
   ───────────────────────────────────────────── */
const limiterCompras = rateLimit({ windowMs: 10 * 60 * 1000, max: 5,
  message: { error: 'Demasiados intentos, espera 10 minutos.' } });
const limiterLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: 8,
  message: { error: 'Demasiados intentos de login.' } });

/* ─────────────────────────────────────────────
   3. SUBIDA DE COMPROBANTE — límites duros
   ───────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Solo imágenes JPG/PNG/WebP'), ok);
  },
});

/* ─────────────────────────────────────────────
   4. VALIDACIÓN SERVER-SIDE (la que sí cuenta)
   El frontend valida por UX; aquí se valida DE VERDAD,
   porque cualquiera puede mandar un POST sin pasar por tu página.
   ───────────────────────────────────────────── */
const RULES = {
  nombre:   v => /^[a-záéíóúüñ\s.]{3,80}$/i.test(v),
  email:    v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 100,
  whatsapp: v => v === '' || /^\d{10}$/.test(v),
  clabe:    v => /^\d{18}$/.test(v),
  cantidad: v => Number.isInteger(+v) && +v >= 1 && +v <= 5,
};

// Los rangos \uXXXX cubren caracteres de control e invisibles unicode
const CONTROL_CHARS = /[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g;

function sanitizeServer(str = '') {
  return String(str)
    .normalize('NFKC')
    .replace(CONTROL_CHARS, '')
    .replace(/[<>"'`\\]/g, '')
    .trim();
}

/** Anti fórmula-injection para Google Sheets: si un valor empieza
 *  con = + - @, Sheets lo ejecutaría como fórmula. Se antepone '. */
function sheetSafe(v) {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

function validarCompra(body) {
  const errores = [];
  const limpio = {};
  for (const [campo, regla] of Object.entries(RULES)) {
    const valor = sanitizeServer(body[campo]);
    if (!regla(valor)) errores.push(campo);
    limpio[campo] = sheetSafe(valor);
  }
  return { errores, limpio };
}

/* ─────────────────────────────────────────────
   5. CIFRADO EN REPOSO — AES-256-GCM con TU key
   La CLABE del cliente es dato bancario sensible: se guarda
   CIFRADA en Google Sheets. Solo tu servidor (que tiene la
   ENCRYPTION_KEY en variables de entorno de Coolify) puede leerla.
   Si alguien accede al Sheets, ve texto ilegible.
   ───────────────────────────────────────────── */
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex'); // 32 bytes en hex

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // formato: iv.tag.datos (todo base64) — autocontenido
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

function descifrar(blob) {
  const [iv, tag, datos] = blob.split('.').map(p => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
}

/* ─────────────────────────────────────────────
   6. ENDPOINTS
   ───────────────────────────────────────────── */
app.use(express.static(path.join(__dirname, '..'))); // sirve index.html, css, js

app.post('/api/compras', limiterCompras, upload.single('comprobante'), async (req, res) => {
  try {
    // Honeypot también server-side
    if (req.body.website) return res.json({ ok: true, folio: 'K-999' }); // bot: éxito falso

    const { errores, limpio } = validarCompra(req.body);
    if (!req.file) errores.push('comprobante');
    if (errores.length) return res.status(400).json({ error: 'Campos inválidos', campos: errores });

    // El monto lo calcula el SERVIDOR (nunca confiar en el precio del cliente)
    const PRECIO = 400; // TODO: leer de hoja "Config"
    const monto = +limpio.cantidad * PRECIO;

    const folio = 'K-' + String(Date.now()).slice(-6);
    const clabeCifrada = cifrar(limpio.clabe);

    /* TODO: integraciones reales —
       1. Subir req.file.buffer a Google Drive (service account)
       2. Fila en hoja "Compras": [folio, nombre, email, whatsapp,
          cantidad, monto, clabeCifrada, 'PENDIENTE', linkDrive, fecha]
       3. Email #1 al cliente (Brevo API) + email #2 al admin */

    res.json({ ok: true, folio });
  } catch (err) {
    console.error(err);
    // Nunca filtrar detalles internos al cliente
    res.status(500).json({ error: 'Error interno, intenta de nuevo.' });
  }
});

app.post('/api/login', limiterLogin, express.json(), (req, res) => {
  /* TODO: comparar hash bcrypt de ADMIN_PASSWORD (env) y emitir
     cookie de sesión httpOnly + secure + sameSite=strict. */
  res.status(501).json({ error: 'Pendiente de implementar' });
});

/* TODO: GET /api/compras (solo con sesión) → al leer, usar descifrar()
   para mostrar la CLABE SOLO al staff autenticado.
   POST /api/confirmar → QR + email con boleto.
   POST /api/rechazar  → email con motivo. */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kaotikaz backend en :${PORT}`));

/* ─────────────────────────────────────────────
   Generar tu ENCRYPTION_KEY (una sola vez, guárdala en Coolify):
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ───────────────────────────────────────────── */
