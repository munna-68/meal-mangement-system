import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema } from "./schema";

const globalForDb = globalThis as unknown as {
  __mealMessPool?: Pool;
  __mealMessDb?: ReturnType<typeof drizzle<typeof schema>>;
};

/**
 * The pool is created on first use, not at import time. `next build` imports
 * every route module to collect page data, and that has to work on a machine
 * with no `DATABASE_URL` and no database at all; the old eager throw failed
 * the whole deploy with "DATABASE_URL is not set" before a single request was
 * served. A missing variable now surfaces on the first real query instead,
 * which is also where it is actionable.
 */
function getPool(): Pool {
  const cached = globalForDb.__mealMessPool;
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Set it in .env locally, and in the project " +
        "environment variables on Vercel.",
    );
  }

  const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);

  const created = new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    // Managed Postgres (Neon, Supabase) terminates TLS with a certificate we
    // do not pin here, so accept it without pinning while still using TLS.
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__mealMessPool = created;
  }

  return created;
}

function getDb() {
  const cached = globalForDb.__mealMessDb;
  if (cached) return cached;

  const created = drizzle(getPool(), { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__mealMessDb = created;
  }

  return created;
}

/**
 * Forwards every property access to the real object, created on first touch.
 * Methods are bound to the real target so drizzle's internal `this` survives.
 */
function lazy<T extends object>(load: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const resolved = load() as Record<string | symbol, unknown>;
      const value = Reflect.get(resolved, property);
      return typeof value === "function" ? value.bind(resolved) : value;
    },
  });
}

export const db = lazy(getDb);

export type Database = ReturnType<typeof getDb>;

/**
 * A database handle that may be the pool or an open transaction. Helpers take
 * this so they can join a caller's transaction and stay atomic with it.
 */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Tx;

export const pool = lazy(getPool);
