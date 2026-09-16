/* Precio y captcha: SIEMPRE vienen del backend (ver /api/config y
   backend-ejemplo/lib/precio.js). Lo de aqui es solo un fallback
   mientras carga, para que la pantalla no se vea vacia. */
const CFG = { precio: 150, max: 5 };
let turnstileActivo = false;

let cant = 0, seg = 0, timer = null;
const $ = id => document.getElementById(id);
const money = n => n.toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2});

function unit(){ return CFG.precio; }

/* Una sola funcion pinta la pantalla Y reimprime el ticket */
function pintar(){
  const total = cant * unit();
  $('total').textContent = total.toLocaleString('es-MX');
  $('qty').textContent = cant;
  $('unit').textContent = '$' + unit();
  $('rFase').textContent = CFG.precio <= 150 ? 'promo lanzamiento' : 'precio normal';
  $('rUnit').textContent = '$' + money(CFG.precio);
  $('rCant').textContent = cant;
  $('rTotal').textContent = total.toLocaleString('es-MX');
}

/** Trae el precio real y la llave de Turnstile del servidor, y ajusta
 *  los textos de la pantalla/banner/ficha que dependen del precio.
 *  El monto que de verdad se cobra SIEMPRE lo calcula el servidor;
 *  aqui solo se pinta. */
(async function cargarConfig(){
  try{
    const cfg = await (await fetch('/api/config')).json();
    if (cfg.precio){
      CFG.precio = +cfg.precio;
      pintar();
      const promo = CFG.precio <= 150;
      const banner = $('bannerFase');
      if (banner) banner.textContent = promo
        ? 'PROMO $150 · HASTA EL 30 DE SEPTIEMBRE'
        : 'PRECIO NORMAL · $250 POR BOLETO';
      const fp = $('fPrecioActual');
      if (fp) fp.textContent = '$' + CFG.precio;
    }
    if (cfg.turnstileSiteKey){
      turnstileActivo = true;
      window.onloadTurnstile = () => {
        window.turnstile.render('#turnstileBox', { sitekey: cfg.turnstileSiteKey, theme: 'dark' });
      };
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstile&render=explicit';
      s.async = true;
      document.head.appendChild(s);
    }
  } catch { /* backend apagado (preview estatico): se queda el fallback */ }
})();
function setEstado(txt, pie){
  $('estado').textContent = txt;
  if (pie) $('pie').innerHTML = pie + '<span class="cursor">&#9646;</span>';
}
function arrancarReloj(){
  if (timer) return;
  timer = setInterval(() => {
    seg++;
    $('reloj').textContent =
      String(Math.floor(seg/60)).padStart(2,'0') + ':' + String(seg%60).padStart(2,'0');
  }, 1000);
}

document.querySelectorAll('#pad .tecla[data-qty]').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('#pad .tecla[data-qty]').forEach(x => x.classList.remove('sel'));
    t.classList.add('sel','press');
    setTimeout(() => t.classList.remove('press'), 120);
    cant = parseInt(t.dataset.qty, 10);
    pintar();
    setEstado('TONO', cant + ' BOLETO(S) EN LA LINEA');
  });
});
$('keyClear').addEventListener('click', () => {
  cant = 0;
  document.querySelectorAll('#pad .tecla[data-qty]').forEach(x => x.classList.remove('sel'));
  pintar(); setEstado('TONO', 'MARCA CUANTOS BOLETOS QUIERES');
});

/* Sanitizacion en el cliente: primera linea de defensa (UX).
   La defensa REAL vive en el servidor (ver backend-ejemplo/server.js). */
var CONTROL_CHARS = new RegExp(
  '[' + String.fromCharCode(0x00) + '-' + String.fromCharCode(0x1f) +
  String.fromCharCode(0x7f) +
  String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) +
  String.fromCharCode(0x2028) + String.fromCharCode(0x2029) +
  String.fromCharCode(0xfeff) + ']', 'g');
function sanitize(str, max){
  if (max === undefined) max = 100;
  return String(str)
    .normalize('NFKC')
    .replace(CONTROL_CHARS, '')
    .replace(/[<>"'`\\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}
const INJECTION_PATTERNS = [
  /<\s*script/i, /javascript\s*:/i, /on\w+\s*=/i,
  /(\b(select|insert|update|delete|drop|union|exec)\b.*\b(from|into|table|where)\b)/i,
  /\{\{.*\}\}|\$\{.*\}/,
  /^[=+\-@\t\r]/,
];
function looksMalicious(str){ return INJECTION_PATTERNS.some(re => re.test(str)); }
function cleanField(raw, max){
  const v = sanitize(raw, max);
  return looksMalicious(v) ? null : v;
}

const V = {
  nombre: v => v !== null && /^[a-záéíóúüñ\s.]{3,80}$/i.test(v),
  email:  v => v !== null && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
  whats:  v => v !== null && (v === '' || /^\d{10}$/.test(v))
};
const MAXLEN = { nombre: 80, email: 100, whats: 10 };
function check(id){
  const el = $(id), campo = el.closest('.campo');
  const ok = id === 'comp'
    ? (el.files.length === 1 && el.files[0].type.startsWith('image/') && el.files[0].size <= 5e6)
    : V[id](cleanField(el.value, MAXLEN[id]));
  campo.classList.toggle('invalid', !ok);
  return ok;
}

/* TONO -> MARCANDO */
$('btnLlamar').addEventListener('click', () => {
  if (cant < 1){ setEstado('LINEA OCUPADA', 'PRIMERO MARCA UNA CANTIDAD (1 A 5)'); return; }
  arrancarReloj();
  setEstado('MARCANDO', 'DEJA TUS DATOS PARA APARTAR');
  $('rEstado').textContent = 'APARTANDO';
  $('paso1').classList.add('oculto');
  $('paso2').classList.remove('oculto');
});
$('btnVolver1').addEventListener('click', () => {
  $('paso2').classList.add('oculto'); $('paso1').classList.remove('oculto');
  $('rEstado').textContent = 'SIN PAGAR';
  setEstado('TONO', 'MARCA CUANTOS BOLETOS QUIERES');
});

/* MARCANDO -> EN LINEA */
$('btnPago').addEventListener('click', () => {
  if (!['nombre','email','whats'].map(check).every(Boolean)){
    setEstado('ERROR', 'REVISA LOS CAMPOS MARCADOS'); return;
  }
  $('cpMonto').textContent = '$' + money(cant * unit()) + ' MXN';
  $('rEstado').textContent = 'EN VALIDACION';
  setEstado('EN LINEA', 'TRANSFIERE Y SUBE TU COMPROBANTE');
  $('paso2').classList.add('oculto'); $('paso3').classList.remove('oculto');
});
$('btnVolver2').addEventListener('click', () => {
  $('paso3').classList.add('oculto'); $('paso2').classList.remove('oculto');
  $('rEstado').textContent = 'APARTANDO';
  setEstado('MARCANDO', 'DEJA TUS DATOS PARA APARTAR');
});

document.querySelectorAll('.btn-cp').forEach(b => {
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($(b.dataset.cp).textContent.trim()); } catch(e){}
    const p = b.textContent; b.textContent = 'LISTO'; b.classList.add('ok');
    setTimeout(() => { b.textContent = p; b.classList.remove('ok'); }, 1500);
  });
});

$('whats').addEventListener('input', e => {
  e.target.value = e.target.value.replace(/\D/g,'').slice(0,10);
});

/* Nombres de los campos que devuelve el servidor cuando la validacion
   falla (server.js: RULES), mapeados al id real del input en esta pagina. */
const CAMPO_A_INPUT = { nombre: 'nombre', email: 'email', whatsapp: 'whats', cantidad: null, comprobante: 'comp' };

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  if (!['comp'].map(check).every(Boolean)){
    setEstado('ERROR', 'REVISA LOS CAMPOS MARCADOS'); return;
  }
  if (cant < 1){ setEstado('ERROR', 'MARCA CUANTOS BOLETOS QUIERES'); return; }

  const btn = $('form').querySelector('[type="submit"]');
  const textoOriginal = btn ? btn.textContent : '';
  if (btn){ btn.disabled = true; btn.textContent = 'ENVIANDO…'; }
  setEstado('MARCANDO', 'ENVIANDO TU COMPROBANTE…');

  try{
    const data = new FormData();
    data.append('nombre', cleanField($('nombre').value, 80));
    data.append('email', cleanField($('email').value, 100));
    data.append('whatsapp', cleanField($('whats').value, 10));
    data.append('cantidad', cant);
    data.append('comprobante', $('comp').files[0]);
    data.append('website', $('hp').value); // honeypot anti-bots

    if (turnstileActivo){
      const token = window.turnstile ? window.turnstile.getResponse() : '';
      if (!token) throw new Error('Completa la verificacion anti-bot antes de enviar.');
      data.append('cf-turnstile-response', token);
    }

    const res = await fetch('/api/compras', { method: 'POST', body: data });
    const json = await res.json();
    if (!res.ok){
      if (Array.isArray(json.campos)){
        json.campos.forEach(campo => {
          const inputId = CAMPO_A_INPUT[campo];
          if (inputId) $(inputId).closest('.campo').classList.add('invalid');
        });
      }
      throw new Error(json.error || 'No se pudo registrar tu compra.');
    }

    clearInterval(timer);
    const folio = json.folio;
    $('rFolio').textContent = 'FOLIO ' + folio;
    $('rEstado').textContent = 'RECIBIDO';
    $('sello').classList.add('on');
    document.querySelector('.ticket-zona').classList.add('lista');
    document.querySelector('.ticket-zona').scrollIntoView({behavior:'smooth', block:'start'});
    setEstado('FOLIO ' + folio, 'LLAMADA RECIBIDA - REVISA TU CORREO');

    let extra = '';
    if (json.waLink){
      extra = '<a href="' + json.waLink + '" target="_blank" rel="noopener" class="llamar" ' +
        'style="display:inline-block;text-decoration:none;margin-top:16px">AVISANOS POR WHATSAPP (1 TAP)</a>';
    }
    $('form').innerHTML =
      '<p class="hint" style="text-align:center;font-size:10px;line-height:2.2;margin-top:18px">' +
      'REGISTRAMOS TU COMPRA POR $' + money(json.monto) + ' MXN.<br>CUANDO VALIDEMOS EL PAGO TE LLEGA EL QR AL CORREO,<br>' +
      'CON LA FECHA, KAOTIKAZ Y LOS COLECTIVOS IMPRESOS.</p>' + extra;
  } catch(err){
    setEstado('ERROR', (err.message || 'REVISA TUS DATOS E INTENTA DE NUEVO').toUpperCase());
    if (turnstileActivo && window.turnstile) window.turnstile.reset();
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = textoOriginal; }
  }
});

pintar();

/* ===== ARCHIVO: carrusel de artistas (unico modo, desktop y movil) ===== */
(function(){
  const archivoEl = document.querySelector('.archivo');
  if (!archivoEl) return;
  let arrastrando = false, startX = 0, startScroll = 0;
  archivoEl.addEventListener('pointerdown', e => {
    arrastrando = true; startX = e.clientX; startScroll = archivoEl.scrollLeft;
    archivoEl.setPointerCapture(e.pointerId);
  });
  archivoEl.addEventListener('pointermove', e => {
    if (!arrastrando) return;
    archivoEl.scrollLeft = startScroll - (e.clientX - startX);
  });
  archivoEl.addEventListener('pointerup', () => arrastrando = false);
  archivoEl.addEventListener('pointercancel', () => arrastrando = false);
})();
