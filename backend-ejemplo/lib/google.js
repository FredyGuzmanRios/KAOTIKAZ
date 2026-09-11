/* ============================================================
   KAOTIKAZ — Google Sheets + Drive (service account)
   El Sheet es la "base de datos" que alimenta el panel staff.

   Hoja "Compras" — columnas (¡no cambiar el orden sin actualizar
   COLS y SETUP.md!):
   A Folio | B Fecha | C Nombre | D Email | E WhatsApp | F Cantidad
   G Monto | H ClabeCifrada | I ComprobanteURL | J Estado
   K FechaValidado | L CodigoQR | M QREnviado | N EmailRegistro
   O EmailConfirmacion | P Notas
   ============================================================ */

const { google } = require('googleapis');
const { Readable } = require('stream');

const HOJA = 'Compras';
const RANGO = `${HOJA}!A:P`;

const COLS = [
  'folio', 'fecha', 'nombre', 'email', 'whatsapp', 'cantidad',
  'monto', 'clabeCifrada', 'comprobante', 'estado',
  'validado', 'codigoQr', 'qrEnviado', 'emailRegistro',
  'emailConfirmacion', 'notas',
];

let _auth = null;
function getAuth() {
  if (_auth) return _auth;
  const raw = process.env.GOOGLE_CREDENTIALS_B64
    ? Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf8')
    : process.env.GOOGLE_CREDENTIALS_JSON;
  if (!raw) throw new Error('Faltan credenciales de Google (GOOGLE_CREDENTIALS_B64)');
  _auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  return _auth;
}

function sheetsApi() { return google.sheets({ version: 'v4', auth: getAuth() }); }
function driveApi()  { return google.drive({ version: 'v3', auth: getAuth() }); }

/* ---------- Compras ---------- */

/** Agrega una fila nueva a la hoja "Compras". */
async function agregarCompra(c) {
  const fila = COLS.map(k => c[k] ?? '');
  await sheetsApi().spreadsheets.values.append({
    spreadsheetId: process.env.SHEETS_ID,
    range: RANGO,
    valueInputOption: 'RAW', // RAW = nunca interpretar como fórmula
    requestBody: { values: [fila] },
  });
}

/** Devuelve todas las compras como objetos { folio, nombre, ... , _row }. */
async function listarCompras() {
  const res = await sheetsApi().spreadsheets.values.get({
    spreadsheetId: process.env.SHEETS_ID,
    range: RANGO,
  });
  const filas = res.data.values || [];
  return filas.slice(1).map((fila, i) => {
    const obj = { _row: i + 2 }; // fila real en el sheet (1 = encabezado)
    COLS.forEach((k, n) => { obj[k] = fila[n] ?? ''; });
    return obj;
  });
}

/** Actualiza campos de una compra localizada por folio. */
async function actualizarCompra(folio, cambios) {
  const compras = await listarCompras();
  const compra = compras.find(c => c.folio === folio);
  if (!compra) throw new Error(`Folio ${folio} no encontrado`);

  const actualizado = { ...compra, ...cambios };
  const fila = COLS.map(k => actualizado[k] ?? '');
  await sheetsApi().spreadsheets.values.update({
    spreadsheetId: process.env.SHEETS_ID,
    range: `${HOJA}!A${compra._row}:P${compra._row}`,
    valueInputOption: 'RAW',
    requestBody: { values: [fila] },
  });
  return actualizado;
}

/* ---------- Config (hoja "Config": A=clave, B=valor) ---------- */

async function leerConfig() {
  try {
    const res = await sheetsApi().spreadsheets.values.get({
      spreadsheetId: process.env.SHEETS_ID,
      range: 'Config!A:B',
    });
    return Object.fromEntries((res.data.values || []).map(([k, v]) => [k, v]));
  } catch {
    return {}; // si no existe la hoja, usar defaults del .env
  }
}

/* ---------- Drive: comprobantes ---------- */

/** Sube el comprobante (buffer de multer) a la carpeta de Drive.
 *  Devuelve el link para verlo (solo cuentas con acceso a la carpeta). */
async function subirComprobante(buffer, mimetype, folio) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mimetype] || 'bin';
  const res = await driveApi().files.create({
    requestBody: {
      name: `comprobante-${folio}.${ext}`,
      parents: [process.env.DRIVE_FOLDER_ID],
    },
    media: { mimeType: mimetype, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  return res.data.webViewLink;
}

/** Descarga un comprobante desde Drive usando la service account.
 *  Acepta el webViewLink guardado en el Sheet y extrae el ID.
 *  Devuelve { buffer, mimeType } o null. */
async function descargarComprobante(webViewLink) {
  const m = String(webViewLink).match(/[-\w]{25,}/); // ID de Drive dentro de la URL
  if (!m) return null;
  const fileId = m[0];
  const drive = driveApi();
  const meta = await drive.files.get({ fileId, fields: 'mimeType', supportsAllDrives: true });
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return { buffer: Buffer.from(res.data), mimeType: meta.data.mimeType || 'application/octet-stream' };
}

module.exports = { agregarCompra, listarCompras, actualizarCompra, leerConfig, subirComprobante, descargarComprobante, COLS };
