import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hashing del PIN con scrypt (incluido en Node, sin dependencias nativas extra).
 * Formato almacenado: `scrypt$<salt_hex>$<hash_hex>`. El PIN NUNCA se guarda en claro.
 */
const KEYLEN = 64;

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(pin, salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/** Verifica un PIN contra su hash almacenado, en tiempo constante. */
export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'hex');
  const derived = scryptSync(pin, salt, KEYLEN);
  if (expected.length !== derived.length) return false;

  return timingSafeEqual(expected, derived);
}
