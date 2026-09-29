/**
 * Password strength policy.
 *
 * Kept separate from `password.ts` so client components can import the rules
 * without pulling Node's `crypto` into the browser bundle.
 */

/** Passwords that must never protect a money-handling account. */
export const KNOWN_WEAK_PASSWORDS = new Set([
  "admin",
  "admin123",
  "administrator",
  "password",
  "passw0rd",
  "changeme",
  "change-me",
  "letmein",
  "welcome",
  "1234",
  "12345",
  "123456",
  "1234567",
  "12345678",
  "0000",
  "1111",
  "qwerty",
  "hostel",
  "mess",
]);

export const MIN_PASSWORD_LENGTH = 8;

/** Why a password is unacceptable, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (KNOWN_WEAK_PASSWORDS.has(password.trim().toLowerCase())) {
    return "That password is a well-known default. Pick something else.";
  }
  if (/^(.)\1+$/.test(password)) {
    return "That password is a single repeated character.";
  }
  return null;
}

export function isWeakPassword(password: string): boolean {
  return passwordProblem(password) !== null;
}

/** Throws with a clear message when a password is not fit for production. */
export function assertStrongPassword(password: string, context: string): void {
  const problem = passwordProblem(password);
  if (problem) {
    throw new Error(`${context}: ${problem}`);
  }
}
