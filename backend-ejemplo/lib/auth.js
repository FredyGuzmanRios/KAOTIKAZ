/* ============================================================
   KAOTIKAZ — Blindaje del hash de contraseña del panel staff.

   Un hash de bcrypt siempre tiene esta forma: $2a$/$2b$/$2y$ + costo de
   2 dígitos + $ + 53 caracteres de sal+hash. Algunas plataformas de
   hosting (Coolify incluida, si no se marca "Is Literal?") interpretan el
   signo $ dentro de una variable de entorno como el inicio de una
   referencia a otra variable (estilo ${OTRA_VAR}) y lo corrompen al
   guardarlo o inyectarlo al contenedor. Para blindarnos de eso: si el
   valor de ADMIN_PASSWORD_HASH no tiene pinta de hash bcrypt, probamos a
   decodificarlo como base64 (que no usa $ y por lo tanto no se corrompe)
   antes de darlo por inválido.

   Extraído de server.js a su propio módulo para poder probarlo con una
   prueba unitaria (ver test/auth.test.js) sin tocar process.env.
   ============================================================ */

const RE_BCRYPT = /^\$2[aby]\$\d{2}\$.{53}$/;

/** Recibe el valor crudo de ADMIN_PASSWORD_HASH (string) y devuelve el
 *  hash bcrypt que hay que usar en bcrypt.compare(). Si no puede
 *  encontrar un hash bcrypt válido (ni directo ni decodificando base64),
 *  devuelve el valor crudo tal cual — bcrypt.compare() simplemente
 *  fallará (ningún password hace match), nunca lanza una excepción. */
function hashAdminVigente(raw) {
  const valor = (raw || '').trim();
  if (RE_BCRYPT.test(valor)) return valor;
  try {
    const decodificado = Buffer.from(valor, 'base64').toString('utf8').trim();
    if (RE_BCRYPT.test(decodificado)) return decodificado;
  } catch { /* no era base64 válido, seguimos con el valor crudo */ }
  return valor;
}

module.exports = { RE_BCRYPT, hashAdminVigente };
