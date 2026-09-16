/* ============================================================
   KAOTIKAZ — Sesión de staff con cookie firmada (HMAC)
   Sin dependencias extra: token = base64(user.exp).firma
   ============================================================ */

const crypto = require('crypto');

const COOKIE = 'ktz_sesion';
const TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

function firmar(payload) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
}

function crearToken(usuario) {
  const payload = Buffer.from(`${usuario}.${Date.now() + TTL_MS}`).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

function validarToken(token = '') {
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  const esperada = firmar(payload);
  if (firma.length !== esperada.length ||
      !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  const [usuario, exp] = Buffer.from(payload, 'base64url').toString('utf8').split('.');
  if (Date.now() > +exp) return null;
  return usuario;
}

function setCookie(res, token, req) {
  // Secure si NODE_ENV=production (config explícita) O si la request ya
  // llegó por HTTPS (req.secure respeta X-Forwarded-Proto gracias a
  // "trust proxy"). Así un NODE_ENV mal configurado en el host no baja
  // la guardia de la cookie de sesión del staff.
  const secure = (process.env.NODE_ENV === 'production' || (req && req.secure)) ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL_MS / 1000}${secure}`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

/** Middleware: exige sesión válida de staff. */
function requiereSesion(req, res, next) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
  const usuario = validarToken(cookies[COOKIE]);
  if (!usuario) return res.status(401).json({ error: 'Sesión inválida o expirada' });
  req.usuario = usuario;
  next();
}

module.exports = { crearToken, setCookie, clearCookie, requiereSesion };
