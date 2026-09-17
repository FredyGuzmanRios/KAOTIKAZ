/* ============================================================
   KAOTIKAZ — Correos transaccionales vía Brevo (API v3)
   Tier gratis: 300 correos/día — de sobra para este evento.
   Docs: https://developers.brevo.com/reference/sendtransacemail
   ============================================================ */

const API_URL = 'https://api.brevo.com/v3/smtp/email';

async function enviarCorreo({ to, subject, html, attachment }) {
  const body = {
    sender: {
      name: process.env.BREVO_SENDER_NAME || 'Kaotikaz',
      email: process.env.BREVO_SENDER_EMAIL,
    },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  // Adjuntos opcionales: [{ name, content }] con content en base64
  // (así viaja el PNG del QR — ver lib/qr.js).
  if (attachment && attachment.length) body.attachment = attachment;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${detalle}`);
  }
  return res.json(); // { messageId }
}

/* ---------- Plantillas ---------- */

// Logo oficial alojado como estático del propio sitio (assets/img/), en
// rosa de marca sobre fondo oscuro — mismo tratamiento visual que el SVG
// inline de index.html, pero como PNG: los clientes de correo no confían
// en <svg> ni en hojas de estilo externas, así que una imagen normal es
// lo único que se ve igual en todos lados. Se referencia por URL absoluta
// (no data-URI): es un archivo fijo, así que conviene que se cachee en
// vez de viajar completo en cada correo.
const LOGO_URL = 'https://kaotikaz.com/assets/img/kaotikaz-logo-correo.png';
const ROSA = '#ff2fb3'; // mismo rosa de marca que el resto del sitio ("rosita")

const wrap = (contenido) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;
              background:#0d0d1a;color:#f2f2f2;padding:28px;border-radius:12px">
    <img src="${LOGO_URL}" alt="KAOTIKAZ" width="180" style="display:block;margin:0 0 6px;border:0">
    <p style="color:#8be9fd;font-size:12px;margin:0 0 20px">// boletera oficial</p>
    ${contenido}
    <p style="color:#666;font-size:11px;margin-top:24px">
      Este correo se generó automáticamente. Si no reconoces esta compra, ignóralo.
    </p>
  </div>`;

/** Email #1 — al cliente: registro recibido, pago en validación. */
function plantillaRegistro({ folio, nombre, cantidad, monto }) {
  return {
    subject: `☎ Registro recibido — folio ${folio}`,
    html: wrap(`
      <p>Hola <b>${nombre}</b>, recibimos tu registro:</p>
      <table style="width:100%;color:#f2f2f2;font-size:14px">
        <tr><td>Folio</td><td><b style="color:${ROSA}">${folio}</b></td></tr>
        <tr><td>Boletos</td><td>${cantidad}</td></tr>
        <tr><td>Monto</td><td>$${monto} MXN</td></tr>
      </table>
      <p>Estamos <b>validando tu comprobante de pago</b>. En cuanto el staff lo
      confirme te llegará otro correo con tu <b>código QR de acceso</b>.</p>`),
  };
}

/** Email #2 — al admin: nuevo registro + link wa.me para contactar.
 *  El comprobante YA NO se sube a Drive (la cuenta de servicio no tiene
 *  cuota de almacenamiento propia) — server.js lo manda como ARCHIVO
 *  ADJUNTO de este mismo correo, por eso aquí solo se avisa que viene
 *  adjunto en vez de poner un link. */
function plantillaAdmin({ folio, nombre, email, whatsapp, cantidad, monto }) {
  const wa = whatsapp
    ? `<p><a style="color:#25d366" href="https://wa.me/52${whatsapp}?text=${encodeURIComponent(
        `Hola ${nombre.split(' ')[0]}, somos staff de Kaotikaz. Recibimos tu registro ${folio}.`
      )}">📱 Contactar por WhatsApp</a></p>`
    : '<p>(no dejó WhatsApp)</p>';
  return {
    subject: `🔔 Nuevo registro ${folio} — ${nombre} (${cantidad} boletos)`,
    html: wrap(`
      <p><b>Nuevo registro pendiente de validar:</b></p>
      <table style="width:100%;color:#f2f2f2;font-size:14px">
        <tr><td>Folio</td><td><b style="color:${ROSA}">${folio}</b></td></tr>
        <tr><td>Nombre</td><td>${nombre}</td></tr>
        <tr><td>Email</td><td>${email}</td></tr>
        <tr><td>Boletos</td><td>${cantidad} — $${monto} MXN</td></tr>
      </table>
      <p>🧾 El comprobante de transferencia viene <b>adjunto</b> a este correo.</p>
      ${wa}
      <p>Entra al <b>panel staff</b> para confirmar o rechazar.</p>`),
  };
}

/** Email #3 — al cliente: pago confirmado + UN QR POR BOLETO (generados
 *  por nosotros, ver lib/qr.js / generarQrsPorPersona). Cada boleto de
 *  la compra (el comprador + cada invitado con nombre, ver
 *  NombresBoletos) tiene su PROPIO código: así cada quien puede entrar
 *  por separado, presentando solo su parte del correo, en vez de
 *  depender de un único QR compartido para todo el grupo.
 *
 *  `boletos` (obligatorio): arreglo ya armado en server.js, en el mismo
 *  orden que se guardó en el Sheet: [{ nombreBoleto, codigo, qrDataUrl }, ...],
 *  boleto[0] siempre es quien compró.
 *
 *  El PNG de cada boleto también va adjunto al correo (uno por persona):
 *  algunos clientes de correo (p. ej. Gmail) bloquean imágenes data-URI
 *  incrustadas, así que el adjunto es la vía garantizada para
 *  guardar/imprimir cada boleto aunque la imagen inline no se vea. */
function plantillaConfirmacion({ folio, nombre, cantidad, boletos }) {
  const esGrupo = boletos.length > 1; // 2+ boletos: cada uno necesita su etiqueta para saber cuál es cuál
  const bloques = boletos.map((b, i) => `
    <div style="margin-top:${i === 0 ? 14 : 22}px;padding-top:${i === 0 ? 0 : 18}px;
                ${i === 0 ? '' : 'border-top:1px dashed #333;'}text-align:center">
      ${esGrupo ? `<p style="color:${ROSA};margin:0 0 8px;font-size:13px;text-align:left">
        <b>Boleto ${i + 1} de ${boletos.length} — ${b.nombreBoleto}</b></p>` : ''}
      <div style="background:#fff;padding:16px;border-radius:8px;text-align:center">
        <img src="${b.qrDataUrl}" alt="QR boleto ${i + 1} — ${b.nombreBoleto}" width="200" height="200"><br>
        <code style="color:${ROSA};font-size:12px">${b.codigo}</code>
      </div>
    </div>`).join('');
  return {
    subject: `✔ Pago confirmado — tu acceso ${folio}`,
    html: wrap(`
      <p>¡Listo, <b>${nombre}</b>! Tu pago fue confirmado.</p>
      <p>Este es tu acceso para <b>${cantidad} boleto(s)</b>${esGrupo
        ? ' — cada boleto tiene su propio código, uno por persona. Cada quien presenta el suyo en la entrada (esta imagen o el PNG adjunto a este correo con su nombre):'
        : '. Preséntalo en la entrada (esta imagen o el PNG adjunto a este correo):'}</p>
      ${bloques}
      <p style="color:#ffe066;margin-top:20px">⚠ ${esGrupo ? 'Cada código' : 'El código'} es personal e
      intransferible: la entrada solo se valida la primera vez que se escanea
      ese código.${esGrupo ? ' No los compartas en redes, ni siquiera entre tus propios invitados.' : ' No lo compartas en redes.'}</p>`),
  };
}

/** Email #4 — al cliente: pago rechazado con motivo. */
function plantillaRechazo({ folio, nombre, motivo }) {
  return {
    subject: `✘ Problema con tu registro ${folio}`,
    html: wrap(`
      <p>Hola <b>${nombre}</b>, no pudimos validar tu pago del folio <b style="color:${ROSA}">${folio}</b>.</p>
      <p><b>Motivo:</b> ${motivo}</p>
      <p>Responde este correo o escríbenos por WhatsApp para resolverlo.</p>`),
  };
}

module.exports = { enviarCorreo, plantillaRegistro, plantillaAdmin, plantillaConfirmacion, plantillaRechazo };
