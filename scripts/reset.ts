/**
 * Truncates every application table. Destructive; local development only.
 *
 *   npm run db:reset
 */
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

config({ path: ".env" });

const TABLES = [
  "monthly_settlements",
  "month_closes",
  "deposits",
  "utility_bills",
  "extra_line_items",
  "daily_bazar_records",
  "bazar_duty_rooms",
  "bazar_duties",
  "guest_meals",
  "meal_status_changes",
  "rate_cards",
  "members",
  "rooms",
  "mess_settings",
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);
  if (!isLocal) {
    throw new Error(
      "Refusing to reset a non-local database. DATABASE_URL is not localhost.",
    );
  }

  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool);

  await db.execute(
    sql.raw(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`),
  );

  console.log(`[reset] truncated ${TABLES.length} tables`);
  await pool.end();
}

main().catch((error) => {
  console.error("[reset] failed", error);
  process.exit(1);
});
