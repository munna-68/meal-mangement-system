/**
 * Production bootstrap: creates ONLY the things you need before the first real
 * sign-in, and nothing else.
 *
 *   DATABASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... npx tsx scripts/create-owner.ts
 *
 * Creates:
 *   - the first OWNER account (refuses if any account already exists)
 *   - the single mess settings row, if it is missing
 *   - the first rate card, if none exists — without one every amount prices at
 *     zero, so this is not optional
 *
 * It deliberately creates NO rooms and NO members. `npm run db:seed` inserts 26
 * demo rooms and 12 demo people, which is right for trying the app out and
 * wrong for a live mess; add the real rooms and members in the app instead.
 *
 * Safe to run twice: everything is skipped when it already exists.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { currentMonthKey, monthStart } from "../src/lib/dates";
import { assertStrongPassword, hashPassword } from "../src/lib/password";
import {
  accounts,
  messSettings,
  rateCards,
  schema,
} from "../src/db/schema";

config({ path: ".env" });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the production database before " +
        "running this: DATABASE_URL='postgresql://...' npx tsx scripts/create-owner.ts",
    );
  }

  const username = (process.env.ADMIN_USERNAME?.trim() || "").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const displayName = process.env.ADMIN_DISPLAY_NAME?.trim() || "Mess Owner";

  if (!username) {
    throw new Error("ADMIN_USERNAME is not set.");
  }
  if (!password) {
    throw new Error(
      "ADMIN_PASSWORD is not set. There is no default password — the app " +
        "cannot be signed into until you choose one.",
    );
  }
  // Hard failure, in every environment: a weak first password is exactly the
  // hole the accounts replaced the old shared PIN to close.
  assertStrongPassword(password, `ADMIN_PASSWORD for "${username}"`);

  const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);
  const pool = new Pool({
    connectionString,
    max: 1,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  const db = drizzle(pool, { schema });

  try {
    const existingAccounts = await db.select({ id: accounts.id }).from(accounts);
    if (existingAccounts.length > 0) {
      console.log(
        "[create-owner] an account already exists — nothing to do. Sign in with it.",
      );
    } else {
      await db.insert(accounts).values({
        username,
        displayName,
        role: "OWNER",
        passwordHash: await hashPassword(password),
      });
      console.log(`[create-owner] owner account "${username}" created`);
    }

    const [existingSettings] = await db.select().from(messSettings).limit(1);
    if (existingSettings) {
      console.log("[create-owner] mess settings already exist");
    } else {
      await db.insert(messSettings).values({
        id: 1,
        hostelName: process.env.MESS_NAME?.trim() || "My Mess",
        address: process.env.MESS_ADDRESS?.trim() || "",
        ramadanMode: false,
      });
      console.log("[create-owner] mess settings created — set the real name in Settings");
    }

    const [existingRateCard] = await db.select().from(rateCards).limit(1);
    if (existingRateCard) {
      console.log("[create-owner] a rate card already exists");
    } else {
      await db.insert(rateCards).values({
        label: "Starting rates",
        effectiveFrom: monthStart(currentMonthKey()),
        effectiveTo: null,
        fullMealRate: 60,
        halfMealRate: 35,
        guestFullRate: 75,
        guestHalfRate: 40,
        sehriRate: 70,
        feastFlatCharge: 200,
        khalaNormalRate: 300,
        khalaSoloRate: 400,
        managerDailyFee: 30,
        dailyExtraAmount: 300,
      });
      console.log(
        "[create-owner] first rate card created — check every rate on the Rates page",
      );
    }

    console.log("\n[create-owner] done. Sign in at /login with that username.");
    console.log("[create-owner] no rooms or members were created — add them in the app.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[create-owner] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});