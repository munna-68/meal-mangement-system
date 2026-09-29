"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { deposits, extraLineItems, utilityBills } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { isValidDateKey, isValidMonthKey, monthOf, monthStart } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import { monthKeyLockError, monthLockError } from "@/server/month-lock";
import { getMemberNames } from "@/server/queries";

const extraSchema = z.object({
  date: z.string().refine(isValidDateKey, "Pick a valid date"),
  label: z.string().trim().min(1, "Give the item a label").max(120),
  amount: z.coerce.number().int().min(0, "Amount cannot be negative"),
  category: z.enum(["RECURRING_DAILY", "ONE_OFF", "MANAGER_FEE", "FEAST", "OTHER"]),
  showInDailyBudget: z.boolean().default(false),
});

export async function createExtra(
  input: z.infer<typeof extraSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = extraSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid extra item"));

  const locked = await monthLockError([parsed.data.date]);
  if (locked) return fail(locked);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(extraLineItems).values({
        ...parsed.data,
        label: parsed.data.label.trim(),
        isAuto: false,
      });

      await recordAudit(
        {
          actor,
          action: "extra.create",
          entityType: "extra",
          entityId: parsed.data.date,
          summary: `Added extra "${parsed.data.label.trim()}" of ${formatTaka(
            parsed.data.amount,
          )} on ${parsed.data.date}`,
          detail: { ...parsed.data },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the extra item"));
  }
  refresh();
  return ok("Extra item added");
}

export async function updateExtra(
  input: z.infer<typeof extraSchema> & { id: string },
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = extraSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid extra item"));

  try {
    // An edit can move an item between months, so both the old and the new
    // month have to be open.
    const [existing] = await db
      .select({ date: extraLineItems.date })
      .from(extraLineItems)
      .where(eq(extraLineItems.id, input.id))
      .limit(1);
    if (!existing) return fail("That extra item no longer exists.");

    const locked = await monthLockError([existing.date, parsed.data.date]);
    if (locked) return fail(locked);

    await db.transaction(async (tx) => {
      await tx
        .update(extraLineItems)
        .set({
          date: parsed.data.date,
          label: parsed.data.label.trim(),
          amount: parsed.data.amount,
          category: parsed.data.category,
          showInDailyBudget: parsed.data.showInDailyBudget,
        })
        .where(eq(extraLineItems.id, input.id));

      await recordAudit(
        {
          actor,
          action: "extra.update",
          entityType: "extra",
          entityId: input.id,
          summary: `Updated extra "${parsed.data.label.trim()}" to ${formatTaka(
            parsed.data.amount,
          )} on ${parsed.data.date}`,
          detail: { from: existing.date, to: parsed.data.date, amount: parsed.data.amount },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not update the extra item"));
  }
  refresh();
  return ok("Extra item updated");
}

export async function deleteExtra(id: string): Promise<ActionResult> {
  const actor = await requireSession();
  try {
    const [existing] = await db
      .select({ date: extraLineItems.date, label: extraLineItems.label, amount: extraLineItems.amount })
      .from(extraLineItems)
      .where(eq(extraLineItems.id, id))
      .limit(1);
    if (!existing) return fail("That extra item no longer exists.");

    const locked = await monthLockError([existing.date]);
    if (locked) return fail(locked);

    await db.transaction(async (tx) => {
      await tx.delete(extraLineItems).where(eq(extraLineItems.id, id));

      await recordAudit(
        {
          actor,
          action: "extra.delete",
          entityType: "extra",
          entityId: id,
          summary: `Deleted extra "${existing.label}" of ${formatTaka(
            existing.amount,
          )} dated ${existing.date}`,
          detail: { date: existing.date, amount: existing.amount },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not delete the extra item"));
  }
  refresh();
  return ok("Extra item deleted");
}

const billSchema = z.object({
  month: z.string().refine(isValidMonthKey, "Pick a month"),
  type: z.enum(["ELECTRICITY", "WIFI"]),
  amount: z.coerce.number().int().min(0, "Amount cannot be negative"),
});

export async function saveUtilityBill(
  input: z.infer<typeof billSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid bill"));

  const locked = await monthKeyLockError(parsed.data.month);
  if (locked) return fail(locked);

  const month = monthStart(parsed.data.month);
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(utilityBills)
        .values({ month, type: parsed.data.type, amount: parsed.data.amount })
        .onConflictDoUpdate({
          target: [utilityBills.month, utilityBills.type],
          set: { amount: parsed.data.amount },
        });

      await recordAudit(
        {
          actor,
          action: "bill.save",
          entityType: "utility_bill",
          entityId: `${parsed.data.month}:${parsed.data.type}`,
          summary: `Set ${parsed.data.type.toLowerCase()} bill for ${
            parsed.data.month
          } to ${formatTaka(parsed.data.amount)}`,
          detail: { month: parsed.data.month, type: parsed.data.type, amount: parsed.data.amount },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the bill"));
  }
  refresh();
  return ok("Bill saved");
}

export async function deleteUtilityBill(input: {
  month: string;
  type: "ELECTRICITY" | "WIFI";
}): Promise<ActionResult> {
  const actor = await requireSession();
  if (!isValidMonthKey(input.month)) return fail("Invalid month");

  const locked = await monthKeyLockError(input.month);
  if (locked) return fail(locked);

  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(utilityBills)
        .where(
          and(
            eq(utilityBills.month, monthStart(input.month)),
            eq(utilityBills.type, input.type),
          ),
        );

      await recordAudit(
        {
          actor,
          action: "bill.delete",
          entityType: "utility_bill",
          entityId: `${input.month}:${input.type}`,
          summary: `Removed the ${input.type.toLowerCase()} bill for ${input.month}`,
          detail: { month: input.month, type: input.type },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not delete the bill"));
  }
  refresh();
  return ok("Bill removed");
}

const depositSchema = z.object({
  memberId: z.string().min(1, "Pick a member"),
  date: z.string().refine(isValidDateKey, "Pick a valid date"),
  amount: z.coerce.number().int().min(0, "Amount cannot be negative"),
  notes: z.string().max(300).optional(),
});

export async function createDeposit(
  input: z.infer<typeof depositSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = depositSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid deposit"));
  if (parsed.data.amount <= 0) return fail("A deposit needs an amount.");

  const locked = await monthLockError([parsed.data.date]);
  if (locked) return fail(locked);

  try {
    const names = await getMemberNames([parsed.data.memberId]);
    const memberName = names.get(parsed.data.memberId) ?? parsed.data.memberId;

    await db.transaction(async (tx) => {
      await tx.insert(deposits).values({
        memberId: parsed.data.memberId,
        date: parsed.data.date,
        amount: parsed.data.amount,
        notes: parsed.data.notes?.trim() || null,
      });

      await recordAudit(
        {
          actor,
          action: "deposit.create",
          entityType: "member",
          entityId: parsed.data.memberId,
          summary: `Recorded a deposit of ${formatTaka(parsed.data.amount)} for ${memberName} on ${
            parsed.data.date
          }`,
          detail: { date: parsed.data.date, amount: parsed.data.amount },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the deposit"));
  }
  refresh();
  return ok("Deposit recorded");
}

export async function deleteDeposit(id: string): Promise<ActionResult> {
  const actor = await requireSession();
  try {
    const [existing] = await db
      .select({
        memberId: deposits.memberId,
        date: deposits.date,
        amount: deposits.amount,
      })
      .from(deposits)
      .where(eq(deposits.id, id))
      .limit(1);
    if (!existing) return fail("That deposit no longer exists.");

    const locked = await monthLockError([existing.date]);
    if (locked) return fail(locked);

    const names = await getMemberNames([existing.memberId]);
    const memberName = names.get(existing.memberId) ?? existing.memberId;

    await db.transaction(async (tx) => {
      await tx.delete(deposits).where(eq(deposits.id, id));

      await recordAudit(
        {
          actor,
          action: "deposit.delete",
          entityType: "member",
          entityId: existing.memberId,
          summary: `Deleted a deposit of ${formatTaka(existing.amount)} for ${memberName} dated ${
            existing.date
          }`,
          detail: { date: existing.date, amount: existing.amount, month: monthOf(existing.date) },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not delete the deposit"));
  }
  refresh();
  return ok("Deposit deleted");
}
