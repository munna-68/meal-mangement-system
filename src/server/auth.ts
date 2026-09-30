import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { accounts, loginAttempts } from "@/db/schema";
import { verifyPassword } from "@/lib/password";
import {
  SESSION_COOKIE,
  createSessionToken,
  verifySessionToken,
  type AccountRole,
  type SessionUser,
} from "@/lib/session";

/** Failed sign-ins allowed before an account is temporarily locked. */
export const MAX_FAILED_ATTEMPTS = 5;
/** How long an account stays locked after too many failures. */
export const LOCKOUT_MINUTES = 15;

/**
 * A syntactically valid hash used to burn the same scrypt work when the
 * username does not exist, so response time cannot be used to enumerate
 * accounts.
 */
const DUMMY_HASH = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;

const GENERIC_ERROR = "That username or password is not correct.";

async function recordLoginAttempt(
  username: string,
  succeeded: boolean,
  reason: string | null,
): Promise<void> {
  try {
    await db.insert(loginAttempts).values({ username, succeeded, reason });
  } catch {
    // A failed audit write must never block a legitimate sign-in.
  }
}

/** The signed-in account from the cookie, without touching the database. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getSessionUser()) !== null;
}

/**
 * Authoritative gate for pages and actions. `proxy.ts` also blocks
 * unauthenticated requests, but server actions and pages re-check
 * independently because a matcher change must never silently open a hole.
 *
 * The account is re-read from the database on every call, so deactivating
 * somebody takes effect immediately instead of when their cookie expires.
 * Returns the account so callers can attribute the change they are about to
 * make to a real person.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session) redirect("/login");

  const [account] = await db
    .select({
      id: accounts.id,
      username: accounts.username,
      displayName: accounts.displayName,
      role: accounts.role,
      active: accounts.active,
    })
    .from(accounts)
    .where(eq(accounts.id, session.accountId))
    .limit(1);

  if (!account || !account.active) {
    // The cookie is still cryptographically valid, so `proxy.ts` would bounce
    // /login straight back to /today and the user would never reach the sign-in
    // form — an endless redirect. `stale=1` tells proxy the session is dead so
    // it lets the login page through; the cookie is then replaced on sign-in.
    redirect("/login?stale=1");
  }

  return {
    accountId: account.id,
    username: account.username,
    displayName: account.displayName,
    role: account.role as AccountRole,
  };
}

async function startSession(user: SessionUser): Promise<void> {
  const requestHeaders = await headers();
  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const isSecure = forwardedProto === "https";

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export type SignInResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string };

/**
 * Verifies a username and password, applying a per-account lockout after
 * repeated failures. Unknown usernames are answered with the same generic
 * message and the same hashing cost as a wrong password.
 */
export async function signIn(
  usernameInput: string,
  password: string,
): Promise<SignInResult> {
  const username = usernameInput.trim().toLowerCase();
  if (!username || !password) {
    return { ok: false, error: "Enter your username and password." };
  }

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.username, username))
    .limit(1);

  if (!account) {
    await verifyPassword(password, DUMMY_HASH);
    await recordLoginAttempt(username, false, "unknown-account");
    return { ok: false, error: GENERIC_ERROR };
  }

  if (!account.active) {
    await recordLoginAttempt(username, false, "inactive");
    return { ok: false, error: "That account has been deactivated." };
  }

  const now = new Date();
  if (account.lockedUntil && account.lockedUntil.getTime() > now.getTime()) {
    const minutes = Math.ceil(
      (account.lockedUntil.getTime() - now.getTime()) / 60_000,
    );
    await recordLoginAttempt(username, false, "locked");
    return {
      ok: false,
      error: `Too many failed attempts. Try again in ${minutes} minute${
        minutes === 1 ? "" : "s"
      }.`,
    };
  }

  const passwordOk = await verifyPassword(password, account.passwordHash);

  if (!passwordOk) {
    const attempts = account.failedAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;

    await db
      .update(accounts)
      .set({
        failedAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
          : null,
        updatedAt: now,
      })
      .where(eq(accounts.id, account.id));

    await recordLoginAttempt(
      username,
      false,
      shouldLock ? "locked-out" : "bad-password",
    );

    return {
      ok: false,
      error: shouldLock
        ? `Too many failed attempts. This account is locked for ${LOCKOUT_MINUTES} minutes.`
        : GENERIC_ERROR,
    };
  }

  await db
    .update(accounts)
    .set({
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: now,
      updatedAt: now,
    })
    .where(eq(accounts.id, account.id));

  await recordLoginAttempt(username, true, null);

  const user: SessionUser = {
    accountId: account.id,
    username: account.username,
    displayName: account.displayName,
    role: account.role as AccountRole,
  };
  await startSession(user);
  return { ok: true, user };
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
