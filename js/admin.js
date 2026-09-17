/* ============================================================
   KAOTIKAZ — Panel Staff (conectado al backend)
   Login real → GET /api/compras (Google Sheets) →
   POST /api/confirmar | /api/rechazar (Brevo + QR simulado).
   ============================================================ */

let compras = [];
let casoActual = null;

/* ---------- Utilidad: crear celdas SIN innerHTML (anti-XSS) ---------- */
function td(text) {
  const el = document.createElement('td');
  el.textContent = text;
  return el;
}

async function api(url, opciones = {}, esLogin = false) {
  const res = await fetch(url, { credentials: 'same-origin', ...opciones });
  const json = await res.json().catch(() => ({}));
  // /api/login tambien responde 401 cuando el usuario/contraseña esta mal
  // (no porque haya una sesion que haya expirado) -- para esa llamada no
  // se debe mostrar el mensaje generico de "sesion expirada", sino el
  // error real que manda el servidor (p.ej. "Credenciales incorrectas").
  if (res.status === 401 && !esLogin) { mostrarLogin(); throw new Error('Sesión expirada, vuelve a entrar.'); }
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json;
}

/* ---------- Cargar compras desde el Sheet ---------- */
async function cargarCompras() {
  try {
    compras = await api('/api/compras');
    render();
  } catch (err) {
    alert(`✘ ${err.message}`);
  }
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

    // Desde que hay un QR por persona (ver backend-ejemplo/server.js),
    // c.escaneos es un arreglo con una marca por boleto — en una compra de
    // 2+ boletos puede haber entrado solo PARTE del grupo, por eso el
    // badge ámbar intermedio (el detalle boleto por boleto está en el
    // modal, ver abrirModal más abajo).
    const escaneos = c.escaneos || [];
    const entraron = escaneos.filter(Boolean).length;
    const tdEntrada = document.createElement('td');
    const badgeEntrada = document.createElement('span');
    if (entraron === 0) {
      badgeEntrada.className = 'badge badge--noentro';
      badgeEntrada.textContent = '— no ha entrado';
    } else if (entraron < c.cantidad) {
      badgeEntrada.className = 'badge badge--parcial';
      badgeEntrada.textContent = `⚠ ${entraron}/${c.cantidad} entraron`;
    } else {
      badgeEntrada.className = 'badge badge--entro';
      badgeEntrada.textContent = `✔ ${entraron}/${c.cantidad} entraron`;
    }
    tdEntrada.append(badgeEntrada);
    tr.append(tdEntrada);

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

  // Nombre por boleto (2+ boletos): "nombre comprador - nombre boleto
  // persona", el mismo formato que va en el correo de confirmación con
  // el QR (ver backend-ejemplo/lib/brevo.js), para que el staff pueda
  // verificarlos antes de confirmar.
  const filaNombresBoletos = document.getElementById('mNombresBoletosRow');
  const tieneNombresBoletos = Array.isArray(caso.nombresBoletos) && caso.nombresBoletos.length > 0;
  filaNombresBoletos.classList.toggle('hidden', !tieneNombresBoletos);
  if (tieneNombresBoletos) {
    const lista = [`${caso.nombre} (boleto 1)`,
      ...caso.nombresBoletos.map((n, i) => `${caso.nombre} - ${n} (boleto ${i + 2})`)];
    document.getElementById('mNombresBoletos').textContent = lista.join(' · ');
  }

  // Acceso por boleto: desde que cada boleto tiene su PROPIO QR (ver
  // backend-ejemplo/server.js), caso.escaneos es un arreglo paralelo a
  // [nombre, ...nombresBoletos] — cada quien puede haber entrado (o no)
  // por separado. Solo tiene sentido mostrarlo una vez confirmada la
  // compra (antes de eso no hay ningún QR generado todavía).
  const filaAcceso = document.getElementById('mAccesoRow');
  const tieneAcceso = caso.estado === 'CONFIRMADO' && Array.isArray(caso.escaneos) && caso.escaneos.length > 0;
  filaAcceso.classList.toggle('hidden', !tieneAcceso);
  if (tieneAcceso) {
    const nombresPorBoleto = [caso.nombre, ...(caso.nombresBoletos || [])];
    const lista = caso.escaneos.map((marca, i) => {
      const quien = nombresPorBoleto[i] || `Invitado ${i + 1}`;
      return marca ? `✔ ${quien} (boleto ${i + 1}) — entró ${marca}` : `— ${quien} (boleto ${i + 1}) sin entrar`;
    });
    document.getElementById('mAcceso').textContent = lista.join(' · ');
  }

  const badge = document.getElementById('mBadge');
  const esPend = caso.estado === 'PENDIENTE';
  badge.textContent = caso.estado;
  badge.className = esPend ? 'badge badge--pend' : 'badge badge--conf';
  document.getElementById('mActions').classList.toggle('hidden', !esPend);

  // El comprobante ya no se guarda como link (ver nota en admin.html y en
  // backend-ejemplo/server.js) — llega como adjunto al correo de "nuevo
  // registro" de este folio, así que solo recordamos el folio a buscar.
  document.getElementById('mCompFolio').textContent = caso.folio;

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

document.getElementById('mConfirmar').addEventListener('click', async () => {
  if (!casoActual || procesando) return;
  procesando = true;
  const folio = casoActual.folio;

  try {
    /* El servidor genera el QR (simulado), envía el email con el
       boleto vía Brevo y actualiza el Sheet. */
    await api('/api/confirmar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folio }),
    });
    cerrarModal();
    await cargarCompras();
    switchTab(false); // te lleva a Confirmados para que veas el resultado
  } catch (err) {
    alert(`✘ ${err.message}`);
  } finally {
    procesando = false;
  }
});

document.getElementById('mRechazar').addEventListener('click', async () => {
  if (!casoActual || procesando) return;

  const motivo = prompt(`¿Por qué rechazas ${casoActual.folio}? (se envía al cliente)`);
  if (motivo === null || motivo.trim() === '') return;

  procesando = true;
  try {
    await api('/api/rechazar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folio: casoActual.folio, motivo: motivo.trim() }),
    });
    cerrarModal();
    await cargarCompras();
  } catch (err) {
    alert(`✘ ${err.message}`);
  } finally {
    procesando = false;
  }
});

/* ---------- Login ---------- */
function mostrarLogin() {
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('loginBox').classList.remove('hidden');
}

document.getElementById('btnLogin').addEventListener('click', async () => {
  const usuario  = document.getElementById('adminUser').value.trim();
  const password = document.getElementById('adminPass').value;
  try {
    await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password }),
    }, true);
    document.getElementById('loginBox').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    await cargarCompras();
  } catch (err) {
    alert(`✘ ${err.message}`);
  }
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  mostrarLogin();
});
