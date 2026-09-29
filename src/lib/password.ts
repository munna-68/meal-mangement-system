/**
 * Password hashing for manager accounts.
 *
 * Uses Node's built-in scrypt rather than a native bcrypt/argon2 dependency, so
 * there is nothing to compile and no extra supply-chain surface. Hashes are
 * stored as `scrypt:<salt>:<hash>` so the scheme can be changed later without
 * guessing at the old format.
 *
 * This module imports `node:crypto`, so it is server-only. Client components
 * that need the strength rules import `./password-policy` instead.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export * from "./password-policy";

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCHEME = "scrypt";

function derive(password: string, salt: string, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = await derive(password, salt, KEY_LENGTH);
  return `${SCHEME}:${salt}:${derived.toString("hex")}`;
}

/**
 * Constant-time comparison of a candidate password against a stored hash.
 * Returns false for anything malformed rather than throwing, so a corrupt row
 * cannot lock the whole app out with a crash.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== SCHEME || !salt || !hash) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hash, "hex");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const actual = await derive(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}
