/* ============================================================
   Pruebas unitarias — lib/validacion.js
   Corre con:  npm test   (usa el runner nativo de Node, sin deps nuevas)
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeServer, sheetSafe, validarCompra, detectarImagen, validarNombresExtra } = require('../lib/validacion');

/* ---------- sanitizeServer ---------- */

test('sanitizeServer recorta espacios en los extremos', () => {
  assert.equal(sanitizeServer('  Ana Pérez  '), 'Ana Pérez');
});

test('sanitizeServer quita caracteres invisibles y de control (tab, salto de línea, zero-width)', () => {
  assert.equal(sanitizeServer('con​zero-width'), 'conzero-width');
  assert.equal(sanitizeServer('a\tb\nc'), 'abc'); // tab (0x09) y salto de línea (0x0a) son ambos "de control"
});

test('sanitizeServer quita caracteres peligrosos para HTML/inyección (<>"\'`\\)', () => {
  assert.equal(sanitizeServer('<script>alert(1)</script>'), 'scriptalert(1)/script');
  assert.equal(sanitizeServer(`O'Brien "el grande" \`x\` \\y`), 'OBrien el grande x y');
});

/* ---------- sheetSafe (anti fórmula-inyección en Sheets) ---------- */

test('sheetSafe antepone comilla a valores que empiezan como fórmula', () => {
  assert.equal(sheetSafe('=HYPERLINK("evil.com")'), "'=HYPERLINK(\"evil.com\")");
  assert.equal(sheetSafe('+1234'), "'+1234");
  assert.equal(sheetSafe('-1234'), "'-1234");
  assert.equal(sheetSafe('@usuario'), "'@usuario");
});

test('sheetSafe deja intactos los valores normales', () => {
  assert.equal(sheetSafe('Ana Pérez'), 'Ana Pérez');
  assert.equal(sheetSafe('ana@correo.com'), 'ana@correo.com');
});

/* ---------- validarCompra ---------- */

test('validarCompra acepta un registro válido completo', () => {
  const { errores, limpio } = validarCompra({
    nombre: 'Ana Pérez', email: 'ana@correo.com', whatsapp: '5512345678', cantidad: '2',
  });
  assert.deepEqual(errores, []);
  assert.equal(limpio.nombre, 'Ana Pérez');
  assert.equal(limpio.email, 'ana@correo.com');
  assert.equal(limpio.whatsapp, '5512345678');
  assert.equal(limpio.cantidad, '2');
});

test('validarCompra acepta whatsapp vacío (es opcional)', () => {
  const { errores } = validarCompra({ nombre: 'Ana Pérez', email: 'ana@correo.com', whatsapp: '', cantidad: '1' });
  assert.deepEqual(errores, []);
});

test('validarCompra rechaza nombre demasiado corto o con números', () => {
  const { errores: e1 } = validarCompra({ nombre: 'An', email: 'ana@correo.com', whatsapp: '', cantidad: '1' });
  assert.ok(e1.includes('nombre'));
  const { errores: e2 } = validarCompra({ nombre: 'Ana123', email: 'ana@correo.com', whatsapp: '', cantidad: '1' });
  assert.ok(e2.includes('nombre'));
});

test('validarCompra rechaza email sin arroba o mal formado', () => {
  const { errores } = validarCompra({ nombre: 'Ana Pérez', email: 'no-es-correo', whatsapp: '', cantidad: '1' });
  assert.ok(errores.includes('email'));
});

test('validarCompra rechaza whatsapp que no sean exactamente 10 dígitos', () => {
  const { errores: e1 } = validarCompra({ nombre: 'Ana Pérez', email: 'ana@correo.com', whatsapp: '123', cantidad: '1' });
  assert.ok(e1.includes('whatsapp'));
  const { errores: e2 } = validarCompra({ nombre: 'Ana Pérez', email: 'ana@correo.com', whatsapp: 'abcdefghij', cantidad: '1' });
  assert.ok(e2.includes('whatsapp'));
});

test('validarCompra rechaza cantidad fuera de rango (1 a 5) o no entera', () => {
  for (const cantidad of ['0', '6', '-1', '2.5', 'x']) {
    const { errores } = validarCompra({ nombre: 'Ana Pérez', email: 'ana@correo.com', whatsapp: '', cantidad });
    assert.ok(errores.includes('cantidad'), `cantidad=${cantidad} debería fallar`);
  }
});

test('validarCompra reporta todos los campos inválidos a la vez, no solo el primero', () => {
  const { errores } = validarCompra({ nombre: '', email: 'x', whatsapp: '123', cantidad: '99' });
  assert.deepEqual(errores.sort(), ['cantidad', 'email', 'nombre', 'whatsapp']);
});

/* ---------- detectarImagen (comprobante de transferencia) ---------- */

test('detectarImagen reconoce JPEG, PNG y WebP por sus bytes reales', () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(detectarImagen(jpg), 'image/jpeg');

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(detectarImagen(png), 'image/png');

  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  assert.equal(detectarImagen(webp), 'image/webp');
});

test('detectarImagen rechaza archivos sin firma de imagen (aunque digan que sí lo son)', () => {
  // Un .txt renombrado a .png, o un MIME falsificado por el cliente:
  // detectarImagen mira los bytes reales, no el nombre ni el MIME declarado.
  const textoDisfrazado = Buffer.from('este es un archivo de texto, no una imagen');
  assert.equal(detectarImagen(textoDisfrazado), null);
});

test('detectarImagen rechaza buffers vacíos, ausentes o demasiado cortos', () => {
  // server.js calcula "tipoReal = req.file ? detectarImagen(req.file.buffer) : null"
  // — cuando no se sube ningún archivo, req.file es undefined, así que
  // esta misma rama (detectarImagen(undefined) === null) es la que hace
  // que /api/compras marque 'comprobante' como error obligatorio.
  // Ver test/compras-integration.test.js para la prueba end-to-end.
  assert.equal(detectarImagen(null), null);
  assert.equal(detectarImagen(undefined), null);
  assert.equal(detectarImagen(Buffer.alloc(0)), null);
  assert.equal(detectarImagen(Buffer.from([0x89, 0x50, 0x4e])), null); // PNG truncado
});

/* ---------- validarNombresExtra (nombre por boleto, 2+ boletos) ---------- */

test('validarNombresExtra no exige nada si la cantidad es 1 (aunque manden el campo)', () => {
  const r = validarNombresExtra('1', JSON.stringify(['Alguien']));
  assert.equal(r.ok, true);
  assert.deepEqual(r.nombres, []);
});

test('validarNombresExtra es opcional: si el cliente no lo manda, la compra no se rechaza', () => {
  const r1 = validarNombresExtra('3', undefined);
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.nombres, []);
  const r2 = validarNombresExtra('3', '');
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.nombres, []);
});

test('validarNombresExtra acepta exactamente cantidad-1 nombres válidos y los sanitiza', () => {
  const r = validarNombresExtra('3', JSON.stringify(['  Juan Pérez  ', 'Ana López']));
  assert.equal(r.ok, true);
  assert.deepEqual(r.nombres, ['Juan Pérez', 'Ana López']);
});

test('validarNombresExtra rechaza si no vienen exactamente cantidad-1 nombres', () => {
  const faltan = validarNombresExtra('3', JSON.stringify(['Solo uno']));
  assert.equal(faltan.ok, false);
  const sobran = validarNombresExtra('2', JSON.stringify(['Uno', 'Dos']));
  assert.equal(sobran.ok, false);
});

test('validarNombresExtra rechaza nombres inválidos (cortos, con números o vacíos)', () => {
  assert.equal(validarNombresExtra('2', JSON.stringify(['An'])).ok, false);
  assert.equal(validarNombresExtra('2', JSON.stringify(['Juan123'])).ok, false);
  assert.equal(validarNombresExtra('2', JSON.stringify([''])).ok, false);
});

test('validarNombresExtra rechaza JSON malformado o que no es un arreglo', () => {
  assert.equal(validarNombresExtra('2', '{esto no es json').ok, false);
  assert.equal(validarNombresExtra('2', JSON.stringify({ no: 'es un arreglo' })).ok, false);
});
