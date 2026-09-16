/**
 * Seeds the starting data: mess settings, rooms, members and the first rate
 * card. Safe to run repeatedly — existing rows are left alone.
 *
 *   npm run db:seed
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { currentMonthKey, monthStart } from "../src/lib/dates";
import {
  members,
  messSettings,
  rateCards,
  rooms,
  schema,
} from "../src/db/schema";

config({ path: ".env" });

const DEFAULT_HOSTEL_NAME = "আল্লাহর দান ছাত্রাবাস-২";
const DEFAULT_ADDRESS =
  "আলমপুর (চকবাজার) ক্যাডেট কলেজ, রংপুর সদর, রংপুর";

interface SeedRoom {
  number: string;
  capacity: number;
}

const SEED_ROOMS: SeedRoom[] = [
  { number: "101", capacity: 2 },
  { number: "102", capacity: 2 },
  { number: "103", capacity: 2 },
  { number: "104", capacity: 2 },
  { number: "105", capacity: 2 },
  { number: "106", capacity: 2 },
  { number: "107", capacity: 2 },
  { number: "108", capacity: 2 },
  { number: "109", capacity: 2 },
  { number: "110", capacity: 2 },
  { number: "111", capacity: 2 },
  { number: "112", capacity: 2 },
  { number: "201", capacity: 2 },
  { number: "202", capacity: 2 },
  { number: "203", capacity: 2 },
  { number: "204", capacity: 2 },
  { number: "205", capacity: 2 },
  { number: "206", capacity: 2 },
  { number: "207", capacity: 2 },
  { number: "208", capacity: 2 },
  { number: "209", capacity: 2 },
  { number: "210", capacity: 2 },
  { number: "211", capacity: 2 },
  { number: "212", capacity: 2 },
  { number: "213", capacity: 2 },
  { number: "214", capacity: 2 },
];

interface SeedMember {
  name: string;
  room: string;
  phone?: string;
  bloodGroup?: string;
}

const SEED_MEMBERS: SeedMember[] = [
  { name: "Uzzal", room: "107", phone: "01570210744", bloodGroup: "O+" },
  { name: "Rakib", room: "107", phone: "01711223344", bloodGroup: "B+" },
  { name: "Sabbir", room: "101", phone: "01812334455", bloodGroup: "A+" },
  { name: "Tanvir", room: "101", phone: "01913445566", bloodGroup: "O+" },
  { name: "Hasan", room: "102", bloodGroup: "AB+" },
  { name: "Nayeem", room: "102", phone: "01614556677", bloodGroup: "B+" },
  { name: "Jubayer", room: "103", bloodGroup: "A-" },
  { name: "Shakil", room: "103", phone: "01515667788", bloodGroup: "O-" },
  { name: "Rifat", room: "105", bloodGroup: "B+" },
  { name: "Mahin", room: "201", phone: "01716778899", bloodGroup: "A+" },
  { name: "Sajid", room: "202", bloodGroup: "O+" },
  { name: "Arif", room: "205", phone: "01817889900", bloodGroup: "AB-" },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const isLocal = /(^|@)(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);
  const pool = new Pool({
    connectionString,
    max: 1,
    ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  const db = drizzle(pool, { schema });

  // --- Mess settings (single row) ---
  const existingSettings = await db.select().from(messSettings).limit(1);
  if (existingSettings.length === 0) {
    await db.insert(messSettings).values({
      id: 1,
      hostelName: DEFAULT_HOSTEL_NAME,
      address: DEFAULT_ADDRESS,
      ramadanMode: false,
    });
    console.log("[seed] mess settings created");
  } else {
    console.log("[seed] mess settings already exist");
  }

  // --- Rooms ---
  const roomIdByNumber = new Map<string, string>();
  for (const room of SEED_ROOMS) {
    const existing = await db
      .select()
      .from(rooms)
      .where(eq(rooms.number, room.number))
      .limit(1);
    if (existing.length > 0) {
      roomIdByNumber.set(room.number, existing[0].id);
      continue;
    }
    const [created] = await db
      .insert(rooms)
      .values({ number: room.number, capacity: room.capacity })
      .returning();
    roomIdByNumber.set(room.number, created.id);
  }
  console.log(`[seed] ${SEED_ROOMS.length} rooms ready`);

  // --- Members ---
  const existingMembers = await db.select().from(members);
  const existingNames = new Set(existingMembers.map((m) => m.name));
  let createdCount = 0;
  for (const member of SEED_MEMBERS) {
    if (existingNames.has(member.name)) continue;
    const roomId = roomIdByNumber.get(member.room);
    if (!roomId) continue;
    await db.insert(members).values({
      name: member.name,
      roomId,
      phone: member.phone ?? null,
      bloodGroup: member.bloodGroup ?? null,
      active: true,
      joinDate: monthStart(currentMonthKey()),
    });
    createdCount += 1;
  }
  console.log(`[seed] ${createdCount} members created`);

  // --- First rate card ---
  const existingRates = await db.select().from(rateCards).limit(1);
  if (existingRates.length === 0) {
    await db.insert(rateCards).values({
      label: "Starting defaults",
      effectiveFrom: monthStart(currentMonthKey()),
      effectiveTo: null,
      fullMealRate: 60,
      halfMealRate: 35,
      guestFullRate: 80,
      guestHalfRate: 45,
      sehriRate: 70,
      feastFlatCharge: 200,
      khalaNormalRate: 300,
      khalaSoloRate: 400,
      managerDailyFee: 30,
      dailyExtraAmount: 300,
    });
    console.log("[seed] rate card created");
  } else {
    console.log("[seed] rate card already exists");
  }

  await pool.end();
  console.log("[seed] done");
}

main().catch((error) => {
  console.error("[seed] failed", error);
  process.exit(1);
});
