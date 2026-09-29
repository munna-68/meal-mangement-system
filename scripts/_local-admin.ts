/**
 * TEMPORARY local-testing helper: force the owner account to admin/admin.
 * Bypasses the password policy on purpose. Do NOT ship this. Delete after use.
 *
 *   npx tsx scripts/_local-admin.ts
 *
 * Goes through the wire protocol on purpose. `.pglite` is served by
 * `npm run db:dev`, and PGlite allows only one instance per data directory —
 * opening the directory directly writes to a copy the live server never sees.
 */
import { config } from "dotenv";
import { Pool } from "pg";

import { hashPassword } from "../src/lib/password";

config({ path: ".env" });

const USERNAME = "admin";
const PASSWORD = "admin";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set in .env");

  const pool = new Pool({ connectionString });
  const passwordHash = await hashPassword(PASSWORD);

  const existing = await pool.query<{ id: string; role: string }>(
    `select id, role from accounts where username = $1`,
    [USERNAME],
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0]!;
    await pool.query(
      `update accounts
          set password_hash = $2, active = true, failed_attempts = 0,
              locked_until = null, updated_at = now()
        where id = $1`,
      [row.id, passwordHash],
    );
    console.log(`[local-admin] password reset for "${USERNAME}" (${row.role})`);
  } else {
    await pool.query(
      `insert into accounts (id, username, display_name, role, password_hash,
                             active, failed_attempts, created_at, updated_at)
       values (gen_random_uuid(), $1, 'Mess Owner', 'OWNER', $2, true, 0, now(), now())`,
      [USERNAME, passwordHash],
    );
    console.log(`[local-admin] owner account "${USERNAME}" created`);
  }

  await pool.query(`delete from login_attempts`);
  console.log("[local-admin] login attempt history cleared");

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
