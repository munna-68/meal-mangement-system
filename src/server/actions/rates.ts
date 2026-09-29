"use server";

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { rateCards } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { addDays, isValidDateKey, monthOf } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import { monthLockError } from "@/server/month-lock";

const rateSchema = z.object({
  label: z.string().trim().max(80).optional(),
  effectiveFrom: z.string().refine(isValidDateKey, "Pick an effective date"),
  fullMealRate: z.coerce.number().int().min(0),
  halfMealRate: z.coerce.number().int().min(0),
  guestFullRate: z.coerce.number().int().min(0),
  guestHalfRate: z.coerce.number().int().min(0),
  sehriRate: z.coerce.number().int().min(0),
  feastFlatCharge: z.coerce.number().int().min(0),
  khalaNormalRate: z.coerce.number().int().min(0),
  khalaSoloRate: z.coerce.number().int().min(0),
  managerDailyFee: z.coerce.number().int().min(0),
  dailyExtraAmount: z.coerce.number().int().min(0),
});

function summariseRates(data: z.infer<typeof rateSchema>): string {
  return [
    `full ${formatTaka(data.fullMealRate)}`,
    `half ${formatTaka(data.halfMealRate)}`,
    `Khala ${formatTaka(data.khalaNormalRate)}/${formatTaka(data.khalaSoloRate)} solo`,
    `extra ${formatTaka(data.dailyExtraAmount)}`,
    `manager ${formatTaka(data.managerDailyFee)}`,
  ].join(", ");
}

/**
 * Creates a new rate card version. The previously open-ended card is closed the
 * day before, so past days keep pricing at the rates that were actually in
 * force and no history is rewritten.
 */
export async function createRateCard(
  input: z.infer<typeof rateSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid rate card"));
  const data = parsed.data;

  const locked = await monthLockError([data.effectiveFrom]);
  if (locked) return fail(locked);

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(rateCards)
        .set({ effectiveTo: addDays(data.effectiveFrom, -1) })
        .where(
          and(isNull(rateCards.effectiveTo), lt(rateCards.effectiveFrom, data.effectiveFrom)),
        );

      const [created] = await tx
        .insert(rateCards)
        .values({
          label: data.label?.trim() || null,
          effectiveFrom: data.effectiveFrom,
          effectiveTo: null,
          fullMealRate: data.fullMealRate,
          halfMealRate: data.halfMealRate,
          guestFullRate: data.guestFullRate,
          guestHalfRate: data.guestHalfRate,
          sehriRate: data.sehriRate,
          feastFlatCharge: data.feastFlatCharge,
          khalaNormalRate: data.khalaNormalRate,
          khalaSoloRate: data.khalaSoloRate,
          managerDailyFee: data.managerDailyFee,
          dailyExtraAmount: data.dailyExtraAmount,
        })
        .returning({ id: rateCards.id });

      await recordAudit(
        {
          actor,
          action: "rate.create",
          entityType: "rate_card",
          entityId: created?.id ?? data.effectiveFrom,
          summary: `New rate card from ${data.effectiveFrom} — ${summariseRates(data)}`,
          detail: { ...data, effectiveFrom: data.effectiveFrom },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not create the rate card version"));
  }

  refresh();
  return ok("New rate card version created");
}

export async function updateRateCard(
  input: z.infer<typeof rateSchema> & { id: string },
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid rate card"));
  const data = parsed.data;

  try {
    const [existing] = await db
      .select({ effectiveFrom: rateCards.effectiveFrom, label: rateCards.label })
      .from(rateCards)
      .where(eq(rateCards.id, input.id))
      .limit(1);
    if (!existing) return fail("That rate card no longer exists.");

    // Moving a card's start date re-prices history, so both the month it used to
    // start in and the month it now starts in must be open.
    const locked = await monthLockError([
      existing.effectiveFrom,
      data.effectiveFrom,
    ]);
    if (locked) return fail(locked);

    await db.transaction(async (tx) => {
      await tx
        .update(rateCards)
        .set({
          label: data.label?.trim() || null,
          effectiveFrom: data.effectiveFrom,
          fullMealRate: data.fullMealRate,
          halfMealRate: data.halfMealRate,
          guestFullRate: data.guestFullRate,
          guestHalfRate: data.guestHalfRate,
          sehriRate: data.sehriRate,
          feastFlatCharge: data.feastFlatCharge,
          khalaNormalRate: data.khalaNormalRate,
          khalaSoloRate: data.khalaSoloRate,
          managerDailyFee: data.managerDailyFee,
          dailyExtraAmount: data.dailyExtraAmount,
        })
        .where(eq(rateCards.id, input.id));

      await recordAudit(
        {
          actor,
          action: "rate.update",
          entityType: "rate_card",
          entityId: input.id,
          summary: `Updated the rate card from ${data.effectiveFrom} — ${summariseRates(data)}`,
          detail: {
            ...data,
            effectiveFrom: data.effectiveFrom,
            previousEffectiveFrom: existing.effectiveFrom,
          },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not update the rate card"));
  }

  refresh();
  return ok("Rate card updated");
}

export async function deleteRateCard(id: string): Promise<ActionResult> {
  const actor = await requireSession();
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rateCards);
    if (count <= 1) {
      return fail("At least one rate card must exist.");
    }

    const [existing] = await db
      .select({
        effectiveFrom: rateCards.effectiveFrom,
        label: rateCards.label,
      })
      .from(rateCards)
      .where(eq(rateCards.id, id))
      .limit(1);
    if (!existing) return fail("That rate card no longer exists.");

    const locked = await monthLockError([existing.effectiveFrom]);
    if (locked) return fail(locked);

    await db.transaction(async (tx) => {
      await tx.delete(rateCards).where(eq(rateCards.id, id));

      await recordAudit(
        {
          actor,
          action: "rate.delete",
          entityType: "rate_card",
          entityId: id,
          summary: `Deleted the rate card from ${existing.effectiveFrom}${
            existing.label ? ` (${existing.label})` : ""
          }`,
          detail: {
            effectiveFrom: existing.effectiveFrom,
            month: monthOf(existing.effectiveFrom),
          },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not delete the rate card"));
  }
  refresh();
  return ok("Rate card deleted");
}
