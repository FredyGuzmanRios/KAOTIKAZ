/* ============================================================
   KAOTIKAZ — QR real, generado por nosotros (sin terceros)
   Antes esto llamaba a api.qrserver.com (un servicio público) para
   dibujar la imagen; ahora la generamos aquí mismo con la librería
   `qrcode` (npm), así que el código del boleto nunca sale de nuestro
   servidor antes de llegarle al cliente por correo.
   ============================================================ */

const crypto = require('crypto');
const QRCode = require('qrcode');

/** Genera el código único del boleto y su imagen PNG.
 *  Devuelve { codigo, pngBuffer }. El PNG se manda como adjunto del
 *  correo de confirmación y, cuando el cliente de correo lo permite,
 *  también incrustado (data-URI) en el cuerpo del mensaje. */
async function generarQr(folio) {
  const codigo = `KTZ-${folio}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const pngBuffer = await QRCode.toBuffer(codigo, {
    type: 'png',
    width: 400,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
  return { codigo, pngBuffer };
}

module.exports = { generarQr };
