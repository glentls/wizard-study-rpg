import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export const newId = (): string => randomUUID();

/** Opaque bearer tokens: 256 random bits, only their SHA-256 hash is stored. */
export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Stable pseudonym for analytics so raw account IDs never reach the event store. */
export const pseudonymize = (secret: string, accountId: string): string =>
  createHmac('sha256', secret).update(accountId).digest('hex').slice(0, 24);

export const hashRequest = (body: unknown): string =>
  createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
