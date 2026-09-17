/* ============================================================
   KAOTIKAZ — QR real, generado por nosotros (sin terceros)
   Antes esto llamaba a api.qrserver.com (un servicio público) para
   dibujar la imagen; ahora la generamos aquí mismo con la librería
   `qrcode` (npm), así que el código del boleto nunca sale de nuestro
   servidor antes de llegarle al cliente por correo.

   Desde que se agregó "un QR por persona" (no uno solo por compra):
   cada boleto de una misma compra tiene su PROPIO código único, para
   que cada invitado pueda entrar por separado — ver
   generarQrsPorPersona() y POST /api/confirmar en server.js.
   ============================================================ */

const crypto = require('crypto');
const QRCode = require('qrcode');

const OPCIONES_PNG = { type: 'png', width: 400, margin: 2, errorCorrectionLevel: 'M' };

function nuevoCodigo(folio, indice) {
  // "indice" (1, 2, 3...) queda visible en el propio código -- no hace
  // falta para la lógica (el escaneo busca por coincidencia exacta
  // dentro del arreglo guardado en el Sheet, ver server.js), pero ayuda
  // a quien lea el código a simple vista (soporte, logs, etc.).
  return `KTZ-${folio}-${indice}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Genera UN código + su imagen PNG. Se mantiene por si algo más lo
 *  necesita suelto; el flujo real de confirmación usa
 *  generarQrsPorPersona() de aquí abajo. Devuelve { codigo, pngBuffer }. */
async function generarQr(folio, indice = 1) {
  const codigo = nuevoCodigo(folio, indice);
  const pngBuffer = await QRCode.toBuffer(codigo, OPCIONES_PNG);
  return { codigo, pngBuffer };
}

/** Genera un código + PNG POR CADA BOLETO de la compra (cantidad
 *  boletos → cantidad códigos únicos, cada uno válido para UNA sola
 *  entrada). Devuelve un arreglo [{ codigo, pngBuffer }, ...] en el
 *  mismo orden que "nombresPorBoleto" en server.js (boleto 1 = quien
 *  compró, boleto 2..N = los invitados de NombresBoletos). */
async function generarQrsPorPersona(folio, cantidad) {
  const n = Math.max(1, Math.trunc(+cantidad) || 1);
  const resultado = [];
  for (let indice = 1; indice <= n; indice++) {
    resultado.push(await generarQr(folio, indice));
  }
  return resultado;
}

module.exports = { generarQr, generarQrsPorPersona };
