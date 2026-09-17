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

// Nombre de un boleto individual: mismo formato que el nombre del comprador.
const NOMBRE_BOLETO_RE = /^[a-záéíóúüñ\s.]{3,80}$/i;

/** Valida los nombres de los boletos adicionales (boleto 2..cantidad) que
 *  llegan del cliente como un string JSON (arreglo de strings) en el
 *  campo `nombresExtra` — solo aplica cuando se compran 2 o más boletos,
 *  para poder mandar el QR de confirmación con "nombre comprador -
 *  nombre boleto persona" por cada boleto.
 *
 *  Es opcional a nivel servidor (a diferencia del comprobante, que sí es
 *  obligatorio a huevo): si el cliente no lo manda — por ejemplo un
 *  cliente viejo o sin JS — la compra se sigue guardando igual, nada más
 *  sin los nombres individuales (el staff puede pedirlos después por
 *  WhatsApp). El frontend (js/compra.js) SÍ lo exige antes de dejar
 *  enviar el formulario cuando la cantidad es 2 o más.
 *
 *  Devuelve { ok, nombres, error }: `nombres` siempre es un arreglo
 *  (vacío si no aplica), ya sanitizado y listo para guardar en el Sheet. */
function validarNombresExtra(cantidad, nombresExtraRaw) {
  const cant = +cantidad || 0;
  if (cant < 2 || !nombresExtraRaw) return { ok: true, nombres: [] };

  let arr;
  try {
    arr = JSON.parse(nombresExtraRaw);
  } catch {
    return { ok: false, nombres: [], error: 'nombresExtra no es JSON válido' };
  }
  if (!Array.isArray(arr)) return { ok: false, nombres: [], error: 'nombresExtra debe ser un arreglo' };

  const esperados = cant - 1; // el boleto 1 ya es el comprador (campo "nombre")
  if (arr.length !== esperados) {
    return { ok: false, nombres: [], error: `Se esperaban ${esperados} nombre(s) de boleto` };
  }

  const nombres = arr.map(n => sheetSafe(sanitizeServer(n)));
  if (nombres.some(n => !NOMBRE_BOLETO_RE.test(n))) {
    return { ok: false, nombres: [], error: 'Nombre de boleto inválido' };
  }

  return { ok: true, nombres };
}

module.exports = {
  RULES, CONTROL_CHARS, sanitizeServer, sheetSafe, validarCompra, detectarImagen,
  validarNombresExtra,
};
