"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { members, rooms } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { todayKey } from "@/lib/dates";
import { requireSession } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import { getMemberHistoryLosses } from "@/server/queries";

const roomSchema = z.object({
  number: z.string().trim().min(1, "Room number is required").max(32),
  capacity: z.coerce.number().int().min(1).max(10),
  notes: z.string().max(300).optional(),
});

export async function createRoom(
  input: z.infer<typeof roomSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = roomSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid room"));

  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(rooms)
        .values({
          number: parsed.data.number.trim(),
          capacity: parsed.data.capacity,
          notes: parsed.data.notes?.trim() || null,
        })
        .returning({ id: rooms.id });

      await recordAudit(
        {
          actor,
          action: "room.create",
          entityType: "room",
          entityId: created?.id ?? parsed.data.number.trim(),
          summary: `Added room ${parsed.data.number.trim()} (capacity ${parsed.data.capacity})`,
          detail: { capacity: parsed.data.capacity },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(
      firstIssue(error, "Could not create the room (is the number already used?)"),
    );
  }
  refresh();
  return ok("Room added");
}

export async function updateRoom(
  input: z.infer<typeof roomSchema> & { id: string },
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = roomSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid room"));

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(rooms)
        .set({
          number: parsed.data.number.trim(),
          capacity: parsed.data.capacity,
          notes: parsed.data.notes?.trim() || null,
        })
        .where(eq(rooms.id, input.id));

      await recordAudit(
        {
          actor,
          action: "room.update",
          entityType: "room",
          entityId: input.id,
          summary: `Updated room ${parsed.data.number.trim()} (capacity ${parsed.data.capacity})`,
          detail: { capacity: parsed.data.capacity },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not update the room"));
  }
  refresh();
  return ok("Room updated");
}

export async function deleteRoom(id: string): Promise<ActionResult> {
  const actor = await requireSession();
  try {
    const occupants = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(members)
      .where(eq(members.roomId, id));
    if ((occupants[0]?.count ?? 0) > 0) {
      return fail("Move the members out of this room first.");
    }

    const [existing] = await db
      .select({ number: rooms.number })
      .from(rooms)
      .where(eq(rooms.id, id))
      .limit(1);
    if (!existing) return fail("That room no longer exists.");

    await db.transaction(async (tx) => {
      await tx.delete(rooms).where(eq(rooms.id, id));

      await recordAudit(
        {
          actor,
          action: "room.delete",
          entityType: "room",
          entityId: id,
          summary: `Deleted room ${existing.number}`,
          detail: { number: existing.number },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not delete the room"));
  }
  refresh();
  return ok("Room deleted");
}

const memberSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  roomId: z.string().min(1, "Pick a room"),
  phone: z.string().trim().max(40).optional(),
  bloodGroup: z.string().trim().max(8).optional(),
  active: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});

export async function createMember(
  input: z.infer<typeof memberSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid member"));
  const data = parsed.data;

  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(members)
        .values({
          name: data.name.trim(),
          roomId: data.roomId,
          phone: data.phone?.trim() || null,
          bloodGroup: data.bloodGroup?.trim() || null,
          active: data.active,
          // There is no join-date field any more: a member starts counting on the
          // day they are added, which is the safe default because days before their
          // first status change already resolve to Off.
          joinDate: todayKey(),
          leaveDate: data.active ? null : todayKey(),
          notes: data.notes?.trim() || null,
        })
        .returning({ id: members.id });

      await recordAudit(
        {
          actor,
          action: "member.create",
          entityType: "member",
          entityId: created?.id ?? data.name.trim(),
          summary: `Added ${data.name.trim()}`,
          detail: { roomId: data.roomId, active: data.active },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not add the member"));
  }
  refresh();
  return ok("Member added");
}

export async function updateMember(
  input: z.infer<typeof memberSchema> & { id: string },
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid member"));
  const data = parsed.data;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(members)
        .set({
          name: data.name.trim(),
          roomId: data.roomId,
          phone: data.phone?.trim() || null,
          bloodGroup: data.bloodGroup?.trim() || null,
          active: data.active,
          // joinDate is deliberately untouched: it is set once when the member is
          // added, so editing a name never rewrites their billing history.
          // Marking a member inactive stops their charges from today.
          leaveDate: data.active ? null : todayKey(),
          notes: data.notes?.trim() || null,
        })
        .where(eq(members.id, input.id));

      await recordAudit(
        {
          actor,
          action: "member.update",
          entityType: "member",
          entityId: input.id,
          summary: `Updated ${data.name.trim()}`,
          detail: { roomId: data.roomId, active: data.active },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not update the member"));
  }
  refresh();
  return ok("Member updated");
}

export async function setMemberActive(
  input: { id: string; active: boolean },
): Promise<ActionResult> {
  const actor = await requireSession();
  try {
    const [existing] = await db
      .select({ name: members.name })
      .from(members)
      .where(eq(members.id, input.id))
      .limit(1);
    if (!existing) return fail("That member no longer exists.");

    await db.transaction(async (tx) => {
      await tx
        .update(members)
        .set({
          active: input.active,
          leaveDate: input.active ? null : todayKey(),
        })
        .where(eq(members.id, input.id));

      await recordAudit(
        {
          actor,
          action: input.active ? "member.activate" : "member.deactivate",
          entityType: "member",
          entityId: input.id,
          summary: `${input.active ? "Reactivated" : "Marked inactive"} ${existing.name}`,
          detail: { active: input.active },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not update the member"));
  }
  refresh();
  return ok(input.active ? "Member reactivated" : "Member marked inactive");
}

const deleteMemberSchema = z.object({
  id: z.string().min(1),
  /**
   * Set once the operator has been shown exactly which unclosed records will be
   * destroyed. Without it, a delete that would rewrite an open month is refused.
   */
  confirmLoss: z.boolean().optional().default(false),
});

/**
 * Deletes a member and, by cascade, their meal status changes, guest meals and
 * deposits.
 *
 * Closed months keep a frozen snapshot, so losing rows from those months is
 * harmless. Rows in a month that is still open are a different matter — they
 * feed that month's totals, so deleting them silently rewrites history. Those
 * are reported back and need explicit confirmation.
 */
export async function deleteMember(
  input: z.infer<typeof deleteMemberSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = deleteMemberSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid member"));
  const { id, confirmLoss } = parsed.data;

  try {
    const [member] = await db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(eq(members.id, id))
      .limit(1);
    if (!member) return fail("That member no longer exists.");

    const losses = await getMemberHistoryLosses();
    const loss = losses.get(id);

    if (loss?.hasUnclosedHistory && !confirmLoss) {
      const parts: string[] = [];
      if (loss.statusChanges.unclosed > 0) {
        parts.push(
          `${loss.statusChanges.unclosed} meal-status change${
            loss.statusChanges.unclosed === 1 ? "" : "s"
          }`,
        );
      }
      if (loss.guestMeals.unclosed > 0) {
        parts.push(
          `${loss.guestMeals.unclosed} guest-meal record${
            loss.guestMeals.unclosed === 1 ? "" : "s"
          }`,
        );
      }
      if (loss.deposits.unclosed > 0) {
        parts.push(
          `${loss.deposits.unclosed} deposit${loss.deposits.unclosed === 1 ? "" : "s"}`,
        );
      }

      return fail(
        `${member.name} still has ${parts.join(", ")} in unclosed month${
          loss.unclosedMonths.length === 1 ? "" : "s"
        } (${loss.unclosedMonths.join(", ")}). Deleting them would rewrite ${
          loss.unclosedMonths.length === 1 ? "that month" : "those months"
        }. Close the month first, or confirm that you want to lose those records.`,
      );
    }

    await db.transaction(async (tx) => {
      await tx.delete(members).where(eq(members.id, id));

      await recordAudit(
        {
          actor,
          action: "member.delete",
          entityType: "member",
          entityId: id,
          summary:
            `Deleted ${member.name}` +
            (loss?.hasUnclosedHistory
              ? ` and ${loss.unclosedItems} record(s) from unclosed month(s)`
              : ""),
          detail: {
            name: member.name,
            unclosedItems: loss?.unclosedItems ?? 0,
            unclosedMonths: loss?.unclosedMonths ?? [],
            confirmedLoss: confirmLoss,
          },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(
      firstIssue(
        error,
        "This member has settled months on record and cannot be deleted. Mark them inactive instead.",
      ),
    );
  }
  refresh();
  return ok("Member deleted");
}
