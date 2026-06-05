import { db } from './connection.js';
import { hashPin } from '../utils/pin.js';

/**
 * Cambia el PIN de un usuario directamente en la base de datos (sin endpoint de registro).
 * Uso:  pnpm db:set-pin <andy|dennis> <nuevo-pin>
 */
const profile = process.argv[2];
const pin = process.argv[3];

if (!profile || !pin) {
  console.error('Uso: pnpm db:set-pin <andy|dennis> <nuevo-pin>');
  process.exit(1);
}

const result = db
  .prepare(`UPDATE users SET pin_hash = ? WHERE profile = ?`)
  .run(hashPin(pin), profile);

if (result.changes === 0) {
  console.error(`❌ No existe el perfil '${profile}'. Ejecuta antes el seed.`);
  process.exit(1);
}

console.log(`✅ PIN actualizado para '${profile}'.`);
