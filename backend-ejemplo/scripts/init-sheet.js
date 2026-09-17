/* ============================================================
   Prepara el Google Sheet: crea hojas "Compras" y "Config"
   con encabezados. Correr UNA vez:  npm run init-sheet
   Requiere .env con GOOGLE_CREDENTIALS_B64 y SHEETS_ID.
   ============================================================ */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');

const ENCABEZADOS = [
  'Folio', 'Fecha', 'Nombre', 'Email', 'WhatsApp', 'Cantidad',
  'Monto', 'ClabeCifrada', 'ComprobanteURL', 'Estado',
  'FechaValidado', 'CodigoQR', 'QREnviado', 'EmailRegistro',
  'EmailConfirmacion', 'Notas', 'EscaneadoEn', 'NombresBoletos',
];

async function main() {
  const raw = process.env.GOOGLE_CREDENTIALS_B64
    ? Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, 'base64').toString('utf8')
    : process.env.GOOGLE_CREDENTIALS_JSON;
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.SHEETS_ID;

  // Crear hojas si no existen
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existentes = meta.data.sheets.map(s => s.properties.title);
  const faltantes = ['Compras', 'Config'].filter(t => !existentes.includes(t));
  if (faltantes.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: faltantes.map(title => ({ addSheet: { properties: { title } } })) },
    });
    console.log('Hojas creadas:', faltantes.join(', '));
  }

  // Encabezados de Compras
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: 'Compras!A1:R1',
    valueInputOption: 'RAW',
    requestBody: { values: [ENCABEZADOS] },
  });

  // Config con precio default
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: 'Config!A1:B1',
    valueInputOption: 'RAW',
    requestBody: { values: [['precio', '400']] },
  });

  console.log('✔ Sheet listo. Hoja "Compras" con encabezados y "Config" con precio=400.');
}

if (require.main === module) {
  main().catch(e => { console.error('Error:', e.message); process.exit(1); });
}

module.exports = { ENCABEZADOS };
