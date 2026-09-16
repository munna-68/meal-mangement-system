import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  SESSION_COOKIE,
  createSessionToken,
  isValidPin,
  verifySessionToken,
} from "@/lib/session";

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  return session !== null;
}

/**
 * Authoritative gate for pages. `proxy.ts` also blocks unauthenticated
 * requests, but server actions and pages re-check independently because a
 * matcher change must never silently open a hole.
 */
export async function requireSession(): Promise<void> {
  if (!(await isAuthenticated())) {
    redirect("/login");
  }
}

export async function signIn(pin: string): Promise<boolean> {
  if (!(await validatePin(pin))) return false;

  const requestHeaders = await headers();
  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const isSecure = forwardedProto === "https";

  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return true;
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
