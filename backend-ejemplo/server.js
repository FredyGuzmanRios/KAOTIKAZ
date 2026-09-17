/* ============================================================
   KAOTIKAZ — Backend (Node + Express)
   Integraciones reales: Google Sheets/Drive + Brevo + panel staff.
   QR real (lib/qr.js, librería `qrcode`, sin terceros) + escaneo
   de acceso en /escaneo.html (POST /api/escanear marca el boleto
   como usado para evitar reingresos con captura de pantalla).

   Instalar:  npm install          (dentro de backend-ejemplo/)
   Ejecutar:  npm start            (con .env, ver .env.example)
   Preparar:  npm run init-sheet   (crea encabezados en el Sheet)
   ============================================================ */

require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const multer    = require('multer');
const crypto    = require('crypto');
const path      = require('path');
const bcrypt    = require('bcryptjs');

const g      = require('./lib/google');
const brevo  = require('./lib/brevo');
const { generarQr } = require('./lib/qr');
const sesion = require('./lib/sesion');
const { precioVigente } = require('./lib/precio');
const { validarCompra, detectarImagen, sanitizeServer } = require('./lib/validacion');
const { hashAdminVigente, RE_BCRYPT } = require('./lib/auth');

const app = express();
app.set('trust proxy', 1); // detrás del proxy de Coolify

/* ───────────── 1. Seguridad base ───────────── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:     ["'self'", 'data:'],
      scriptSrc:  ["'self'", 'https://challenges.cloudflare.com', 'https://cdn.jsdelivr.net'],
      frameSrc:   ['https://challenges.cloudflare.com'],
      connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
    },
  },
}));

// En NODE_ENV=test se sube el tope: las pruebas de integración (ver
// test/compras-integration.test.js) hacen varias llamadas seguidas desde
// la misma IP (127.0.0.1) y no deben chocar con el límite pensado para
// gente real. En producción (NODE_ENV=production, ver .env.example)
// esto NO cambia nada.
const ES_TEST = process.env.NODE_ENV === 'test';
const limiterCompras = rateLimit({ windowMs: 10 * 60 * 1000, max: ES_TEST ? 1000 : 5,
  message: { error: 'Demasiados intentos, espera 10 minutos.' } });
const limiterLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: ES_TEST ? 1000 : 8,
  message: { error: 'Demasiados intentos de login.' } });
const limiterEscaneo = rateLimit({ windowMs: 60 * 1000, max: ES_TEST ? 1000 : 40,
  message: { error: 'Muchos escaneos seguidos, espera un momento.' } });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    // Primer filtro barato por MIME declarado; la verificación REAL
    // por contenido (magic bytes) se hace después con detectarImagen().
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Solo imágenes JPG/PNG/WebP'), ok);
  },
});

/** CAPTCHA Cloudflare Turnstile (gratis). Solo se usa si
 *  TURNSTILE_SECRET está configurado — ver SETUP.md §9. */
async function verificarTurnstile(token, ip) {
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: process.env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    const json = await res.json();
    return json.success === true;
  } catch (e) {
    console.error('Turnstile no respondió:', e.message);
    return false; // ante la duda, rechazar
  }
}

/* ───────────── 2. Validación server-side ───────────── */
// (extraída a lib/validacion.js: RULES, sanitizeServer, sheetSafe,
// validarCompra, detectarImagen — así se puede probar con pruebas
// unitarias sin levantar el servidor completo. Ver test/validacion.test.js)

/* ───────────── 3. Cifrado en reposo (CLABE) ───────────── */
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '', 'hex');

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

function descifrar(blob) {
  try {
    const [iv, tag, datos] = blob.split('.').map(p => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(datos), decipher.final()]).toString('utf8');
  } catch { return '(no descifrable)'; }
}

function ahora() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Mexico_City' }).slice(0, 16);
}

/* ───────────── 4. Endpoints públicos ───────────── */
const PUBLIC_DIR = path.join(__dirname, '..');

// Solo estas subcarpetas se sirven como estáticos (css, js, fuentes/imágenes).
// NUNCA servir PUBLIC_DIR completo: expondría server.js, lib/, SETUP.md,
// Dockerfile y cualquier secreto que quede en la raíz del repo (p. ej. el
// JSON de la cuenta de servicio de Google si algún día se copia ahí).
app.use('/css', express.static(path.join(PUBLIC_DIR, 'css')));
app.use('/js', express.static(path.join(PUBLIC_DIR, 'js')));
app.use('/assets', express.static(path.join(PUBLIC_DIR, 'assets')));

// Páginas HTML públicas, una por una (mismas URLs que antes).
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/aviso-privacidad.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'aviso-privacidad.html')));
app.get('/escaneo.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'escaneo.html')));

/** Config pública para el frontend (solo datos NO sensibles).
 *  precio: la landing lo usa para mostrar el total correcto (ver
 *  lib/precio.js — lógica interna por fecha, ya no depende del Sheet). */
app.get('/api/config', (req, res) => {
  res.json({
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null,
    precio: precioVigente(),
  });
});

app.post('/api/compras', limiterCompras, upload.single('comprobante'), async (req, res) => {
  try {
    if (req.body.website) return res.json({ ok: true, folio: 'K-999' }); // honeypot

    const { errores, limpio } = validarCompra(req.body);

    // Tipo REAL del archivo por contenido, no por MIME declarado
    const tipoReal = req.file ? detectarImagen(req.file.buffer) : null;
    if (!tipoReal) errores.push('comprobante');
    if (errores.length) return res.status(400).json({ error: 'Campos inválidos', campos: errores });

    // CAPTCHA (Cloudflare Turnstile) — activo solo si hay secret configurado
    if (process.env.TURNSTILE_SECRET) {
      const okCaptcha = await verificarTurnstile(req.body['cf-turnstile-response'], req.ip);
      if (!okCaptcha) return res.status(400).json({ error: 'Verificación anti-bot fallida, recarga la página.' });
    }

    // Precio: lógica interna por fecha (lib/precio.js); NUNCA el que mande el cliente
    const PRECIO = precioVigente();
    const monto = +limpio.cantidad * PRECIO;

    const folio = 'K-' + String(Date.now()).slice(-6);

    // 1. Comprobante a Drive (con el tipo REAL detectado)
    const comprobante = await g.subirComprobante(req.file.buffer, tipoReal, folio);

    // 2. Fila en el Sheet (esto es lo que ve el panel staff)
    await g.agregarCompra({
      folio, fecha: ahora(),
      nombre: limpio.nombre, email: limpio.email, whatsapp: limpio.whatsapp,
      cantidad: limpio.cantidad, monto,
      // clabeCifrada: ya no se recolecta (ver nota en RULES arriba);
      // la columna se queda vacía para compras nuevas.
      comprobante, estado: 'PENDIENTE',
      qrEnviado: 'NO', emailRegistro: 'NO', emailConfirmacion: 'NO',
    });

    // 3. Correos (si Brevo falla, la compra YA quedó registrada)
    try {
      await brevo.enviarCorreo({
        to: limpio.email,
        ...brevo.plantillaRegistro({ folio, nombre: limpio.nombre, cantidad: limpio.cantidad, monto }),
      });
      await g.actualizarCompra(folio, { emailRegistro: 'SI' });
    } catch (e) { console.error('Email registro falló:', e.message); }

    try {
      if (process.env.ADMIN_EMAIL) {
        await brevo.enviarCorreo({
          to: process.env.ADMIN_EMAIL,
          ...brevo.plantillaAdmin({ folio, nombre: limpio.nombre, email: limpio.email,
            whatsapp: limpio.whatsapp, cantidad: limpio.cantidad, monto, comprobante }),
        });
      }
    } catch (e) { console.error('Email admin falló:', e.message); }

    // 4. Notificación WhatsApp SIN API: el cliente te avisa con un tap.
    //    Link wa.me a TU número con mensaje prellenado (ver SETUP.md §4).
    const saltoLinea = String.fromCharCode(10);
    const waLink = process.env.ADMIN_WHATSAPP
      ? `https://wa.me/${process.env.ADMIN_WHATSAPP}?text=${encodeURIComponent(
          `🎟 Nuevo registro Kaotikaz${saltoLinea}Folio: ${folio}${saltoLinea}Soy: ${limpio.nombre}${saltoLinea}Boletos: ${limpio.cantidad} ($${monto} MXN)`)}`
      : null;

    res.json({ ok: true, folio, monto, waLink });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno, intenta de nuevo.' });
  }
});

/* ───────────── 5. Login staff ───────────── */
// (hashAdminVigente vive en lib/auth.js — blindaje contra el signo $ de
// bcrypt corrompiéndose en variables de entorno mal configuradas. Ver
// test/auth.test.js.)

// Diagnostico al arrancar: nunca imprime el hash ni la contraseña, solo si
// el formato final es el esperado -- para poder revisar en los logs de
// Coolify sin exponer secretos si el login sigue fallando.
{
  const hashFinal = hashAdminVigente(process.env.ADMIN_PASSWORD_HASH);
  const usuarioCargado = process.env.ADMIN_USER || '';
  console.log('[login] ADMIN_USER cargado:', JSON.stringify(usuarioCargado),
    `(${usuarioCargado.length} caracteres)`);
  console.log('[login] ADMIN_PASSWORD_HASH tiene formato bcrypt valido:',
    RE_BCRYPT.test(hashFinal) ? 'SI' : 'NO -- revisar la variable en Coolify (ver comentario arriba)');
}

app.post('/api/login', limiterLogin, express.json(), async (req, res) => {
  const { usuario, password } = req.body || {};
  const okUser = String(usuario || '').trim() === (process.env.ADMIN_USER || '').trim();
  const okPass = await bcrypt.compare(String(password || ''), hashAdminVigente(process.env.ADMIN_PASSWORD_HASH));
  if (!okUser || !okPass) return res.status(401).json({ error: 'Credenciales incorrectas' });
  sesion.setCookie(res, sesion.crearToken(usuario), req);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => { sesion.clearCookie(res); res.json({ ok: true }); });

/* ───────────── 6. Endpoints staff (requieren sesión) ───────────── */
app.get('/api/compras', sesion.requiereSesion, async (req, res) => {
  try {
    const compras = await g.listarCompras();
    // La CLABE solo se descifra para staff autenticado
    res.json(compras.map(c => ({
      folio: c.folio, fecha: c.fecha, nombre: c.nombre, email: c.email,
      whatsapp: c.whatsapp, cantidad: +c.cantidad || 0, monto: +c.monto || 0,
      clabe: c.clabeCifrada ? descifrar(c.clabeCifrada) : '',
      // El panel NUNCA recibe el link directo de Drive: usa el proxy autenticado
      comprobante: c.comprobante ? `/api/comprobante/${c.folio}` : '',
      estado: c.estado,
      validado: c.validado, qrEnviado: c.qrEnviado === 'SI',
      escaneadoEn: c.escaneadoEn || '',
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo leer el registro.' });
  }
});

/** Comprobante SIN link público: el servidor lo descarga de Drive con
 *  la service account y lo sirve SOLO a staff con sesión válida. */
app.get('/api/comprobante/:folio', sesion.requiereSesion, async (req, res) => {
  try {
    const folio = sanitizeServer(req.params.folio);
    const compras = await g.listarCompras();
    const compra = compras.find(c => c.folio === folio);
    if (!compra || !compra.comprobante) return res.status(404).json({ error: 'Sin comprobante' });

    const archivo = await g.descargarComprobante(compra.comprobante);
    if (!archivo) return res.status(404).json({ error: 'Archivo no disponible' });

    res.setHeader('Content-Type', archivo.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(archivo.buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar el comprobante.' });
  }
});

app.post('/api/confirmar', sesion.requiereSesion, express.json(), async (req, res) => {
  try {
    const folio = sanitizeServer(req.body.folio);
    const compras = await g.listarCompras();
    const compra = compras.find(c => c.folio === folio);
    if (!compra) return res.status(404).json({ error: 'Folio no encontrado' });
    if (compra.estado === 'CONFIRMADO') return res.status(409).json({ error: 'Ya estaba confirmado' });

    // QR real: lo generamos nosotros (lib/qr.js, librería `qrcode`),
    // sin depender de ningún servicio externo.
    const { codigo, pngBuffer } = await generarQr(folio);
    const qrDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;

    await brevo.enviarCorreo({
      to: compra.email,
      ...brevo.plantillaConfirmacion({ folio, nombre: compra.nombre,
        cantidad: compra.cantidad, codigoQr: codigo, qrDataUrl }),
      // Brevo no soporta imágenes inline (cid) en su API, así que además
      // del <img> con data-URI (best-effort según el cliente de correo)
      // el PNG va adjunto como archivo — el cliente siempre puede
      // guardarlo/imprimirlo aunque el correo no muestre la imagen inline.
      attachment: [{ name: `boleto-${folio}.png`, content: pngBuffer.toString('base64') }],
    });

    await g.actualizarCompra(folio, {
      estado: 'CONFIRMADO', validado: ahora(),
      codigoQr: codigo, qrEnviado: 'SI', emailConfirmacion: 'SI',
    });

    res.json({ ok: true, folio, codigoQr: codigo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo confirmar.' });
  }
});

/** Escaneo de acceso en la puerta: valida el código del QR y lo marca
 *  como usado (una sola vez) para evitar reingresos con captura de
 *  pantalla del mismo boleto. Requiere sesión de staff. */
app.post('/api/escanear', sesion.requiereSesion, limiterEscaneo, express.json(), async (req, res) => {
  try {
    const codigoQr = sanitizeServer(req.body.codigoQr).slice(0, 100);
    if (!codigoQr) return res.status(400).json({ error: 'Código vacío', resultado: 'ERROR' });

    const compras = await g.listarCompras();
    const compra = compras.find(c => c.codigoQr === codigoQr);

    if (!compra) {
      return res.status(404).json({ error: 'Código no reconocido', resultado: 'NO_ENCONTRADO' });
    }
    if (compra.estado !== 'CONFIRMADO') {
      return res.status(409).json({ error: 'Este boleto no está confirmado', resultado: 'NO_CONFIRMADO',
        folio: compra.folio, nombre: compra.nombre });
    }
    if (compra.escaneadoEn) {
      // Ya se usó: NO se vuelve a marcar. Se informa la fecha/hora del
      // primer ingreso para que el staff decida (posible reingreso o
      // captura de pantalla compartida).
      return res.status(409).json({ error: 'Este boleto YA FUE ESCANEADO', resultado: 'YA_USADO',
        folio: compra.folio, nombre: compra.nombre, cantidad: +compra.cantidad || 0,
        escaneadoEn: compra.escaneadoEn });
    }

    await g.actualizarCompra(compra.folio, { escaneadoEn: ahora() });
    res.json({ ok: true, resultado: 'OK', folio: compra.folio, nombre: compra.nombre,
      cantidad: +compra.cantidad || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo validar el escaneo.', resultado: 'ERROR' });
  }
});

app.post('/api/rechazar', sesion.requiereSesion, express.json(), async (req, res) => {
  try {
    const folio = sanitizeServer(req.body.folio);
    const motivo = sanitizeServer(req.body.motivo).slice(0, 300);
    if (!motivo) return res.status(400).json({ error: 'Falta el motivo' });

    const compras = await g.listarCompras();
    const compra = compras.find(c => c.folio === folio);
    if (!compra) return res.status(404).json({ error: 'Folio no encontrado' });

    try {
      await brevo.enviarCorreo({
        to: compra.email,
        ...brevo.plantillaRechazo({ folio, nombre: compra.nombre, motivo }),
      });
    } catch (e) { console.error('Email rechazo falló:', e.message); }

    await g.actualizarCompra(folio, { estado: 'RECHAZADO', notas: motivo });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo rechazar.' });
  }
});

const PORT = process.env.PORT || 3000;

// require.main === module: solo arranca el servidor de verdad cuando se
// corre "node server.js" / "npm start" (como lo hace Coolify). Cuando un
// archivo de pruebas hace require('../server') para levantarlo en un
// puerto efímero (ver test/compras-integration.test.js), este bloque NO
// se ejecuta — así las pruebas no compiten por el puerto 3000 ni dejan
// un servidor real corriendo de fondo.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Kaotikaz backend en :${PORT}`));
}

module.exports = app;
