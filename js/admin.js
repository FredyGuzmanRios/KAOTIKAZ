/* ============================================================
   KAOTIKAZ — Panel Staff (carcasa v2)
   Pestañas Pendientes/Confirmados + modal de caso.
   TODO-BACKEND: sustituir DEMO_DATA por GET /api/compras
   y las acciones por POST /api/confirmar | /api/rechazar.
   ============================================================ */

/* Datos demo — misma forma que devolverá el backend */
let compras = [
  { folio: 'K-001', nombre: 'Juana Demo',  email: 'juana@demo.mx',  whatsapp: '5512345678',
    cantidad: 2, monto: 800, clabe: '002180012345678901', fecha: '2026-07-02 18:40',
    estado: 'PENDIENTE', comprobante: '#', validado: '', qrEnviado: false },
  { folio: 'K-002', nombre: 'Carlos Demo', email: 'carlos@demo.mx', whatsapp: '',
    cantidad: 1, monto: 400, clabe: '012180098765432109', fecha: '2026-07-02 19:15',
    estado: 'PENDIENTE', comprobante: '#', validado: '', qrEnviado: false },
  { folio: 'K-000', nombre: 'Prueba Interna', email: 'staff@kaotikaz.com', whatsapp: '5598765432',
    cantidad: 1, monto: 400, clabe: '014180011122233345', fecha: '2026-07-01 12:00',
    estado: 'CONFIRMADO', comprobante: '#', validado: '2026-07-01 13:05', qrEnviado: true },
];

let casoActual = null;

/* ---------- Utilidad: crear celdas SIN innerHTML (anti-XSS:
   aunque los datos vengan sanitizados, nunca inyectamos HTML) ---------- */
function td(text) {
  const el = document.createElement('td');
  el.textContent = text;
  return el;
}

/* ---------- Render de tablas ---------- */
function render() {
  const pend = compras.filter(c => c.estado === 'PENDIENTE');
  const conf = compras.filter(c => c.estado === 'CONFIRMADO');

  document.getElementById('countPend').textContent = pend.length;
  document.getElementById('countConf').textContent = conf.length;

  const tbodyP = document.getElementById('tbodyPendientes');
  tbodyP.replaceChildren();
  pend.forEach(c => {
    const tr = document.createElement('tr');
    tr.append(td(c.folio), td(c.nombre), td(c.cantidad), td('$' + c.monto), td(c.fecha));

    const tdEstado = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge badge--pend';
    badge.textContent = 'PENDIENTE';
    tdEstado.append(badge);

    const tdBtn = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'btn-mini btn-mini--ok';
    btn.textContent = '📋 ATENDER';
    btn.addEventListener('click', () => abrirModal(c));
    tdBtn.append(btn);

    tr.append(tdEstado, tdBtn);
    tbodyP.append(tr);
  });
  document.getElementById('vacioPend').classList.toggle('hidden', pend.length > 0);

  const tbodyC = document.getElementById('tbodyConfirmados');
  tbodyC.replaceChildren();
  conf.forEach(c => {
    const tr = document.createElement('tr');
    tr.append(td(c.folio), td(c.nombre), td(c.cantidad), td('$' + c.monto),
              td(c.validado || '—'), td(c.qrEnviado ? '✔ sí' : '✘ no'));
    const tdBtn = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'btn-mini btn-mini--ok';
    btn.textContent = '👁 VER';
    btn.addEventListener('click', () => abrirModal(c));
    tdBtn.append(btn);
    tr.append(tdBtn);
    tbodyC.append(tr);
  });
  document.getElementById('vacioConf').classList.toggle('hidden', conf.length > 0);
}

/* ---------- Pestañas ---------- */
const tabPend = document.getElementById('tabPendientes');
const tabConf = document.getElementById('tabConfirmados');

function switchTab(pendientes) {
  tabPend.classList.toggle('active', pendientes);
  tabConf.classList.toggle('active', !pendientes);
  document.getElementById('vistaPendientes').classList.toggle('hidden', !pendientes);
  document.getElementById('vistaConfirmados').classList.toggle('hidden', pendientes);
}
tabPend.addEventListener('click', () => switchTab(true));
tabConf.addEventListener('click', () => switchTab(false));

/* ---------- Modal de caso ---------- */
const overlay = document.getElementById('modalOverlay');

function abrirModal(caso) {
  casoActual = caso;

  document.getElementById('mFolio').textContent    = caso.folio;
  document.getElementById('mNombre').textContent   = caso.nombre;
  document.getElementById('mFecha').textContent    = caso.fecha;
  document.getElementById('mEmail').textContent    = caso.email;
  document.getElementById('mWhats').textContent    = caso.whatsapp || '— no dejó —';
  document.getElementById('mCantidad').textContent = caso.cantidad + ' boleto(s)';
  document.getElementById('mMonto').textContent    = '$' + caso.monto + '.00 MXN exactos';
  document.getElementById('mClabe').textContent    = caso.clabe;

  const badge = document.getElementById('mBadge');
  const esPend = caso.estado === 'PENDIENTE';
  badge.textContent = caso.estado;
  badge.className = esPend ? 'badge badge--pend' : 'badge badge--conf';
  document.getElementById('mActions').classList.toggle('hidden', !esPend);

  // Contacto directo, con datos precargados
  const asunto = encodeURIComponent(`Tu compra ${caso.folio} — Kaotikaz`);
  const cuerpo = encodeURIComponent(`Hola ${caso.nombre.split(' ')[0]}, te escribimos por tu compra ${caso.folio} (${caso.cantidad} boleto(s), $${caso.monto} MXN).\n\n`);
  document.getElementById('mMailto').href = `mailto:${caso.email}?subject=${asunto}&body=${cuerpo}`;

  const btnWa = document.getElementById('mWa');
  if (caso.whatsapp) {
    const msg = encodeURIComponent(`Hola ${caso.nombre.split(' ')[0]}, somos staff de Kaotikaz. Te contactamos por tu compra ${caso.folio}.`);
    btnWa.href = `https://wa.me/52${caso.whatsapp}?text=${msg}`;
    btnWa.classList.remove('hidden');
  } else {
    btnWa.classList.add('hidden');
  }

  overlay.classList.remove('hidden');
}

function cerrarModal() {
  overlay.classList.add('hidden');
  casoActual = null;
}

document.getElementById('mClose').addEventListener('click', cerrarModal);
overlay.addEventListener('click', e => { if (e.target === overlay) cerrarModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModal(); });

/* Copiar CLABE con un clic */
document.getElementById('mClabe').addEventListener('click', async e => {
  try { await navigator.clipboard.writeText(e.target.textContent); } catch {}
  const orig = e.target.textContent;
  e.target.textContent = '✔ COPIADA';
  setTimeout(() => { e.target.textContent = orig; }, 1200);
});

/* ---------- Acciones ---------- */
let procesando = false; // candado anti doble clic

document.getElementById('mConfirmar').addEventListener('click', () => {
  if (!casoActual || procesando) return;
  procesando = true;

  /* TODO-BACKEND: POST /api/confirmar { folio }
     → el servidor genera QR único, envía email con boleto (Brevo),
       mueve el registro a hoja "Confirmados" y responde ok. */
  casoActual.estado = 'CONFIRMADO';
  casoActual.validado = new Date().toISOString().slice(0, 16).replace('T', ' ');
  casoActual.qrEnviado = true;

  procesando = false;
  cerrarModal();
  render();
  switchTab(false); // te lleva a Confirmados para que veas el resultado
});

document.getElementById('mRechazar').addEventListener('click', () => {
  if (!casoActual || procesando) return;

  const motivo = prompt(`¿Por qué rechazas ${casoActual.folio}? (se envía al cliente)`);
  if (motivo === null || motivo.trim() === '') return;

  procesando = true;
  /* TODO-BACKEND: POST /api/rechazar { folio, motivo }
     → email al cliente con el motivo, registro marcado RECHAZADO. */
  compras = compras.filter(c => c.folio !== casoActual.folio);
  procesando = false;
  cerrarModal();
  render();
});

/* ---------- Login demo ---------- */
document.getElementById('btnLogin').addEventListener('click', () => {
  /* TODO-BACKEND: fetch('/api/login', { method:'POST', ... })
     → cookie de sesión httpOnly + secure. Esto es solo demo visual. */
  document.getElementById('loginBox').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  render();
});

document.getElementById('btnLogout').addEventListener('click', () => {
  /* TODO-BACKEND: POST /api/logout */
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('loginBox').classList.remove('hidden');
});
