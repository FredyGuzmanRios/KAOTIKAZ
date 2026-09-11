/* ============================================================
   KAOTIKAZ — QR SIMULADO
   Genera un código único por folio y usa un servicio público para
   renderizar la imagen dentro del correo. Cuando quieras el QR
   "real" (generado y validable por ti), sustituye este módulo por
   la librería `qrcode` (npm i qrcode) y adjunta el PNG al correo.
   ============================================================ */

const crypto = require('crypto');

function generarQr(folio) {
  const codigo = `KTZ-${folio}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const qrImgUrl =
    'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' +
    encodeURIComponent(codigo);
  return { codigo, qrImgUrl };
}

module.exports = { generarQr };
