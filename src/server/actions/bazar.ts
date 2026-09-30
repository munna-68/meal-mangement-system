"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  bazarDuties,
  bazarDutyRooms,
  dailyBazarRecords,
  extraLineItems,
  members,
  rooms,
} from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { computeDayTotals, rateCardFor } from "@/lib/calc";
import { formatTaka } from "@/lib/money";
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
import { recordAudit } from "@/server/audit";
import {
  autoExtraRowsFor,
  dailyExtraSourceKey,
  insertAutoExtraRows,
  managerFeeSourceKey,
  pendingAutoExtraRows,
  setAutoExtraVoided,
} from "@/server/auto-extras";
import { monthLockError } from "@/server/month-lock";
import { getRateCards, loadLedgerSnapshot } from "@/server/queries";

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
    // Only rooms that somebody actually lives in take a turn. An empty room in
    // the rotation means a day of shopping is assigned to nobody.
    const occupiedRooms = await db
      .selectDistinct({ id: rooms.id, capacity: rooms.capacity, number: rooms.number })
      .from(rooms)
      .innerJoin(members, eq(members.roomId, rooms.id))
      .orderBy(rooms.number);

    if (occupiedRooms.length === 0) return fail("Add some members first.");

    const units = buildDutyUnits(occupiedRooms);
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
  menuNight: z.string().max(300).optional(),
  menuMorning: z.string().max(300).optional(),
  menuNoon: z.string().max(300).optional(),
});

/**
 * Records the day's cash movements and stores a snapshot of the computed
 * totals. The deduction is the only field that feeds back into the budget, and
 * it always needs a reason.
 *
 * The recurring daily Extra and the manager's fee are written in the same
 * transaction as the record, *and* are included in the total, so the stored
 * record and the printed slip always agree — on the first save as well as on
 * later edits.
 */
export async function saveBazarRecord(
  input: z.infer<typeof bazarRecordSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
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

  const locked = await monthLockError([data.date]);
  if (locked) return fail(locked);

  try {
    const snapshot = await loadLedgerSnapshot();
    const rateCard = rateCardFor(snapshot.rateCards, data.date);

    // The recurring rows this day should carry, minus any that already exist.
    // They are merged into the engine's input *before* the total is computed,
    // so the saved figure already includes them on the very first save.
    const pendingAutoRows = pendingAutoExtraRows(
      data.date,
      rateCard,
      snapshot.extras.map((item) => item.sourceKey),
    );

    const totals = computeDayTotals({
      date: data.date,
      members: snapshot.members,
      changes: snapshot.changes,
      guestMeals: snapshot.guestMeals,
      extras: [...snapshot.extras, ...pendingAutoRows],
      rateCard,
      deductionAmount: data.deductionAmount,
      ramadanMode: snapshot.settings.ramadanMode,
      today: snapshot.today,
    });

    const actualExpense = totals.totalBudget;
    const changeReturned = data.advanceGiven - actualExpense;

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
      actualExpense,
      changeReturned,
      menuNight: data.menuNight?.trim() || null,
      menuMorning: data.menuMorning?.trim() || null,
      menuNoon: data.menuNoon?.trim() || null,
      updatedAt: new Date(),
    };

    // One transaction: the recurring rows and the record that owns them land
    // together. A failure can neither leave a confirmed day with no recurring
    // costs, nor leave recurring costs attached to a day nobody confirmed.
    await db.transaction(async (tx) => {
      await insertAutoExtraRows(pendingAutoRows, tx);
      await tx
        .insert(dailyBazarRecords)
        .values(values)
        .onConflictDoUpdate({ target: dailyBazarRecords.date, set: values });

      await recordAudit(
        {
          actor,
          action: "bazar.confirm",
          entityType: "bazar_day",
          entityId: data.date,
          summary:
            `Confirmed the bazar for ${data.date} — budget ${formatTaka(
              totals.totalBudget,
            )}` +
            (data.deductionAmount > 0
              ? `, deduction ${formatTaka(data.deductionAmount)} (${data.deductionReason?.trim()})`
              : ""),
          detail: {
            date: data.date,
            totalBudget: totals.totalBudget,
            deductionAmount: data.deductionAmount,
            deductionReason: data.deductionReason?.trim() ?? null,
            extraAmount: totals.extraAmount,
            advanceGiven: data.advanceGiven,
            actualExpense,
            changeReturned,
            autoRowsCreated: pendingAutoRows.length,
          },
        },
        tx,
      );
    });
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
    menuNight: str("menuNight"),
    menuMorning: str("menuMorning"),
    menuNoon: str("menuNoon"),
  });
}

/**
 * Undoes a confirmation: the day stops being a bazar day.
 *
 * The record is deleted and the recurring daily Extra and manager's fee that
 * were generated for it are deleted with it, so the day stops counting towards
 * "meal days ran" and its costs leave the month pool. Refused once the month is
 * closed, like every other write.
 */
export async function unconfirmBazarDay(date: string): Promise<ActionResult> {
  const actor = await requireSession();
  if (!isValidDateKey(date)) return fail("Invalid date");

  const locked = await monthLockError([date]);
  if (locked) return fail(locked);

  try {
    const removed = await db.transaction(async (tx) => {
      const [record] = await tx
        .select({ totalBudget: dailyBazarRecords.totalBudget })
        .from(dailyBazarRecords)
        .where(eq(dailyBazarRecords.date, date))
        .limit(1);
      if (!record) return null;

      await tx.delete(dailyBazarRecords).where(eq(dailyBazarRecords.date, date));
      // Only the auto-generated rows for this day; anything a manager entered by
      // hand stays exactly where it is.
      const deletedRows = await tx
        .delete(extraLineItems)
        .where(
          and(
            eq(extraLineItems.date, date),
            eq(extraLineItems.isAuto, true),
          ),
        )
        .returning({ id: extraLineItems.id, label: extraLineItems.label });

      await recordAudit(
        {
          actor,
          action: "bazar.unconfirm",
          entityType: "bazar_day",
          entityId: date,
          summary: `Un-confirmed the bazar for ${date} — removed the record and ${
            deletedRows.length
          } recurring cost row${deletedRows.length === 1 ? "" : "s"}`,
          detail: {
            date,
            totalBudget: record.totalBudget,
            removedRecurringRows: deletedRows.map((row) => row.label),
          },
        },
        tx,
      );
      return record;
    });

    if (!removed) return fail("That day has no confirmed bazar to remove.");
  } catch (error) {
    return fail(firstIssue(error, "Could not un-confirm the bazar day"));
  }

  refresh();
  return ok(`${date} is no longer a bazar day`);
}

/** Turns the recurring daily Extra or the manager's fee off for a single day. */
export async function toggleAutoExtra(input: {
  date: string;
  kind: "daily-extra" | "manager-fee";
  voided: boolean;
}): Promise<ActionResult> {
  const actor = await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");

  const locked = await monthLockError([input.date]);
  if (locked) return fail(locked);

  const sourceKey =
    input.kind === "daily-extra"
      ? dailyExtraSourceKey(input.date)
      : managerFeeSourceKey(input.date);
  const label =
    input.kind === "daily-extra" ? "Daily recurring Extra" : "Manager's daily fee";

  try {
    const cards = await getRateCards();
    await db.transaction(async (tx) => {
      // The row must exist before it can be voided, and it has to be created
      // inside the same transaction so a failure cannot leave a stray cost.
      await insertAutoExtraRows(
        autoExtraRowsFor(input.date, rateCardFor(cards, input.date)),
        tx,
      );
      await setAutoExtraVoided(input.date, sourceKey, input.voided, tx);

      await recordAudit(
        {
          actor,
          action: input.voided ? "extra.void" : "extra.unvoid",
          entityType: "extra",
          entityId: sourceKey,
          summary: `${input.voided ? "Turned off" : "Turned back on"} the ${label} for ${
            input.date
          }`,
          detail: { date: input.date, kind: input.kind, voided: input.voided },
        },
        tx,
      );
    });
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
