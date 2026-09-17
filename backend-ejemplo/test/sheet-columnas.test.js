/* ============================================================
   Prueba de regresión — que el Google Sheet tenga los campos
   correspondientes con su encabezado.

   lib/google.js (COLS, usado por agregarCompra/listarCompras/
   actualizarCompra para leer y escribir cada fila) y
   scripts/init-sheet.js (ENCABEZADOS, lo que de verdad se escribe en la
   fila 1 del Sheet la primera vez que se corre "npm run init-sheet")
   TIENEN que estar en el mismo orden y con la misma cantidad de columnas
   — si alguien cambia una sin la otra, el panel staff empezaría a leer
   cada columna corrida (p. ej. el Estado se vería en la columna del
   Monto), silenciosamente, sin ningún error visible.
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');

const { COLS } = require('../lib/google');
const { ENCABEZADOS } = require('../scripts/init-sheet');

// Traducción esperada clave interna -> etiqueta del encabezado en Sheets.
// Si agregas/quitas/renombras una columna en lib/google.js o en
// scripts/init-sheet.js, actualiza también este mapa.
const ETIQUETA_ESPERADA = {
  folio: 'Folio',
  fecha: 'Fecha',
  nombre: 'Nombre',
  email: 'Email',
  whatsapp: 'WhatsApp',
  cantidad: 'Cantidad',
  monto: 'Monto',
  clabeCifrada: 'ClabeCifrada',
  comprobante: 'ComprobanteURL',
  estado: 'Estado',
  validado: 'FechaValidado',
  codigoQr: 'CodigoQR',
  qrEnviado: 'QREnviado',
  emailRegistro: 'EmailRegistro',
  emailConfirmacion: 'EmailConfirmacion',
  notas: 'Notas',
  escaneadoEn: 'EscaneadoEn',
  nombresBoletos: 'NombresBoletos',
};

test('COLS (lib/google.js) y ENCABEZADOS (scripts/init-sheet.js) tienen las mismas 18 columnas, en el mismo orden', () => {
  assert.equal(COLS.length, 18);
  assert.equal(ENCABEZADOS.length, COLS.length);
  assert.deepEqual(COLS.map(clave => ETIQUETA_ESPERADA[clave]), ENCABEZADOS);
});

test('cada clave de COLS tiene una etiqueta de encabezado definida (nadie se quedó sin mapear)', () => {
  for (const clave of COLS) {
    assert.ok(ETIQUETA_ESPERADA[clave], `Falta la etiqueta de encabezado para "${clave}"`);
  }
});

test('el rango usado en lib/google.js (A:R) alcanza exactamente para las 18 columnas', () => {
  // 18 columnas = A hasta R (A=1 ... R=18). Si algún día se agrega una
  // columna sin extender el rango en google.js, esta prueba lo detecta.
  const letraColumna = (n) => String.fromCharCode('A'.charCodeAt(0) + n - 1);
  assert.equal(letraColumna(COLS.length), 'R');
});
