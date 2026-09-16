"use server";

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { rateCards } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { addDays, isValidDateKey } from "@/lib/dates";
import { requireSession } from "@/server/auth";

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

/**
 * Creates a new rate card version. The previously open-ended card is closed the
 * day before, so past days keep pricing at the rates that were actually in
 * force and no history is rewritten.
 */
export async function createRateCard(
  input: z.infer<typeof rateSchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid rate card"));
  const data = parsed.data;

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(rateCards)
        .set({ effectiveTo: addDays(data.effectiveFrom, -1) })
        .where(
          and(isNull(rateCards.effectiveTo), lt(rateCards.effectiveFrom, data.effectiveFrom)),
        );

      await tx.insert(rateCards).values({
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
      });
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
  await requireSession();
  const parsed = rateSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid rate card"));
  const data = parsed.data;

  try {
    await db
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
  } catch (error) {
    return fail(firstIssue(error, "Could not update the rate card"));
  }

  refresh();
  return ok("Rate card updated");
}

export async function deleteRateCard(id: string): Promise<ActionResult> {
  await requireSession();
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(rateCards);
    if (count <= 1) {
      return fail("At least one rate card must exist.");
    }
    await db.delete(rateCards).where(eq(rateCards.id, id));
  } catch (error) {
    return fail(firstIssue(error, "Could not delete the rate card"));
  }
  refresh();
  return ok("Rate card deleted");
}
