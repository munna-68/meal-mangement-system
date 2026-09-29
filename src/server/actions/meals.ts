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
import { recordAudit } from "@/server/audit";
import { monthLockError } from "@/server/month-lock";
import { getMemberNames, getStatusChanges } from "@/server/queries";

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
  const actor = await requireSession();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error, "Invalid meal status update"));
  }
  const { memberId, date, status } = parsed.data;

  const locked = await monthLockError([date]);
  if (locked) return fail(locked);

  try {
    // Preserve the existing sehri flag for this day when changing the status.
    const rows = await db
      .select({ sehri: mealStatusChanges.sehri })
      .from(mealStatusChanges)
      .where(and(eq(mealStatusChanges.memberId, memberId), eq(mealStatusChanges.date, date)))
      .limit(1);
    const sehri = rows[0]?.sehri ?? false;

    const names = await getMemberNames([memberId]);
    const memberName = names.get(memberId) ?? memberId;

    await db.transaction(async (tx) => {
      await tx
        .insert(mealStatusChanges)
        .values({ memberId, date, status, sehri })
        .onConflictDoUpdate({
          target: [mealStatusChanges.memberId, mealStatusChanges.date],
          set: { status },
        });

      await recordAudit(
        {
          actor,
          action: "meal.status.set",
          entityType: "member",
          entityId: memberId,
          summary: `Set ${memberName} to ${status} from ${date}`,
          detail: { date, status },
        },
        tx,
      );
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
  const actor = await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");

  const locked = await monthLockError([input.date]);
  if (locked) return fail(locked);

  try {
    const changes = await getStatusChanges();
    const current = statusOnDate(changes, input.memberId, input.date);

    const names = await getMemberNames([input.memberId]);
    const memberName = names.get(input.memberId) ?? input.memberId;

    await db.transaction(async (tx) => {
      await tx
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

      await recordAudit(
        {
          actor,
          action: "meal.sehri.set",
          entityType: "member",
          entityId: input.memberId,
          summary: `${input.sehri ? "Marked" : "Cleared"} Sehri for ${memberName} on ${input.date}`,
          detail: { date: input.date, sehri: input.sehri },
        },
        tx,
      );
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
  const actor = await requireSession();
  const parsed = guestSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error, "Invalid guest meal"));
  }
  const { memberId, date, type, count } = parsed.data;

  const locked = await monthLockError([date]);
  if (locked) return fail(locked);

  try {
    const names = await getMemberNames([memberId]);
    const memberName = names.get(memberId) ?? memberId;
    const label = type === "GUEST_FULL" ? "full" : "half";

    await db.transaction(async (tx) => {
      if (count <= 0) {
        await tx
          .delete(guestMeals)
          .where(
            and(
              eq(guestMeals.memberId, memberId),
              eq(guestMeals.date, date),
              eq(guestMeals.type, type),
            ),
          );
      } else {
        await tx
          .insert(guestMeals)
          .values({ memberId, date, type, count })
          .onConflictDoUpdate({
            target: [guestMeals.memberId, guestMeals.date, guestMeals.type],
            set: { count },
          });
      }

      await recordAudit(
        {
          actor,
          action: count <= 0 ? "meal.guest.clear" : "meal.guest.set",
          entityType: "member",
          entityId: memberId,
          summary:
            count <= 0
              ? `Removed ${label} guest meals for ${memberName} on ${date}`
              : `Set ${count} ${label} guest meal${count === 1 ? "" : "s"} for ${memberName} on ${date}`,
          detail: { date, type, count },
        },
        tx,
      );
    });
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
  const actor = await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");

  const locked = await monthLockError([input.date]);
  if (locked) return fail(locked);

  try {
    const names = await getMemberNames([input.memberId]);
    const memberName = names.get(input.memberId) ?? input.memberId;

    await db.transaction(async (tx) => {
      await tx
        .delete(guestMeals)
        .where(
          and(eq(guestMeals.memberId, input.memberId), eq(guestMeals.date, input.date)),
        );

      await recordAudit(
        {
          actor,
          action: "meal.guest.clearAll",
          entityType: "member",
          entityId: input.memberId,
          summary: `Cleared all guest meals for ${memberName} on ${input.date}`,
          detail: { date: input.date },
        },
        tx,
      );
    });
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
  const actor = await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");
  if (input.memberIds.length === 0) return ok();

  const locked = await monthLockError([input.date]);
  if (locked) return fail(locked);

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

    await db.transaction(async (tx) => {
      await tx
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

      await recordAudit(
        {
          actor,
          action: "meal.status.bulk",
          entityType: "day",
          entityId: input.date,
          summary: `Set ${input.memberIds.length} member${
            input.memberIds.length === 1 ? "" : "s"
          } to ${input.status} on ${input.date}`,
          detail: { date: input.date, status: input.status, count: input.memberIds.length },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not apply the status to everyone"));
  }

  refresh();
  return ok();
}

/**
 * Puts a whole day back to the default: everyone active eats full.
 *
 * Note this writes a *change* row for the date, and because status is sticky
 * that value carries forward until each member's next change. It is not wired
 * to any screen today; it stays for administrative use.
 */
export async function resetDayToDefault(input: { date: string }): Promise<ActionResult> {
  const actor = await requireSession();
  if (!isValidDateKey(input.date)) return fail("Invalid date");

  const locked = await monthLockError([input.date]);
  if (locked) return fail(locked);

  try {
    await db.transaction(async (tx) => {
      await tx.delete(mealStatusChanges).where(eq(mealStatusChanges.date, input.date));
      const active = await tx
        .select({ id: members.id })
        .from(members)
        .where(eq(members.active, true));

      if (active.length > 0) {
        await tx.insert(mealStatusChanges).values(
          active.map((member) => ({
            memberId: member.id,
            date: input.date,
            status: "FULL" as MealStatus,
            sehri: false,
          })),
        );
      }

      await recordAudit(
        {
          actor,
          action: "meal.day.reset",
          entityType: "day",
          entityId: input.date,
          summary: `Reset ${input.date} to full meals for ${active.length} active member${
            active.length === 1 ? "" : "s"
          }`,
          detail: { date: input.date, memberCount: active.length },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not reset the day"));
  }

  refresh();
  return ok();
}
