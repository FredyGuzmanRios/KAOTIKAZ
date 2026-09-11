/* ============================================================
   KAOTIKAZ — Correos transaccionales vía Brevo (API v3)
   Tier gratis: 300 correos/día — de sobra para este evento.
   Docs: https://developers.brevo.com/reference/sendtransacemail
   ============================================================ */

const API_URL = 'https://api.brevo.com/v3/smtp/email';

async function enviarCorreo({ to, subject, html }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || 'Kaotikaz',
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`Brevo ${res.status}: ${detalle}`);
  }
  return res.json(); // { messageId }
}

/* ---------- Plantillas ---------- */

const wrap = (contenido) => `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;
              background:#0d0d1a;color:#f2f2f2;padding:28px;border-radius:12px">
    <h1 style="color:#ff2fb3;font-size:22px;margin:0 0 4px">KAOTIKAZ</h1>
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
        <tr><td>Folio</td><td><b style="color:#ffe066">${folio}</b></td></tr>
        <tr><td>Boletos</td><td>${cantidad}</td></tr>
        <tr><td>Monto</td><td>$${monto} MXN</td></tr>
      </table>
      <p>Estamos <b>validando tu comprobante de pago</b>. En cuanto el staff lo
      confirme te llegará otro correo con tu <b>código QR de acceso</b>.</p>`),
  };
}

/** Email #2 — al admin: nuevo registro + link wa.me para contactar. */
function plantillaAdmin({ folio, nombre, email, whatsapp, cantidad, monto, comprobante }) {
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
        <tr><td>Folio</td><td><b>${folio}</b></td></tr>
        <tr><td>Nombre</td><td>${nombre}</td></tr>
        <tr><td>Email</td><td>${email}</td></tr>
        <tr><td>Boletos</td><td>${cantidad} — $${monto} MXN</td></tr>
      </table>
      <p><a style="color:#8be9fd" href="${comprobante}">🧾 Ver comprobante</a></p>
      ${wa}
      <p>Entra al <b>panel staff</b> para confirmar o rechazar.</p>`),
  };
}

/** Email #3 — al cliente: pago confirmado + QR (simulado). */
function plantillaConfirmacion({ folio, nombre, cantidad, codigoQr, qrImgUrl }) {
  return {
    subject: `✔ Pago confirmado — tu acceso ${folio}`,
    html: wrap(`
      <p>¡Listo, <b>${nombre}</b>! Tu pago fue confirmado.</p>
      <p>Este es tu acceso para <b>${cantidad} boleto(s)</b>. Preséntalo en la entrada:</p>
      <div style="background:#fff;padding:16px;border-radius:8px;text-align:center">
        <img src="${qrImgUrl}" alt="QR ${codigoQr}" width="220" height="220"><br>
        <code style="color:#0d0d1a;font-size:13px">${codigoQr}</code>
      </div>
      <p style="color:#ffe066">⚠ El QR es personal. No lo compartas en redes.</p>`),
  };
}

/** Email #4 — al cliente: pago rechazado con motivo. */
function plantillaRechazo({ folio, nombre, motivo }) {
  return {
    subject: `✘ Problema con tu registro ${folio}`,
    html: wrap(`
      <p>Hola <b>${nombre}</b>, no pudimos validar tu pago del folio <b>${folio}</b>.</p>
      <p><b>Motivo:</b> ${motivo}</p>
      <p>Responde este correo o escríbenos por WhatsApp para resolverlo.</p>`),
  };
}

module.exports = { enviarCorreo, plantillaRegistro, plantillaAdmin, plantillaConfirmacion, plantillaRechazo };
