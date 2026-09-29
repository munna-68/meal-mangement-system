import { jwtVerify, SignJWT } from "jose";

import { assertSecureEnvironment, warnAboutRetiredEnv } from "./env-guard";

export const SESSION_COOKIE = "meal_session";
const SESSION_DURATION = "30d";

export type AccountRole = "OWNER" | "MANAGER";

/** The signed-in person, as carried in the session cookie. */
export interface SessionUser {
  accountId: string;
  username: string;
  displayName: string;
  role: AccountRole;
}

let warnedAboutRetiredEnv = false;

function secret(): Uint8Array {
  assertSecureEnvironment();
  if (!warnedAboutRetiredEnv) {
    warnAboutRetiredEnv();
    warnedAboutRetiredEnv = true;
  }
  return new TextEncoder().encode(process.env.SESSION_SECRET!);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    sub: user.accountId,
    username: user.username,
    name: user.displayName,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secret());
}

/**
 * Verifies the session cookie. Only the identity is read from the token; every
 * action re-checks the account against the database, so deactivating an account
 * takes effect immediately rather than when its cookie expires.
 */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });

    const accountId = typeof payload.sub === "string" ? payload.sub : null;
    const username =
      typeof payload.username === "string" ? payload.username : null;
    const displayName = typeof payload.name === "string" ? payload.name : null;
    const role = payload.role;

    if (!accountId || !username || !displayName) return null;
    if (role !== "OWNER" && role !== "MANAGER") return null;

    return { accountId, username, displayName, role };
  } catch {
    return null;
  }
}
