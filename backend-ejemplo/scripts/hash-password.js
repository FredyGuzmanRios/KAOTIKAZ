/* Genera el hash bcrypt para ADMIN_PASSWORD_HASH:
   npm run hash-password -- "TuContraseñaSegura" */
const bcrypt = require('bcryptjs');
const pass = process.argv[2];
if (!pass) { console.error('Uso: npm run hash-password -- "TuContraseña"'); process.exit(1); }
console.log(bcrypt.hashSync(pass, 12));
