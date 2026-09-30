"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import {
  deposits,
  extraLineItems,
  khalaPayments,
  utilityBills,
} from "@/db/schema";
import { apportionKhala, rateCardFor } from "@/lib/calc";
import {
  fail,
  firstIssue,
  ok,
  takaAmount,
  type ActionResult,
} from "@/lib/action-result";
import {
  formatMonthLongDisplay,
  isValidDateKey,
  isValidMonthKey,
  monthEnd,
  monthOf,
  monthStart,
} from "@/lib/dates";
import { formatTaka, sum } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import { monthKeyLockError, monthLockError } from "@/server/month-lock";
import {
  countActiveMembersInMonth,
  getKhalaPayments,
  getMemberNames,
  loadLedgerSnapshot,
} from "@/server/queries";

const extraSchema = z.object({
  date: z.string().refine(isValidDateKey, "Pick a valid date"),
  label: z.string().trim().min(1, "Give the item a label").max(120),
  amount: takaAmount(1),
  category: z.enum(["RECURRING_DAILY", "ONE_OFF", "MANAGER_FEE", "FEAST", "OTHER"]),
  showInDailyBudget: z.boolean().default(false),
  /** Generated once per submission so a double-click cannot add it twice. */
  idempotencyKey: z.string().max(64).optional(),
});

export async function createExtra(
  input: z.input<typeof extraSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = extraSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid extra item"));

  const locked = await monthLockError([parsed.data.date]);
  if (locked) return fail(locked);

  const { idempotencyKey, ...values } = parsed.data;
  try {
    const created = await db.transaction(async (tx) => {
      // A manual item is identified by the key the browser sent with the form,
      // so the same submission can only ever be written once.
      const inserted = await tx
        .insert(extraLineItems)
        .values({
          ...values,
          label: values.label.trim(),
          isAuto: false,
          sourceKey: idempotencyKey ? `manual:${idempotencyKey}` : null,
        })
        .onConflictDoNothing({ target: extraLineItems.sourceKey })
        .returning({ id: extraLineItems.id });

      if (inserted.length === 0) return false;

      await recordAudit(
        {
          actor,
          action: "extra.create",
          entityType: "extra",
          entityId: parsed.data.date,
          summary: `Added extra "${values.label.trim()}" of ${formatTaka(
            values.amount,
          )} on ${parsed.data.date}`,
          detail: { ...values },
        },
        tx,
      );
      return true;
    });
    if (!created) return ok("That extra item was already added");
  } catch (error) {
    return fail(firstIssue(error, "Could not save the extra item"));
  }
  refresh();
  return ok("Extra item added");
}

export async function updateExtra(
  input: z.input<typeof extraSchema> & { id: string },
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = extraSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid extra item"));

  try {
    // An edit can move an item between months, so both the old and the new
    // month have to be open.
    const [existing] = await db
      .select({
        date: extraLineItems.date,
        amount: extraLineItems.amount,
        label: extraLineItems.label,
        category: extraLineItems.category,
        showInDailyBudget: extraLineItems.showInDailyBudget,
        isAuto: extraLineItems.isAuto,
      })
      .from(extraLineItems)
      .where(eq(extraLineItems.id, input.id))
      .limit(1);
    if (!existing) return fail("That extra item no longer exists.");

    if (existing.isAuto) {
      return fail(
        "Auto-generated items cannot be edited manually. Their amounts come from the rate card in force on that day.",
      );
    }

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
          // Both the old and the new value, so a past month can still be
          // reconstructed from the trail.
          detail: {
            from: existing,
            to: {
              date: parsed.data.date,
              amount: parsed.data.amount,
              label: parsed.data.label.trim(),
              category: parsed.data.category,
              showInDailyBudget: parsed.data.showInDailyBudget,
            },
          },
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
      .select({
        date: extraLineItems.date,
        label: extraLineItems.label,
        amount: extraLineItems.amount,
        isAuto: extraLineItems.isAuto,
      })
      .from(extraLineItems)
      .where(eq(extraLineItems.id, id))
      .limit(1);
    if (!existing) return fail("That extra item no longer exists.");

    if (existing.isAuto) {
      return fail(
        "Auto-generated items cannot be deleted here. If this day should not carry the recurring charge, turn it off on Today's Bazar.",
      );
    }

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
  amount: takaAmount(0),
});

export async function saveUtilityBill(
  input: z.input<typeof billSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid bill"));

  const locked = await monthKeyLockError(parsed.data.month);
  if (locked) return fail(locked);

  // A bill for a month nobody lived in would be shown on the Extras page and
  // then charged to nobody — it would vanish. Say so instead of accepting it.
  if (parsed.data.amount > 0) {
    const activeCount = await countActiveMembersInMonth(parsed.data.month);
    if (activeCount === 0) {
      return fail(
        `No member was in the mess during ${formatMonthLongDisplay(
          parsed.data.month,
        )}, so this bill would be charged to nobody. Check the members' join and leave dates first.`,
      );
    }
  }

  const month = monthStart(parsed.data.month);
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ amount: utilityBills.amount })
        .from(utilityBills)
        .where(
          and(
            eq(utilityBills.month, month),
            eq(utilityBills.type, parsed.data.type),
          ),
        )
        .limit(1);

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
          detail: {
            month: parsed.data.month,
            type: parsed.data.type,
            from: before?.amount ?? null,
            to: parsed.data.amount,
          },
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

const khalaPaymentSchema = z.object({
  date: z.string().refine(isValidDateKey, "Pick a valid date"),
  amount: takaAmount(1),
  notes: z.string().trim().max(300).optional(),
  /** Generated once per submission so a double-click cannot log it twice. */
  idempotencyKey: z.string().max(64).optional(),
});

/**
 * The most khala that may be logged for a month: the rate card's per-head
 * amounts summed over everyone who lived in the mess that month.
 */
async function khalaCeilingForMonth(month: string): Promise<number> {
  const snapshot = await loadLedgerSnapshot();
  const apportion = apportionKhala({
    members: snapshot.members,
    rooms: snapshot.rooms,
    payments: [],
    from: monthStart(month),
    to: monthEnd(month),
    rateCard: rateCardFor(snapshot.rateCards, monthStart(month)),
    today: snapshot.today,
  });
  return apportion.monthlyTarget;
}

export async function logKhalaPayment(
  input: z.input<typeof khalaPaymentSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = khalaPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return fail(firstIssue(parsed.error, "Invalid khala payment"));
  }

  const locked = await monthLockError([parsed.data.date]);
  if (locked) return fail(locked);

  const month = monthOf(parsed.data.date);
  const alreadyPaid = sum(
    (
      await getKhalaPayments()
    ).filter((payment) => monthOf(payment.date) === month).map((p) => p.amount),
  );
  const ceiling = await khalaCeilingForMonth(month);

  if (alreadyPaid + parsed.data.amount > ceiling) {
    const remaining = Math.max(0, ceiling - alreadyPaid);
    return fail(
      ceiling === 0
        ? `The rate card sets no khala for ${formatMonthLongDisplay(
            month,
          )}, so there is nothing to log against. Set the khala rates on the Rate Card page first.`
        : `That would take khala for ${formatMonthLongDisplay(
            month,
          )} to ${formatTaka(
            alreadyPaid + parsed.data.amount,
          )}, above the ${formatTaka(
            ceiling,
          )} the rate card says a full month costs. ${formatTaka(
            remaining,
          )} is still outstanding — log that instead.`,
    );
  }

  const { idempotencyKey, notes, ...values } = parsed.data;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(khalaPayments).values({
        ...values,
        notes: notes || null,
        idempotencyKey: idempotencyKey ?? null,
      });

      await recordAudit(
        {
          actor,
          action: "bill.save",
          entityType: "khala_payment",
          entityId: values.date,
          summary: `Logged a khala payment of ${formatTaka(
            values.amount,
          )} on ${values.date}`,
          detail: {
            date: values.date,
            amount: values.amount,
            monthPaidTotal: alreadyPaid + values.amount,
            monthTarget: ceiling,
          },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not log the khala payment"));
  }
  refresh();
  return ok("Khala payment logged");
}

export async function deleteKhalaPayment(input: {
  id: string;
}): Promise<ActionResult> {
  const actor = await requireSession();
  const existing = (
    await db
      .select({
        id: khalaPayments.id,
        date: khalaPayments.date,
        amount: khalaPayments.amount,
      })
      .from(khalaPayments)
      .where(eq(khalaPayments.id, input.id))
      .limit(1)
  )[0];
  if (!existing) return fail("That khala payment no longer exists");

  const locked = await monthLockError([existing.date]);
  if (locked) return fail(locked);

  try {
    await db.transaction(async (tx) => {
      await tx.delete(khalaPayments).where(eq(khalaPayments.id, input.id));

      await recordAudit(
        {
          actor,
          action: "bill.delete",
          entityType: "khala_payment",
          entityId: existing.id,
          summary: `Removed a khala payment of ${formatTaka(
            existing.amount,
          )} dated ${existing.date}`,
          detail: { date: existing.date, amount: existing.amount },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not delete the khala payment"));
  }
  refresh();
  return ok("Khala payment removed");
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
  amount: takaAmount(0),
  notes: z.string().max(300).optional(),
  /**
   * Generated once per submission in the browser and reused until the save
   * succeeds, so a double-click cannot record the deposit twice.
   */
  idempotencyKey: z.string().max(64).optional(),
});

export async function createDeposit(
  input: z.input<typeof depositSchema>,
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

    const { idempotencyKey, ...values } = parsed.data;

    await db.transaction(async (tx) => {
      // The unique index on `idempotency_key` means the second of two clicks
      // that raced each other simply inserts nothing.
      const inserted = await tx
        .insert(deposits)
        .values({
          ...values,
          notes: values.notes?.trim() || null,
          idempotencyKey: idempotencyKey || null,
        })
        .onConflictDoNothing({ target: deposits.idempotencyKey })
        .returning({ id: deposits.id });

      if (inserted.length === 0) return;

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
