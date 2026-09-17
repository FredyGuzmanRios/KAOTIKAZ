/* ============================================================
   Pruebas unitarias — lib/auth.js (blindaje del hash de admin)
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

const { hashAdminVigente, RE_BCRYPT } = require('../lib/auth');

test('hashAdminVigente deja pasar un hash bcrypt válido tal cual', () => {
  const hash = bcrypt.hashSync('mi-clave-de-prueba', 4); // costo bajo: prueba rápida
  assert.equal(hashAdminVigente(hash), hash);
  assert.ok(RE_BCRYPT.test(hash));
});

test('hashAdminVigente decodifica un hash bcrypt guardado en base64 (blindaje "Is Literal?" de Coolify)', () => {
  const hash = bcrypt.hashSync('otra-clave', 4);
  const comoBase64 = Buffer.from(hash, 'utf8').toString('base64');
  assert.equal(hashAdminVigente(comoBase64), hash);
});

test('hashAdminVigente con el hash correcto permite que bcrypt.compare valide la contraseña real', async () => {
  const claveReal = 'Y5qc-fgAy-hkK9';
  const hash = bcrypt.hashSync(claveReal, 4);
  const guardadoEnBase64 = Buffer.from(hash, 'utf8').toString('base64');

  const hashResuelto = hashAdminVigente(guardadoEnBase64);
  assert.equal(await bcrypt.compare(claveReal, hashResuelto), true);
  assert.equal(await bcrypt.compare('clave-incorrecta', hashResuelto), false);
});

test('hashAdminVigente no lanza excepción con valores vacíos o basura, y bcrypt.compare simplemente no hace match', async () => {
  for (const raw of ['', undefined, null, 'no-es-ni-hash-ni-base64-valido', '   ']) {
    const resuelto = hashAdminVigente(raw);
    assert.equal(typeof resuelto, 'string');
    // No debe lanzar: cualquier password compara en false, nunca truena.
    assert.equal(await bcrypt.compare('cualquier-cosa', resuelto || 'x'), false);
  }
});

test('hashAdminVigente no confunde un base64 válido cuyo contenido decodificado NO es un hash bcrypt', () => {
  const textoNormal = Buffer.from('esto no es un hash', 'utf8').toString('base64');
  // Como el texto decodificado no matchea RE_BCRYPT, debe devolver el
  // valor crudo (el base64 tal cual), no el texto decodificado a medias.
  assert.equal(hashAdminVigente(textoNormal), textoNormal);
});
