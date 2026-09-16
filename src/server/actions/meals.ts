"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { guestMeals, mealStatusChanges, members } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { statusOnDate, type MealStatus } from "@/lib/calc";
import { isValidDateKey } from "@/lib/dates";
import { requireSession } from "@/server/auth";
import { getStatusChanges } from "@/server/queries";

const statusSchema = z.object({
  memberId: z.string().min(1),
  date: z.string().refine(isValidDateKey, "Invalid date"),
  status: z.enum(["FULL", "HALF_DAY", "HALF_NIGHT", "OFF"]),
});

/**
 * Records a *change*: the status applies from this date forward until the next
 * change. Sending the same value again is a no-op for history but keeps the row
 * idempotent.
 */
export async function setMealStatus(input: z.infer<typeof statusSchema>): Promise<ActionResult> {
  await requireSession();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error, "Invalid meal status update"));
  }
  const { memberId, date, status } = parsed.data;

  try {
    // Preserve the existing sehri flag for this day when changing the status.
    const rows = await db
      .select({ sehri: mealStatusChanges.sehri })
      .from(mealStatusChanges)
      .where(and(eq(mealStatusChanges.memberId, memberId), eq(mealStatusChanges.date, date)))
      .limit(1);
    const sehri = rows[0]?.sehri ?? false;

    await db
      .insert(mealStatusChanges)
      .values({ memberId, date, status, sehri })
      .onConflictDoUpdate({
        target: [mealStatusChanges.memberId, mealStatusChanges.date],
        set: { status },
      });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the meal status"));
  }

  refresh();
  return ok();
}

export async function setSehri(input: {
  memberId: string;
  date: string;
  sehri: boolean;
}): Promise<ActionResult> {
  await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");

  try {
    const changes = await getStatusChanges();
    const current = statusOnDate(changes, input.memberId, input.date);
    await db
      .insert(mealStatusChanges)
      .values({
        memberId: input.memberId,
        date: input.date,
        status: current.status,
        sehri: input.sehri,
      })
      .onConflictDoUpdate({
        target: [mealStatusChanges.memberId, mealStatusChanges.date],
        set: { sehri: input.sehri },
      });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the Sehri mark"));
  }

  refresh();
  return ok();
}

const guestSchema = z.object({
  memberId: z.string().min(1),
  date: z.string().refine(isValidDateKey, "Invalid date"),
  type: z.enum(["GUEST_FULL", "GUEST_HALF"]),
  count: z.coerce.number().int().min(0).max(20),
});

/** A guest meal is an add-on; it never touches the host's own status. */
export async function setGuestMeal(input: z.infer<typeof guestSchema>): Promise<ActionResult> {
  await requireSession();
  const parsed = guestSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error, "Invalid guest meal"));
  }
  const { memberId, date, type, count } = parsed.data;

  try {
    if (count <= 0) {
      await db
        .delete(guestMeals)
        .where(
          and(
            eq(guestMeals.memberId, memberId),
            eq(guestMeals.date, date),
            eq(guestMeals.type, type),
          ),
        );
    } else {
      await db
        .insert(guestMeals)
        .values({ memberId, date, type, count })
        .onConflictDoUpdate({
          target: [guestMeals.memberId, guestMeals.date, guestMeals.type],
          set: { count },
        });
    }
  } catch (error) {
    return fail(firstIssue(error, "Could not save the guest meal"));
  }

  refresh();
  return ok();
}

export async function clearGuestMeals(input: {
  memberId: string;
  date: string;
}): Promise<ActionResult> {
  await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");
  try {
    await db
      .delete(guestMeals)
      .where(
        and(eq(guestMeals.memberId, input.memberId), eq(guestMeals.date, input.date)),
      );
  } catch (error) {
    return fail(firstIssue(error, "Could not clear the guest meals"));
  }
  refresh();
  return ok();
}

/** Bulk helper: sets the same status for every listed member on one date. */
export async function setMealStatusForMembers(input: {
  memberIds: string[];
  date: string;
  status: MealStatus;
}): Promise<ActionResult> {
  await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");
  if (input.memberIds.length === 0) return ok();

  try {
    const existing = await db
      .select({
        memberId: mealStatusChanges.memberId,
        sehri: mealStatusChanges.sehri,
      })
      .from(mealStatusChanges)
      .where(
        and(
          eq(mealStatusChanges.date, input.date),
          inArray(mealStatusChanges.memberId, input.memberIds),
        ),
      );
    const sehriByMember = new Map(existing.map((row) => [row.memberId, row.sehri]));

    await db
      .insert(mealStatusChanges)
      .values(
        input.memberIds.map((memberId) => ({
          memberId,
          date: input.date,
          status: input.status,
          sehri: sehriByMember.get(memberId) ?? false,
        })),
      )
      .onConflictDoUpdate({
        target: [mealStatusChanges.memberId, mealStatusChanges.date],
        set: { status: input.status },
      });
  } catch (error) {
    return fail(firstIssue(error, "Could not apply the status to everyone"));
  }

  refresh();
  return ok();
}

export async function resetDayToDefault(input: { date: string }): Promise<ActionResult> {
  await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");
  try {
    await db.delete(mealStatusChanges).where(eq(mealStatusChanges.date, input.date));
    const active = await db.select({ id: members.id }).from(members).where(eq(members.active, true));
    if (active.length > 0) {
      await db.insert(mealStatusChanges).values(
        active.map((member) => ({
          memberId: member.id,
          date: input.date,
          status: "FULL" as MealStatus,
          sehri: false,
        })),
      );
    }
  } catch (error) {
    return fail(firstIssue(error, "Could not reset the day"));
  }
  refresh();
  return ok();
}
