/* ============================================================
   KAOTIKAZ — Validación y sanitización server-side de /api/compras.
   Extraído de server.js para poder probarlo con pruebas unitarias
   (ver test/validacion.test.js) sin tener que levantar el servidor
   completo ni depender de Google/Brevo.
   ============================================================ */

const RULES = {
  nombre:   v => /^[a-záéíóúüñ\s.]{3,80}$/i.test(v),
  email:    v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 100,
  whatsapp: v => v === '' || /^\d{10}$/.test(v),
  cantidad: v => Number.isInteger(+v) && +v >= 1 && +v <= 5,
  // Nota: ya no se pide la CLABE del comprador (decisión de diseño de la
  // nueva landing — para validar el pago basta con el monto exacto y el
  // concepto). El comprobante de transferencia sigue siendo obligatorio
  // (se valida aparte, ver detectarImagen más abajo: no es un campo de
  // texto de RULES sino un archivo).
};

// Caracteres de control e invisibles unicode: 0x00-0x1f, 0x7f,
// 0x200b-0x200f, 0x2028, 0x2029, 0xfeff.
// (Construido con códigos para evitar problemas de codificación.)
const CONTROL_CHARS = new RegExp(
  '[' + String.fromCharCode(0x00) + '-' + String.fromCharCode(0x1f) +
  String.fromCharCode(0x7f) +
  String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) +
  String.fromCharCode(0x2028) + String.fromCharCode(0x2029) +
  String.fromCharCode(0xfeff) + ']', 'g');

function sanitizeServer(str = '') {
  return String(str).normalize('NFKC').replace(CONTROL_CHARS, '')
    .replace(/[<>"'`\\]/g, '').trim();
}

/** Anti fórmula-injection para Sheets (=, +, -, @ al inicio). */
function sheetSafe(v) { return /^[=+\-@]/.test(v) ? `'${v}` : v; }

/** Valida y sanitiza los campos de texto de una compra. NO valida el
 *  archivo del comprobante (eso vive en detectarImagen, porque necesita
 *  el buffer del archivo, no viene en `body`). El caller (server.js)
 *  agrega 'comprobante' a `errores` cuando detectarImagen no reconoce
 *  el archivo subido. */
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

/** Verifica el TIPO REAL del archivo leyendo sus primeros bytes.
 *  El MIME que declara el cliente es falsificable; esto no.
 *  Devuelve el mimetype real o null si no es imagen permitida. */
function detectarImagen(buf) {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  // WebP: "RIFF" .... "WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

module.exports = { RULES, CONTROL_CHARS, sanitizeServer, sheetSafe, validarCompra, detectarImagen };
