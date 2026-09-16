import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "meal_session";
const SESSION_DURATION = "30d";

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set a long random string in .env",
    );
  }
  return new TextEncoder().encode(value);
}

export interface SessionPayload {
  role: "admin";
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secret());
}

export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    if (payload.role !== "admin") return null;
    return { role: "admin" };
  } catch {
    return null;
  }
}

/**
 * Constant-time PIN check. Both sides are hashed first so the comparison is
 * always between equal-length buffers and cannot leak the PIN's length.
 */
export async function isValidPin(candidate: string): Promise<boolean> {
  const expected = process.env.ADMIN_PIN;
  if (!expected) {
    throw new Error("ADMIN_PIN is not set. Add it to .env");
  }
  if (typeof candidate !== "string" || candidate.length === 0) return false;

  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}
