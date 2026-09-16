"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { members, rooms } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { isValidDateKey, todayKey } from "@/lib/dates";
import { requireSession } from "@/server/auth";

const roomSchema = z.object({
  number: z.string().trim().min(1, "Room number is required").max(32),
  capacity: z.coerce.number().int().min(1).max(10),
  notes: z.string().max(300).optional(),
});

export async function createRoom(
  input: z.infer<typeof roomSchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = roomSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid room"));

  try {
    await db.insert(rooms).values({
      number: parsed.data.number.trim(),
      capacity: parsed.data.capacity,
      notes: parsed.data.notes?.trim() || null,
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
  await requireSession();
  const parsed = roomSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid room"));

  try {
    await db
      .update(rooms)
      .set({
        number: parsed.data.number.trim(),
        capacity: parsed.data.capacity,
        notes: parsed.data.notes?.trim() || null,
      })
      .where(eq(rooms.id, input.id));
  } catch (error) {
    return fail(firstIssue(error, "Could not update the room"));
  }
  refresh();
  return ok("Room updated");
}

export async function deleteRoom(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    const occupants = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(members)
      .where(eq(members.roomId, id));
    if ((occupants[0]?.count ?? 0) > 0) {
      return fail("Move the members out of this room first.");
    }
    await db.delete(rooms).where(eq(rooms.id, id));
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
  joinDate: z.string().refine(isValidDateKey, "Pick a valid join date"),
  leaveDate: z
    .string()
    .optional()
    .refine((value) => !value || isValidDateKey(value), "Pick a valid leave date"),
  notes: z.string().max(500).optional(),
});

export async function createMember(
  input: z.infer<typeof memberSchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid member"));
  const data = parsed.data;

  try {
    await db.insert(members).values({
      name: data.name.trim(),
      roomId: data.roomId,
      phone: data.phone?.trim() || null,
      bloodGroup: data.bloodGroup?.trim() || null,
      active: data.active,
      joinDate: data.joinDate,
      leaveDate: data.leaveDate || null,
      notes: data.notes?.trim() || null,
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
  await requireSession();
  const parsed = memberSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid member"));
  const data = parsed.data;

  if (data.leaveDate && data.leaveDate < data.joinDate) {
    return fail("The leave date cannot be before the join date.");
  }

  try {
    await db
      .update(members)
      .set({
        name: data.name.trim(),
        roomId: data.roomId,
        phone: data.phone?.trim() || null,
        bloodGroup: data.bloodGroup?.trim() || null,
        active: data.active,
        joinDate: data.joinDate,
        // Marking a member inactive without a leave date stops their charges
        // from today, so past months stay accurate.
        leaveDate: data.leaveDate || (data.active ? null : todayKey()),
        notes: data.notes?.trim() || null,
      })
      .where(eq(members.id, input.id));
  } catch (error) {
    return fail(firstIssue(error, "Could not update the member"));
  }
  refresh();
  return ok("Member updated");
}

export async function setMemberActive(
  input: { id: string; active: boolean },
): Promise<ActionResult> {
  await requireSession();
  try {
    await db
      .update(members)
      .set({
        active: input.active,
        leaveDate: input.active ? null : todayKey(),
      })
      .where(eq(members.id, input.id));
  } catch (error) {
    return fail(firstIssue(error, "Could not update the member"));
  }
  refresh();
  return ok(input.active ? "Member reactivated" : "Member marked inactive");
}

export async function deleteMember(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await db.delete(members).where(eq(members.id, id));
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
