/* ============================================================
   KAOTIKAZ — Interacciones de la landing (carcasa v2)
   Flujo en 2 pasos + capa de sanitización anti-inyección.
   OJO: esta validación es la PRIMERA línea de defensa (UX).
   La defensa REAL vive en el servidor (ver backend-ejemplo/).
   Todo lo marcado TODO-BACKEND se conecta después.
   ============================================================ */

const PRECIO_BOLETO = 400; // TODO-BACKEND: leer de hoja "Config"

/* ============================================================
   0. CAPA DE SEGURIDAD (frontend)
   ============================================================ */

/** Normaliza y limpia texto libre:
 *  - normaliza unicode (evita homoglifos raros)
 *  - elimina caracteres de control invisibles
 *  - elimina < > " ' ` \ (neutraliza HTML/atributos)
 *  - colapsa espacios y recorta longitud */
function sanitize(str, max = 100) {
  return String(str)
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, '')
    .replace(/[<>"'`\\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/** Patrones de inyección conocidos: XSS, SQL, plantillas,
 *  y fórmulas de hoja de cálculo (¡los datos van a Google Sheets!
 *  un nombre que empiece con = + - @ se ejecutaría como fórmula). */
const INJECTION_PATTERNS = [
  /<\s*script/i, /javascript\s*:/i, /on\w+\s*=/i,            // XSS
  /(\b(select|insert|update|delete|drop|union|exec)\b.*\b(from|into|table|where)\b)/i, // SQL
  /\{\{.*\}\}|\$\{.*\}/,                                     // template injection
  /^[=+\-@\t\r]/,                                            // fórmulas Sheets/CSV
];

function looksMalicious(str) {
  return INJECTION_PATTERNS.some(re => re.test(str));
}

/** Valida y devuelve el valor limpio, o null si es sospechoso. */
function cleanField(raw, max) {
  const v = sanitize(raw, max);
  if (looksMalicious(v)) return null;
  return v;
}

/* ============================================================
   1. REPRODUCTOR WINAMP
   ============================================================ */
const audioEl   = document.getElementById('audioEl');
const trackName = document.getElementById('trackName');
const trackTime = document.getElementById('trackTime');
const playlist  = document.getElementById('playlist');
const eqBars    = document.querySelectorAll('#eq span');

let currentTrack = -1;
let isPlaying = false;
let eqTimer = null;
let clockTimer = null;
let fakeSeconds = 0;

const tracks = [...playlist.querySelectorAll('li')];

function loadTrack(i) {
  if (i < 0) i = tracks.length - 1;
  if (i >= tracks.length) i = 0;
  currentTrack = i;
  tracks.forEach((li, n) => li.classList.toggle('active', n === i));
  const title = tracks[i].querySelector('span').textContent.replace(/^\d+\.\s*/, '');
  trackName.textContent = `SAYURI & SOPHOLOV — ${title.toUpperCase()} ··· `;
  // TODO-ASSETS: cuando existan los mp3 en /assets/audio, descomenta:
  // audioEl.src = tracks[i].dataset.src;
  fakeSeconds = 0;
}

function startEq() {
  stopEq();
  eqTimer = setInterval(() => {
    eqBars.forEach(bar => { bar.style.height = (12 + Math.random() * 85) + '%'; });
  }, 120);
  clockTimer = setInterval(() => {
    fakeSeconds = (fakeSeconds + 1) % 30;
    const m = String(Math.floor(fakeSeconds / 60)).padStart(2, '0');
    const s = String(fakeSeconds % 60).padStart(2, '0');
    trackTime.textContent = `${m}:${s}`;
  }, 1000);
}
function stopEq() {
  clearInterval(eqTimer); clearInterval(clockTimer);
  eqBars.forEach(bar => bar.style.height = '8%');
}

function togglePlay() {
  if (currentTrack === -1) loadTrack(0);
  isPlaying = !isPlaying;
  document.getElementById('btnPlay').textContent = isPlaying ? '⏸' : '▶';
  if (isPlaying) {
    startEq();
    if (audioEl.src) audioEl.play().catch(() => {});
  } else {
    stopEq();
    audioEl.pause();
  }
}

document.getElementById('btnPlay').addEventListener('click', togglePlay);
document.getElementById('btnStop').addEventListener('click', () => {
  isPlaying = false; stopEq(); audioEl.pause(); audioEl.currentTime = 0;
  trackTime.textContent = '00:00';
  document.getElementById('btnPlay').textContent = '▶';
});
document.getElementById('btnPrev').addEventListener('click', () => { loadTrack(currentTrack - 1); if (isPlaying) startEq(); });
document.getElementById('btnNext').addEventListener('click', () => { loadTrack(currentTrack + 1); if (isPlaying) startEq(); });

tracks.forEach((li, i) => li.addEventListener('click', () => {
  loadTrack(i);
  if (!isPlaying) togglePlay();
}));

/* Ventana arrastrable (solo desktop, como en 2004) */
(function makeDraggable() {
  const win = document.getElementById('winamp');
  const bar = document.getElementById('winampDrag');
  let dx = 0, dy = 0, dragging = false;

  bar.addEventListener('pointerdown', e => {
    if (window.innerWidth < 720) return;
    dragging = true;
    const m = new DOMMatrixReadOnly(getComputedStyle(win).transform);
    dx = e.clientX - m.m41; dy = e.clientY - m.m42;
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener('pointermove', e => {
    if (!dragging) return;
    win.style.transform = `translate(${e.clientX - dx}px, ${e.clientY - dy}px)`;
  });
  bar.addEventListener('pointerup', () => dragging = false);
})();

/* ============================================================
   2. TECLADO 01-800 (cantidad)
   ============================================================ */
let cantidad = 0;
const qtyDisplay   = document.getElementById('qtyDisplay');
const totalDisplay = document.getElementById('totalDisplay');

document.querySelectorAll('#keypad .key:not(:disabled)').forEach(key => {
  key.addEventListener('click', () => {
    document.querySelectorAll('#keypad .key').forEach(k => k.classList.remove('selected'));
    key.classList.add('selected', 'pressed');
    setTimeout(() => key.classList.remove('pressed'), 150);

    cantidad = parseInt(key.dataset.qty, 10);
    qtyDisplay.textContent = cantidad;
    totalDisplay.textContent = (cantidad * PRECIO_BOLETO).toLocaleString('es-MX');
  });
});

/* ============================================================
   3. WIZARD DE 2 PASOS
   ============================================================ */
const paso1 = document.getElementById('paso1');
const paso2 = document.getElementById('paso2');
const stepTab1 = document.getElementById('stepTab1');
const stepTab2 = document.getElementById('stepTab2');

const validators = {
  nombre:      v => /^[a-záéíóúüñ\s.]{3,80}$/i.test(v),
  email:       v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
  whatsapp:    v => v === '' || /^\d{10}$/.test(v),   // opcional
  clabe:       v => /^\d{18}$/.test(v),
  comprobante: input => input.files.length === 1
                     && input.files[0].type.startsWith('image/')
                     && input.files[0].size <= 5 * 1024 * 1024,
};

function checkField(name, value) {
  const field = document.querySelector(`[data-field="${name}"]`);
  let valid;
  if (name === 'comprobante') {
    valid = validators.comprobante(value);
  } else {
    const clean = cleanField(value, 100);
    valid = clean !== null && validators[name](clean);
  }
  field.classList.toggle('invalid', !valid);
  return valid;
}

/* Paso 1 -> Paso 2 */
document.getElementById('btnContinuar').addEventListener('click', () => {
  const okNombre = checkField('nombre', document.getElementById('inNombre').value);
  const okEmail  = checkField('email',  document.getElementById('inEmail').value);
  const okWhats  = checkField('whatsapp', document.getElementById('inWhats').value);

  if (cantidad < 1) {
    alert('📞 Marca cuántos boletos quieres en el teclado (1-5).');
    return;
  }
  if (!(okNombre && okEmail && okWhats)) return;

  // Pinta el monto exacto en la tarjeta de pago y el resumen
  const total = cantidad * PRECIO_BOLETO;
  document.getElementById('cpMonto').textContent = `$${total.toLocaleString('es-MX')}.00 MXN`;
  document.getElementById('resumenTexto').textContent =
    `${cantidad} boleto(s) · $${total.toLocaleString('es-MX')} MXN`;

  paso1.classList.add('hidden');
  paso2.classList.remove('hidden');
  stepTab1.classList.remove('active'); stepTab1.classList.add('done');
  stepTab2.classList.add('active');
  paso2.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* Paso 2 -> Paso 1 */
document.getElementById('btnVolver').addEventListener('click', () => {
  paso2.classList.add('hidden');
  paso1.classList.remove('hidden');
  stepTab2.classList.remove('active');
  stepTab1.classList.add('active'); stepTab1.classList.remove('done');
  paso1.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* Botones COPIAR de la tarjeta de pago */
document.querySelectorAll('.btn-copy').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy).textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback para contextos sin clipboard API
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    const prev = btn.textContent;
    btn.textContent = '✔ LISTO';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = prev; btn.classList.remove('copied'); }, 1600);
  });
});

/* ============================================================
   4. ENVÍO FINAL (paso 2)
   ============================================================ */
const form = document.getElementById('formCompra');

form.addEventListener('submit', e => {
  e.preventDefault();

  /* Honeypot: si un bot llenó el campo invisible, fingimos éxito
     y no mandamos nada. */
  if (document.getElementById('hpField').value !== '') {
    alert('☎ Compra registrada.');
    return;
  }

  const okClabe = checkField('clabe', document.getElementById('inClabe').value);
  const okComp  = checkField('comprobante', document.getElementById('inComprobante'));
  if (!(okClabe && okComp)) return;

  // Valores YA sanitizados para el envío
  const payload = {
    nombre:   cleanField(document.getElementById('inNombre').value, 80),
    email:    cleanField(document.getElementById('inEmail').value, 100),
    whatsapp: cleanField(document.getElementById('inWhats').value, 10),
    clabe:    cleanField(document.getElementById('inClabe').value, 18),
    cantidad,
    monto: cantidad * PRECIO_BOLETO,
  };

  /* TODO-BACKEND: envío real.
     const data = new FormData();
     Object.entries(payload).forEach(([k, v]) => data.append(k, v));
     data.append('comprobante', document.getElementById('inComprobante').files[0]);
     const res = await fetch('/api/compras', { method: 'POST', body: data });
     const { folio } = await res.json();
     -> mostrar pantalla de éxito con folio.
     El backend re-valida TODO, cifra la CLABE, guarda en Sheets,
     sube el comprobante a Drive y dispara los emails vía Brevo. */

  alert(`☎ LLAMADA RECIBIDA (demo)\n\n${payload.nombre} · ${payload.cantidad} boleto(s) · $${payload.monto} MXN\n\nCon el backend conectado: se registra tu compra, se sube tu\ncomprobante y te llega el correo de confirmación con tu folio.`);
});

/* Inputs numéricos: solo dígitos mientras escribes */
['inClabe', 'inWhats'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => {
    const max = id === 'inClabe' ? 18 : 10;
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, max);
  });
});

/* ============================================================
   5. REVEAL ON SCROLL
   ============================================================ */
const io = new IntersectionObserver(entries => {
  entries.forEach(en => { if (en.isIntersecting) en.target.classList.add('visible'); });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach(el => io.observe(el));
