/**
 * Applies generated Drizzle migrations to DATABASE_URL.
 *
 *   npm run db:migrate
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: ".env" });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);
  const pool = new Pool({
    connectionString,
    max: 1,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });

  const db = drizzle(pool);

  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] migrations applied");

  await pool.end();
}

main().catch((error) => {
  console.error("[migrate] failed", error);
  process.exit(1);
});
