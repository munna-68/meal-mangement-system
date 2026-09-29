/**
 * Startup guards for values that must not reach production unchanged.
 *
 * The app used to be protected by a single shared `ADMIN_PIN` that shipped as
 * `"admin"`. Accounts now carry real passwords, so the equivalent risks are a
 * placeholder session secret and a seeded account still using a default
 * password. These checks fail loudly rather than letting a weak deployment look
 * healthy.
 */

/** The value committed in `.env.example`. Never valid in production. */
export const EXAMPLE_SESSION_SECRET = "change-me-to-a-long-random-string";

const MIN_SECRET_LENGTH = 32;

/**
 * Validates the session secret. Called from `session.ts` on every auth
 * operation, so a misconfigured production deploy fails at the first request
 * instead of silently signing tokens with a guessable key.
 */
export function assertSecureEnvironment(): void {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set a long random string in .env",
    );
  }

  if (process.env.NODE_ENV !== "production") return;

  if (secret === EXAMPLE_SESSION_SECRET) {
    throw new Error(
      "SESSION_SECRET is still the example value from .env.example. Generate a " +
        'real one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    console.warn(
      `[security] SESSION_SECRET is only ${secret.length} characters. ` +
        `Use at least ${MIN_SECRET_LENGTH} in production.`,
    );
  }
}

/**
 * Warns when the retired `ADMIN_PIN` variable is still present, so an upgrade
 * does not leave a dead credential lying around in the environment.
 */
export function warnAboutRetiredEnv(): void {
  if (process.env.ADMIN_PIN) {
    console.warn(
      "[security] ADMIN_PIN is still set but is no longer used. Accounts now " +
        "sign in with a username and password — remove ADMIN_PIN from the " +
        "environment so it cannot be mistaken for a working credential.",
    );
  }
}
