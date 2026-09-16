"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { deposits, extraLineItems, utilityBills } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { isValidDateKey, isValidMonthKey, monthStart } from "@/lib/dates";
import { requireSession } from "@/server/auth";

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
  await requireSession();
  const parsed = extraSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid extra item"));

  try {
    await db.insert(extraLineItems).values({
      ...parsed.data,
      label: parsed.data.label.trim(),
      isAuto: false,
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
  await requireSession();
  const parsed = extraSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid extra item"));

  try {
    await db
      .update(extraLineItems)
      .set({
        date: parsed.data.date,
        label: parsed.data.label.trim(),
        amount: parsed.data.amount,
        category: parsed.data.category,
        showInDailyBudget: parsed.data.showInDailyBudget,
      })
      .where(eq(extraLineItems.id, input.id));
  } catch (error) {
    return fail(firstIssue(error, "Could not update the extra item"));
  }
  refresh();
  return ok("Extra item updated");
}

export async function deleteExtra(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await db.delete(extraLineItems).where(eq(extraLineItems.id, id));
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
  await requireSession();
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid bill"));

  const month = monthStart(parsed.data.month);
  try {
    await db
      .insert(utilityBills)
      .values({ month, type: parsed.data.type, amount: parsed.data.amount })
      .onConflictDoUpdate({
        target: [utilityBills.month, utilityBills.type],
        set: { amount: parsed.data.amount },
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
  await requireSession();
  if (!isValidMonthKey(input.month)) return fail("Invalid month");
  try {
    await db
      .delete(utilityBills)
      .where(
        and(
          eq(utilityBills.month, monthStart(input.month)),
          eq(utilityBills.type, input.type),
        ),
      );
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
  await requireSession();
  const parsed = depositSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid deposit"));
  if (parsed.data.amount <= 0) return fail("A deposit needs an amount.");

  try {
    await db.insert(deposits).values({
      memberId: parsed.data.memberId,
      date: parsed.data.date,
      amount: parsed.data.amount,
      notes: parsed.data.notes?.trim() || null,
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the deposit"));
  }
  refresh();
  return ok("Deposit recorded");
}

export async function deleteDeposit(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    await db.delete(deposits).where(eq(deposits.id, id));
  } catch (error) {
    return fail(firstIssue(error, "Could not delete the deposit"));
  }
  refresh();
  return ok("Deposit deleted");
}
