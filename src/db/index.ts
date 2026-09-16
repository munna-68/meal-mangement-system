import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { schema } from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in.",
  );
}

const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);

function createPool() {
  return new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    // Managed Postgres (Neon, Supabase) terminates TLS with a certificate we
    // do not pin here, so accept it without pinning while still using TLS.
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });
}

const globalForDb = globalThis as unknown as {
  __mealMessPool?: Pool;
};

const pool = globalForDb.__mealMessPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__mealMessPool = pool;
}

export const db = drizzle(pool, { schema });

export type Database = typeof db;
export { pool };
