/* ============================================================
   Prueba de integración — levanta el servidor real (server.js) en un
   puerto efímero, con Google Sheets/Drive y Brevo reemplazados por
   versiones en memoria (nunca toca la red ni credenciales reales).

   Cubre exactamente lo que se pidió revisar:
     1. El comprobante de transferencia es obligatorio para registrar
        una compra ("a huevo" lo pide, con o sin JS en el navegador).
     2. Los registros SÍ se guardan (con los campos correctos) en lo
        que hace de Sheet.
     3. Los estados PENDIENTE / CONFIRMADO / RECHAZADO se manejan bien
        a lo largo del flujo completo, incluida la protección de sesión
        del panel staff.
     4. De regalo: el escaneo de acceso en la puerta valida el QR y
        evita reingresos con el mismo código (ver escaneo.html).
   ============================================================ */

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'sesion-secret-de-prueba';
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('hex');
process.env.ADMIN_USER = 'staff_prueba';
process.env.ADMIN_EMAIL = 'admin-prueba@example.com'; // para probar el adjunto del comprobante
delete process.env.TURNSTILE_SECRET;   // sin captcha en pruebas
delete process.env.PRECIO_BOLETO;      // usa la tabla real de lib/precio.js
delete process.env.ADMIN_WHATSAPP;

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const CLAVE_PRUEBA = 'clave-de-prueba-123';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(CLAVE_PRUEBA, 4); // costo bajo, es prueba

/* ---------- Dobles de Google Sheets/Drive y Brevo ----------
   server.js hace `const g = require('./lib/google')` UNA vez al cargar
   y siempre llama a `g.metodo(...)` (nunca desestructura las funciones).
   Como Node cachea los módulos por ruta resuelta, mutar los métodos de
   este mismo objeto (misma ruta: backend-ejemplo/lib/google.js) ANTES de
   requerir server.js hace que server.js use estas versiones falsas sin
   tocar la API real de Google. Igual para brevo.js. */
const g = require('../lib/google');
const brevo = require('../lib/brevo');

let filas = []; // esto hace las veces de la hoja "Compras" del Sheet
// Nota: el comprobante YA NO se sube a Drive (ver server.js, 17 sep — las
// cuentas de servicio no tienen cuota de almacenamiento propia y esto
// tronaba con 500 en cada compra real). No hace falta doble de
// subirComprobante/descargarComprobante: server.js ya no los llama.
g.agregarCompra = async (compra) => { filas.push({ ...compra }); };
g.listarCompras = async () => filas.map((f, i) => ({ ...f, _row: i + 2 }));
g.actualizarCompra = async (folio, cambios) => {
  const idx = filas.findIndex(f => f.folio === folio);
  if (idx < 0) throw new Error(`Folio ${folio} no encontrado`);
  filas[idx] = { ...filas[idx], ...cambios };
  return filas[idx];
};

const correosEnviados = [];
brevo.enviarCorreo = async (msg) => { correosEnviados.push(msg); return { messageId: 'fake-id' }; };

const app = require('../server');
const { precioVigente } = require('../lib/precio');

let server;
let base;

test.before(() => {
  server = app.listen(0);
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

/* ---------- Helpers ---------- */

/** Firma real de PNG + relleno: basta para pasar detectarImagen(), no
 *  hace falta que sea una imagen decodificable de verdad. */
function pngFalso() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
}

function formularioCompra({
  nombre = 'Ana Pérez', email = 'ana@correo.com', whatsapp = '5512345678',
  cantidad = '2', conComprobante = true,
} = {}) {
  const fd = new FormData();
  fd.append('nombre', nombre);
  fd.append('email', email);
  fd.append('whatsapp', whatsapp);
  fd.append('cantidad', cantidad);
  if (conComprobante) {
    fd.append('comprobante', new Blob([pngFalso()], { type: 'image/png' }), 'comprobante.png');
  }
  return fd;
}

/* ---------- 1. El comprobante es obligatorio ---------- */

test('POST /api/compras rechaza el registro si no se sube el comprobante', async () => {
  const res = await fetch(`${base}/api/compras`, { method: 'POST', body: formularioCompra({ conComprobante: false }) });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.campos.includes('comprobante'));
  assert.equal(filas.length, 0); // no se guardó ningún registro
});

test('POST /api/compras rechaza un archivo que dice ser imagen pero no lo es (magic bytes)', async () => {
  const fd = formularioCompra({ conComprobante: false });
  fd.append('comprobante', new Blob([Buffer.from('esto no es una imagen de verdad')], { type: 'image/png' }), 'fake.png');
  const res = await fetch(`${base}/api/compras`, { method: 'POST', body: fd });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.campos.includes('comprobante'));
  assert.equal(filas.length, 0);
});

/* ---------- 2. El registro se guarda con los campos correctos ---------- */

let folio1;

test('POST /api/compras con datos válidos y comprobante SÍ guarda el registro como PENDIENTE', async () => {
  const res = await fetch(`${base}/api/compras`, { method: 'POST', body: formularioCompra() });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.match(json.folio, /^K-\d+$/);
  assert.equal(json.monto, 2 * precioVigente());
  folio1 = json.folio;

  assert.equal(filas.length, 1);
  assert.equal(filas[0].folio, folio1);
  assert.equal(filas[0].estado, 'PENDIENTE');
  assert.equal(filas[0].nombre, 'Ana Pérez');
  assert.equal(filas[0].email, 'ana@correo.com');
  assert.equal(filas[0].cantidad, '2');
  assert.equal(filas[0].qrEnviado, 'NO');
  assert.equal(filas[0].comprobante, ''); // ya no se guarda ningún link de Drive
  assert.ok(correosEnviados.some((c) => c.to === 'ana@correo.com'));

  // El comprobante viaja como adjunto en el correo al admin, no a Drive
  // (ver la nota grande en server.js sobre storageQuotaExceeded).
  const correoAdmin = correosEnviados.find((c) => c.to === process.env.ADMIN_EMAIL);
  assert.ok(correoAdmin, 'debe mandarse un correo a ADMIN_EMAIL con el comprobante adjunto');
  assert.equal(correoAdmin.attachment.length, 1);
  assert.match(correoAdmin.attachment[0].name, /^comprobante-K-\d+\.png$/);
  assert.ok(correoAdmin.attachment[0].content.length > 0);
});

test('el honeypot ("website" lleno) responde ok pero NO guarda nada', async () => {
  const antes = filas.length;
  const fd = formularioCompra();
  fd.append('website', 'soy-un-bot');
  const res = await fetch(`${base}/api/compras`, { method: 'POST', body: fd });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(filas.length, antes);
});

/* ---------- 3. El panel staff requiere sesión ---------- */

test('GET /api/compras sin sesión responde 401', async () => {
  const res = await fetch(`${base}/api/compras`);
  assert.equal(res.status, 401);
});

test('POST /api/login con contraseña incorrecta responde 401 "Credenciales incorrectas"', async () => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: process.env.ADMIN_USER, password: 'clave-incorrecta' }),
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'Credenciales incorrectas');
});

let cookie;

test('POST /api/login con las credenciales correctas entrega una cookie de sesión', async () => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: process.env.ADMIN_USER, password: CLAVE_PRUEBA }),
  });
  assert.equal(res.status, 200);
  cookie = res.headers.get('set-cookie');
  assert.ok(cookie && cookie.includes('ktz_sesion='));
});

test('GET /api/compras con sesión ve el registro pendiente recién creado', async () => {
  const res = await fetch(`${base}/api/compras`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const lista = await res.json();
  const compra = lista.find((c) => c.folio === folio1);
  assert.ok(compra, 'el folio recién creado debe aparecer en /api/compras');
  assert.equal(compra.estado, 'PENDIENTE');
  assert.equal(compra.qrEnviado, false);
});

/* ---------- 4. Confirmar: PENDIENTE -> CONFIRMADO + QR ---------- */

let codigosFolio1; // un código QR por boleto (folio1 tiene cantidad=2, sin nombresExtra)

test('POST /api/confirmar pasa el registro a CONFIRMADO y genera un QR real por boleto', async () => {
  const res = await fetch(`${base}/api/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ folio: folio1 }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.codigos.length, 2); // cantidad=2 -> 2 códigos, uno por persona
  json.codigos.forEach((c) => assert.match(c, /^KTZ-/));
  assert.notEqual(json.codigos[0], json.codigos[1]); // cada boleto tiene su PROPIO código
  codigosFolio1 = json.codigos;

  const fila = filas.find((f) => f.folio === folio1);
  assert.equal(fila.estado, 'CONFIRMADO');
  assert.equal(fila.qrEnviado, 'SI');
  assert.ok(fila.validado);
  assert.deepEqual(JSON.parse(fila.codigoQr), codigosFolio1);
  assert.deepEqual(JSON.parse(fila.escaneadoEn), ['', '']); // nadie ha entrado todavía

  const correo = correosEnviados.find((c) => c.subject && c.subject.includes('Pago confirmado'));
  assert.ok(correo);
  // Sin nombresExtra, el boleto 2 se etiqueta "Invitado 2" (ver server.js)
  // y, al ser 2+ boletos, cada uno trae su propia etiqueta "Boleto N de 2".
  assert.match(correo.html, /Boleto 1 de 2 — Ana Pérez/);
  assert.match(correo.html, /Boleto 2 de 2 — Invitado 2/);
  assert.match(correo.html, new RegExp(codigosFolio1[0]));
  assert.match(correo.html, new RegExp(codigosFolio1[1]));
});

test('POST /api/confirmar sobre un folio ya confirmado responde 409 (no lo procesa dos veces)', async () => {
  const res = await fetch(`${base}/api/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ folio: folio1 }),
  });
  assert.equal(res.status, 409);
});

/* ---------- 5. Rechazar: PENDIENTE -> RECHAZADO ---------- */

let folio2;

test('un segundo registro se puede rechazar con motivo, y su estado pasa a RECHAZADO', async () => {
  const resCompra = await fetch(`${base}/api/compras`, {
    method: 'POST',
    body: formularioCompra({ nombre: 'Beto Ruiz', email: 'beto@correo.com', cantidad: '1' }),
  });
  folio2 = (await resCompra.json()).folio;

  const res = await fetch(`${base}/api/rechazar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ folio: folio2, motivo: 'El monto transferido no coincide' }),
  });
  assert.equal(res.status, 200);

  const fila = filas.find((f) => f.folio === folio2);
  assert.equal(fila.estado, 'RECHAZADO');
  assert.equal(fila.notas, 'El monto transferido no coincide');
});

/* ---------- 6. Escaneo en la puerta: un QR por persona, cada quien
   entra por separado (evita reingresos SOLO del código ya usado) ---------- */

test('POST /api/escanear con el QR del boleto 1 (la compradora) marca SU entrada', async () => {
  const res = await fetch(`${base}/api/escanear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ codigoQr: codigosFolio1[0] }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.resultado, 'OK');
  assert.equal(json.folio, folio1);
  assert.equal(json.nombre, 'Ana Pérez');
  assert.equal(json.boleto, 1);
  assert.equal(json.cantidad, 2);
  assert.equal(json.escaneados, 1); // solo ella, todavía no el boleto 2
});

test('POST /api/escanear con el MISMO QR una segunda vez lo marca YA_USADO (anti reingreso)', async () => {
  const res = await fetch(`${base}/api/escanear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ codigoQr: codigosFolio1[0] }),
  });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).resultado, 'YA_USADO');
});

test('el QR del boleto 2 de la MISMA compra sigue funcionando aunque el boleto 1 ya haya entrado (acceso independiente por persona)', async () => {
  const res = await fetch(`${base}/api/escanear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ codigoQr: codigosFolio1[1] }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.resultado, 'OK');
  assert.equal(json.folio, folio1);
  assert.equal(json.nombre, 'Invitado 2'); // folio1 no llevó nombresExtra (ver arriba)
  assert.equal(json.boleto, 2);
  assert.equal(json.escaneados, 2); // ahora sí entraron los 2 boletos de esta compra

  // GET /api/compras debe reflejar el detalle boleto por boleto para el panel de staff.
  const resLista = await fetch(`${base}/api/compras`, { headers: { Cookie: cookie } });
  const compra = (await resLista.json()).find((c) => c.folio === folio1);
  assert.equal(compra.escaneos.filter(Boolean).length, 2);
});

test('POST /api/escanear con un código que no existe responde NO_ENCONTRADO', async () => {
  const res = await fetch(`${base}/api/escanear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ codigoQr: 'KTZ-NO-EXISTE-0000' }),
  });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).resultado, 'NO_ENCONTRADO');
});

/* ---------- 7. Nombre por boleto (2+ boletos) ---------- */

test('POST /api/compras rechaza nombresExtra si no trae la cantidad correcta de nombres', async () => {
  const fd = formularioCompra({ cantidad: '3' });
  fd.append('nombresExtra', JSON.stringify(['Solo uno']));
  const res = await fetch(`${base}/api/compras`, { method: 'POST', body: fd });
  assert.equal(res.status, 400);
  const json = await res.json();
  assert.ok(json.campos.includes('nombresExtra'));
});

test('una compra con nombresExtra guarda el nombre de cada boleto, y el correo de confirmación trae un QR separado y etiquetado por persona', async () => {
  const fd = formularioCompra({ nombre: 'Carla Gómez', email: 'carla@correo.com', cantidad: '3' });
  fd.append('nombresExtra', JSON.stringify(['Luis Torres', 'Marta Díaz']));
  const res = await fetch(`${base}/api/compras`, { method: 'POST', body: fd });
  assert.equal(res.status, 200);
  const { folio } = await res.json();

  const fila = filas.find((f) => f.folio === folio);
  assert.deepEqual(JSON.parse(fila.nombresBoletos), ['Luis Torres', 'Marta Díaz']);

  const resConf = await fetch(`${base}/api/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ folio }),
  });
  assert.equal(resConf.status, 200);
  const { codigos } = await resConf.json();
  assert.equal(codigos.length, 3); // comprador + 2 invitados = 3 QR independientes
  assert.equal(new Set(codigos).size, 3); // los 3 códigos son distintos entre sí

  const correo = correosEnviados.find((c) => c.to === 'carla@correo.com' && c.subject.includes('Pago confirmado'));
  assert.ok(correo, 'debe mandarse el correo de confirmación al comprador');
  // Cada boleto se etiqueta con SU nombre (no "comprador - invitado"), ya
  // que cada uno tiene su propio bloque separado con su propio QR.
  assert.match(correo.html, /Boleto 1 de 3 — Carla Gómez/);
  assert.match(correo.html, /Boleto 2 de 3 — Luis Torres/);
  assert.match(correo.html, /Boleto 3 de 3 — Marta Díaz/);
  codigos.forEach((c) => assert.match(correo.html, new RegExp(c)));

  // Cada código escanea de forma independiente: el de Luis no depende del de Carla.
  const resEscLuis = await fetch(`${base}/api/escanear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ codigoQr: codigos[1] }),
  });
  const jsonEscLuis = await resEscLuis.json();
  assert.equal(jsonEscLuis.resultado, 'OK');
  assert.equal(jsonEscLuis.nombre, 'Luis Torres');
  assert.equal(jsonEscLuis.boleto, 2);
  assert.equal(jsonEscLuis.escaneados, 1); // Carla y Marta todavía no han entrado
});

test('una compra de 1 boleto no manda nombresExtra y el correo de confirmación no muestra etiquetas de "boleto N de M" (innecesarias con un solo QR)', async () => {
  const res = await fetch(`${base}/api/compras`, {
    method: 'POST',
    body: formularioCompra({ nombre: 'Dario Ruiz', email: 'dario@correo.com', cantidad: '1' }),
  });
  const { folio } = await res.json();

  const resConf = await fetch(`${base}/api/confirmar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ folio }),
  });
  const { codigos } = await resConf.json();
  assert.equal(codigos.length, 1);

  const correo = correosEnviados.find((c) => c.to === 'dario@correo.com' && c.subject.includes('Pago confirmado'));
  assert.ok(correo);
  assert.doesNotMatch(correo.html, /Boleto 1 de 1/);
  assert.match(correo.html, new RegExp(codigos[0]));
});
