/* ============================================================
   KAOTIKAZ — Precio del boleto por fecha (lógica interna).

   Ya NO se controla desde la hoja "Config" del Sheet (ese mecanismo
   se quitó: era fácil de resetear sin querer, porque
   `npm run init-sheet` reescribía Config!A1:B1 a 400 cada vez que
   se corría). Ahora el precio vive aquí, en código.

   Cómo agregar/cambiar una etapa de precio:
   - Edita el arreglo PRECIOS. Cada etapa tiene una fecha límite
     "hasta" (formato 'YYYY-MM-DD', zona horaria Ciudad de México,
     inclusiva) y su precio. La ÚLTIMA etapa debe tener hasta:null:
     ese es el precio normal/definitivo que aplica después de todas
     las promociones.
   - Guarda, sube el cambio y vuelve a desplegar en Coolify. No hace
     falta tocar el Sheet ni las variables de entorno.

   Override de emergencia sin redeploy: si necesitas forzar un precio
   YA MISMO sin esperar a un despliegue, define PRECIO_BOLETO en las
   variables de entorno de Coolify (Developer view) y reinicia la app
   — ese valor gana sobre esta tabla mientras esté definido.
   ============================================================ */

const PRECIOS = [
  { hasta: '2026-09-30', precio: 150 }, // promo de septiembre
  { hasta: null, precio: 250 },         // precio normal desde octubre 2026
];

/** Fecha de hoy como 'YYYY-MM-DD' en la zona horaria de Ciudad de México
 *  (evita bugs de huso horario si el servidor corre en UTC). */
function hoyCDMX() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
}

/** Precio vigente hoy según PRECIOS, salvo que exista un override
 *  manual en la variable de entorno PRECIO_BOLETO. */
function precioVigente() {
  if (process.env.PRECIO_BOLETO) return +process.env.PRECIO_BOLETO;

  const hoy = hoyCDMX();
  for (const etapa of PRECIOS) {
    if (etapa.hasta === null || hoy <= etapa.hasta) return etapa.precio;
  }
  return PRECIOS[PRECIOS.length - 1].precio; // por si acaso
}

module.exports = { precioVigente, PRECIOS };
