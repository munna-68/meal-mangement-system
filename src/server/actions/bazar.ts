"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  bazarDuties,
  bazarDutyRooms,
  dailyBazarRecords,
  rooms,
} from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { computeDayTotals, rateCardFor } from "@/lib/calc";
import { buildDutyUnits, orderUnitsFrom } from "@/lib/roster";
import {
  addDays,
  isValidDateKey,
  isValidMonthKey,
  monthEnd,
  monthStart,
  todayKey,
} from "@/lib/dates";
import { requireSession } from "@/server/auth";
import {
  ensureAutoExtrasForDate,
  setAutoExtraVoided,
} from "@/server/auto-extras";
import { loadLedgerSnapshot } from "@/server/queries";

const dutySchema = z.object({
  date: z.string().refine(isValidDateKey, "Invalid date"),
  roomIds: z.array(z.string()).max(2, "At most two rooms can share a day"),
  khalaDidShopping: z.boolean().default(false),
  note: z.string().max(500).optional(),
});

export async function saveBazarDuty(
  input: z.infer<typeof dutySchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = dutySchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid duty entry"));
  const { date, roomIds, khalaDidShopping, note } = parsed.data;

  try {
    const [duty] = await db
      .insert(bazarDuties)
      .values({ date, khalaDidShopping, note: note?.trim() || null })
      .onConflictDoUpdate({
        target: bazarDuties.date,
        set: { khalaDidShopping, note: note?.trim() || null },
      })
      .returning();

    await db.delete(bazarDutyRooms).where(eq(bazarDutyRooms.bazarDutyId, duty.id));
    if (roomIds.length > 0) {
      await db
        .insert(bazarDutyRooms)
        .values(roomIds.map((roomId) => ({ bazarDutyId: duty.id, roomId })))
        .onConflictDoNothing();
    }
  } catch (error) {
    return fail(firstIssue(error, "Could not save the duty roster"));
  }

  refresh();
  return ok("Duty saved");
}

export async function deleteBazarDuty(date: string): Promise<ActionResult> {
  await requireSession();
  if (!isValidDateKey(date)) return fail("Invalid date");
  try {
    await db.delete(bazarDuties).where(eq(bazarDuties.date, date));
  } catch (error) {
    return fail(firstIssue(error, "Could not clear the duty"));
  }
  refresh();
  return ok();
}

const rosterSchema = z.object({
  month: z.string().refine(isValidMonthKey, "Invalid month"),
  /** First day of the run; the sequence continues to the end of the month. */
  startDate: z.string().refine(isValidDateKey, "Invalid start date"),
  /** The room whose turn it is on the start date. */
  startRoomId: z.string().min(1, "Pick a starting room"),
});

/**
 * Fills the rest of the month with the duty sequence, starting from a chosen
 * room and date. Everything after the start follows the room order and wraps
 * around, so re-running with a different start date simply rewrites the run.
 */
export async function autoAssignRoster(
  input: z.infer<typeof rosterSchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = rosterSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid roster"));
  const { month, startDate, startRoomId } = parsed.data;

  if (startDate < monthStart(month) || startDate > monthEnd(month)) {
    return fail("The start date must fall inside the month you are filling.");
  }

  try {
    const roomRows = await db
      .select({ id: rooms.id, capacity: rooms.capacity })
      .from(rooms)
      .orderBy(rooms.number);

    if (roomRows.length === 0) return fail("Add some rooms first.");

    const units = buildDutyUnits(roomRows);
    if (units.length === 0) return fail("No rooms can take a duty.");

    const ordered = orderUnitsFrom(units, startRoomId);
    if (!ordered) return fail("That room is not in the rotation.");

    const last = monthEnd(month);
    let cursor = startDate;
    let index = 0;
    let assigned = 0;
    let guard = 0;

    while (cursor <= last && guard < 400) {
      const roomIds = ordered[index % ordered.length];

      const [duty] = await db
        .insert(bazarDuties)
        .values({ date: cursor })
        .onConflictDoUpdate({ target: bazarDuties.date, set: { date: cursor } })
        .returning();

      await db
        .delete(bazarDutyRooms)
        .where(eq(bazarDutyRooms.bazarDutyId, duty.id));
      await db
        .insert(bazarDutyRooms)
        .values(roomIds.map((roomId) => ({ bazarDutyId: duty.id, roomId })))
        .onConflictDoNothing();

      assigned += 1;
      index += 1;
      cursor = addDays(cursor, 1);
      guard += 1;
    }

    refresh();
    return ok(`Assigned ${assigned} days`);
  } catch (error) {
    return fail(firstIssue(error, "Could not build the roster"));
  }
}

const swapSchema = z.object({
  dateA: z.string().refine(isValidDateKey, "Invalid date"),
  dateB: z.string().refine(isValidDateKey, "Invalid date"),
});

/** Exchanges the rooms assigned to two days, leaving notes and Khala days alone. */
export async function swapDutyDays(
  input: z.infer<typeof swapSchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = swapSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid swap"));
  const { dateA, dateB } = parsed.data;
  if (dateA === dateB) return ok("Nothing to swap");

  try {
    const [dutyA] = await db
      .select()
      .from(bazarDuties)
      .where(eq(bazarDuties.date, dateA))
      .limit(1);
    const [dutyB] = await db
      .select()
      .from(bazarDuties)
      .where(eq(bazarDuties.date, dateB))
      .limit(1);

    const roomsOf = async (dutyId: string) => {
      const rows = await db
        .select({ roomId: bazarDutyRooms.roomId })
        .from(bazarDutyRooms)
        .where(eq(bazarDutyRooms.bazarDutyId, dutyId));
      return rows.map((row) => row.roomId);
    };

    const roomsA = dutyA ? await roomsOf(dutyA.id) : [];
    const roomsB = dutyB ? await roomsOf(dutyB.id) : [];

    const writeRooms = async (date: string, roomIds: string[]) => {
      const [duty] = await db
        .insert(bazarDuties)
        .values({ date })
        .onConflictDoUpdate({ target: bazarDuties.date, set: { date } })
        .returning();
      await db
        .delete(bazarDutyRooms)
        .where(eq(bazarDutyRooms.bazarDutyId, duty.id));
      if (roomIds.length > 0) {
        await db
          .insert(bazarDutyRooms)
          .values(roomIds.map((roomId) => ({ bazarDutyId: duty.id, roomId })))
          .onConflictDoNothing();
      }
    };

    await writeRooms(dateA, roomsB);
    await writeRooms(dateB, roomsA);

    refresh();
    return ok("Duty swapped");
  } catch (error) {
    return fail(firstIssue(error, "Could not swap the duty"));
  }
}

const bazarRecordSchema = z.object({
  date: z.string().refine(isValidDateKey, "Invalid date"),
  deductionAmount: z.coerce.number().int().min(0).default(0),
  deductionReason: z.string().max(300).optional(),
  advanceGiven: z.coerce.number().int().min(0).default(0),
  actualExpense: z.coerce.number().int().min(0).default(0),
  changeReturned: z.coerce.number().int().optional(),
  menuNight: z.string().max(300).optional(),
  menuMorning: z.string().max(300).optional(),
  menuNoon: z.string().max(300).optional(),
});

/**
 * Records the day's cash movements and stores a snapshot of the computed
 * totals. The deduction is the only field that feeds back into the budget, and
 * it always needs a reason.
 */
export async function saveBazarRecord(
  input: z.infer<typeof bazarRecordSchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = bazarRecordSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error, "Invalid bazar record"));
  }
  const data = parsed.data;

  if (data.deductionAmount > 0 && !data.deductionReason?.trim()) {
    return fail("A deduction needs a reason so members can see why it was taken.");
  }
  if (data.date > todayKey()) {
    return fail("You cannot record a bazar for a future date.");
  }

  try {
    const snapshot = await loadLedgerSnapshot();
    const totals = computeDayTotals({
      date: data.date,
      members: snapshot.members,
      changes: snapshot.changes,
      guestMeals: snapshot.guestMeals,
      extras: snapshot.extras,
      rateCard: rateCardFor(snapshot.rateCards, data.date),
      deductionAmount: data.deductionAmount,
      ramadanMode: snapshot.settings.ramadanMode,
      today: snapshot.today,
    });

    const changeReturned =
      data.changeReturned ?? data.advanceGiven - data.actualExpense;

    const values = {
      date: data.date,
      fullMealCount: totals.fullCount,
      fullMealAmount: totals.fullAmount,
      halfMealCount: totals.halfCount,
      halfMealAmount: totals.halfAmount,
      guestFullCount: totals.guestFullCount,
      guestFullAmount: totals.guestFullAmount,
      guestHalfCount: totals.guestHalfCount,
      guestHalfAmount: totals.guestHalfAmount,
      extraAmount: totals.extraAmount,
      totalBudget: totals.totalBudget,
      deductionAmount: data.deductionAmount,
      deductionReason: data.deductionReason?.trim() || null,
      advanceGiven: data.advanceGiven,
      actualExpense: data.actualExpense,
      changeReturned,
      menuNight: data.menuNight?.trim() || null,
      menuMorning: data.menuMorning?.trim() || null,
      menuNoon: data.menuNoon?.trim() || null,
      updatedAt: new Date(),
    };

    await db
      .insert(dailyBazarRecords)
      .values(values)
      .onConflictDoUpdate({ target: dailyBazarRecords.date, set: values });

    // Confirming the bazar is what registers that day's recurring costs, so the
    // record must exist before the generator looks for it.
    await ensureAutoExtrasForDate(data.date);
  } catch (error) {
    return fail(firstIssue(error, "Could not save the bazar record"));
  }

  refresh();
  return ok("Bazar confirmed");
}

export async function saveBazarRecordForm(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const str = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : undefined;
  };
  const num = (key: string) => {
    const value = str(key);
    if (value === undefined || value.trim() === "") return undefined;
    return Number(value);
  };

  return saveBazarRecord({
    date: str("date") ?? "",
    deductionAmount: num("deductionAmount") ?? 0,
    deductionReason: str("deductionReason"),
    advanceGiven: num("advanceGiven") ?? 0,
    actualExpense: num("actualExpense") ?? 0,
    changeReturned: num("changeReturned"),
    menuNight: str("menuNight"),
    menuMorning: str("menuMorning"),
    menuNoon: str("menuNoon"),
  });
}

/** Turns the recurring daily Extra or the manager's fee off for a single day. */
export async function toggleAutoExtra(input: {
  date: string;
  kind: "daily-extra" | "manager-fee";
  voided: boolean;
}): Promise<ActionResult> {
  await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");

  const sourceKey =
    input.kind === "daily-extra"
      ? `auto:daily-extra:${input.date}`
      : `auto:manager-fee:${input.date}`;

  try {
    await ensureAutoExtrasForDate(input.date);
    await setAutoExtraVoided(input.date, sourceKey, input.voided);
  } catch (error) {
    return fail(firstIssue(error, "Could not update the recurring extra"));
  }

  refresh();
  return ok(
    input.voided
      ? "Turned off for this day"
      : "Turned back on for this day",
  );
}
