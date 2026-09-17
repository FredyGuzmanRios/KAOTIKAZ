/* ============================================================
   KAOTIKAZ — Escaneo de acceso (staff, con cámara del navegador)
   Login real (mismo backend/sesión que admin.js) → cámara →
   jsQR decodifica EN EL NAVEGADOR (nada de imágenes viaja a
   ningún lado) → POST /api/escanear valida contra el Sheet y
   marca el boleto como usado para evitar reingresos.
   ============================================================ */

async function api(url, opciones = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...opciones });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

/* ---------- Login ---------- */
function mostrarLogin() {
  document.getElementById('scanView').classList.add('hidden');
  document.getElementById('loginBox').classList.remove('hidden');
  detenerCamara();
}

document.getElementById('btnLogin').addEventListener('click', async () => {
  const usuario  = document.getElementById('adminUser').value.trim();
  const password = document.getElementById('adminPass').value;
  try {
    const { ok, json } = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password }),
    });
    if (!ok) throw new Error(json.error || 'Credenciales incorrectas');
    document.getElementById('loginBox').classList.add('hidden');
    document.getElementById('scanView').classList.remove('hidden');
    iniciarCamara();
  } catch (err) {
    alert(`✘ ${err.message}`);
  }
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  mostrarLogin();
});

/* ---------- Cámara + jsQR ---------- */
const video  = document.getElementById('scanVideo');
const canvas = document.getElementById('scanCanvas');
const ctx    = canvas.getContext('2d', { willReadFrequently: true });
const aviso  = document.getElementById('scanAviso');

let stream = null;
let escaneando = false;
let pausado = false;

async function iniciarCamara() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    video.srcObject = stream;
    await video.play();
    escaneando = true;
    pausado = false;
    requestAnimationFrame(loopEscaneo);
  } catch (err) {
    aviso.textContent = '✘ No se pudo acceder a la cámara: ' + err.message +
      ' (revisa los permisos del navegador).';
  }
}

function detenerCamara() {
  escaneando = false;
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

function loopEscaneo() {
  if (!escaneando) return;
  if (pausado || video.readyState !== video.HAVE_ENOUGH_DATA) {
    requestAnimationFrame(loopEscaneo);
    return;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const codigo = jsQR(frame.data, frame.width, frame.height);

  if (codigo && codigo.data) {
    pausado = true; // evita mandar el mismo cuadro repetido mientras responde el servidor
    validarCodigo(codigo.data.trim());
  }
  requestAnimationFrame(loopEscaneo);
}

/* ---------- Validar contra el servidor ---------- */
async function validarCodigo(codigoQr) {
  try {
    const { json } = await api('/api/escanear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigoQr }),
    });
    mostrarResultado(json);
  } catch (err) {
    mostrarResultado({ resultado: 'ERROR', error: err.message });
  }
}

const ESTILOS_RESULTADO = {
  OK:            { texto: '✔ ACCESO VÁLIDO',     clase: 'scan-badge--ok' },
  YA_USADO:      { texto: '⚠ YA FUE ESCANEADO',  clase: 'scan-badge--warn' },
  NO_CONFIRMADO: { texto: '✘ NO CONFIRMADO',      clase: 'scan-badge--error' },
  NO_ENCONTRADO: { texto: '✘ CÓDIGO DESCONOCIDO', clase: 'scan-badge--error' },
  ERROR:         { texto: '✘ ERROR DE CONEXIÓN',  clase: 'scan-badge--error' },
};

function mostrarResultado(r) {
  const badge   = document.getElementById('scanBadge');
  const folio   = document.getElementById('scanFolio');
  const detalle = document.getElementById('scanDetalle');
  const e = ESTILOS_RESULTADO[r.resultado] || ESTILOS_RESULTADO.ERROR;

  badge.textContent = e.texto;
  badge.className = 'scan-resultado__badge ' + e.clase;
  folio.textContent = r.folio ? `Folio ${r.folio}` : '—';

  if (r.resultado === 'OK') {
    // Desde que hay un QR por persona, cada escaneo es de UN boleto de la
    // compra (r.boleto de r.cantidad) — r.escaneados dice cuántos de esa
    // misma compra ya entraron en total, incluido este.
    detalle.textContent = `${r.nombre} · boleto ${r.boleto} de ${r.cantidad}. ` +
      `Entrada registrada ahora (${r.escaneados}/${r.cantidad} de esta compra ya entraron).`;
  } else if (r.resultado === 'YA_USADO') {
    detalle.textContent = `${r.nombre} · boleto ${r.boleto} de ${r.cantidad}. ` +
      `Ya había entrado: ${r.escaneadoEn}.`;
  } else if (r.resultado === 'NO_CONFIRMADO') {
    detalle.textContent = `${r.nombre || ''} — este boleto todavía no está confirmado por staff.`;
  } else {
    detalle.textContent = r.error || 'No se pudo validar el código.';
  }

  document.getElementById('scanResultado').classList.remove('hidden');
}

document.getElementById('btnSeguir').addEventListener('click', () => {
  document.getElementById('scanResultado').classList.add('hidden');
  pausado = false;
});
