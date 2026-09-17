/* ============================================================
   Pruebas unitarias — lib/precio.js
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');

const { precioParaFecha, precioVigente, PRECIOS } = require('../lib/precio');

test('precioParaFecha da $150 en cualquier fecha dentro de la promo (hasta el 30 de sep de 2026)', () => {
  assert.equal(precioParaFecha('2026-09-01'), 150);
  assert.equal(precioParaFecha('2026-09-30'), 150); // límite inclusivo
});

test('precioParaFecha da $250 justo después de que termina la promo', () => {
  assert.equal(precioParaFecha('2026-10-01'), 250);
  assert.equal(precioParaFecha('2027-01-01'), 250);
});

test('precioParaFecha nunca lanza y siempre devuelve un número de PRECIOS', () => {
  const precio = precioParaFecha('1999-01-01'); // fecha absurdamente vieja
  assert.ok(PRECIOS.some(etapa => etapa.precio === precio));
});

test('precioVigente respeta el override de emergencia PRECIO_BOLETO sobre la tabla', () => {
  const original = process.env.PRECIO_BOLETO;
  try {
    process.env.PRECIO_BOLETO = '999';
    assert.equal(precioVigente(), 999);
  } finally {
    if (original === undefined) delete process.env.PRECIO_BOLETO;
    else process.env.PRECIO_BOLETO = original;
  }
});

test('precioVigente sin override usa la tabla de fechas real (hoy)', () => {
  const original = process.env.PRECIO_BOLETO;
  try {
    delete process.env.PRECIO_BOLETO;
    assert.ok(PRECIOS.some(etapa => etapa.precio === precioVigente()));
  } finally {
    if (original !== undefined) process.env.PRECIO_BOLETO = original;
  }
});
