"use server";

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { messSettings } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { todayKey } from "@/lib/dates";
import { requireSession } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import { getMessSettings } from "@/server/queries";

const settingsSchema = z.object({
  hostelName: z.string().trim().min(1, "Hostel name is required").max(200),
  address: z.string().trim().min(1, "Address is required").max(400),
  ramadanMode: z.boolean().default(false),
  soloElectricityMultiplier: z.coerce
    .number()
    .int()
    .min(1, "Must be at least 1")
    .max(10)
    .default(2),
  /**
   * The optional solo wifi multiplier. 1 means a solo member pays the single
   * wifi share (the mess default); 2 charges them double, matching electricity.
   */
  soloWifiMultiplier: z.coerce.number().int().min(1).max(10).default(1),
});

export async function updateMessSettings(
  input: z.infer<typeof settingsSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid settings"));

  const values = {
    id: 1,
    hostelName: parsed.data.hostelName,
    address: parsed.data.address,
    ramadanMode: parsed.data.ramadanMode,
    soloElectricityMultiplier: parsed.data.soloElectricityMultiplier,
    soloWifiMultiplier: parsed.data.soloWifiMultiplier,
    updatedAt: new Date(),
  };

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(messSettings)
        .values(values)
        .onConflictDoUpdate({
          target: messSettings.id,
          set: values,
        });

      await recordAudit(
        {
          actor,
          action: "settings.update",
          entityType: "settings",
          entityId: "mess",
          summary:
            `Updated mess settings — Ramadan ${parsed.data.ramadanMode ? "on" : "off"}, ` +
            `solo electricity ×${parsed.data.soloElectricityMultiplier}, ` +
            `solo wifi ×${parsed.data.soloWifiMultiplier}`,
          detail: {
            ramadanMode: parsed.data.ramadanMode,
            soloElectricityMultiplier: parsed.data.soloElectricityMultiplier,
            soloWifiMultiplier: parsed.data.soloWifiMultiplier,
          },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the settings"));
  }

  refresh();
  return ok("Settings saved");
}

const stickySchema = z.object({
  /** Empty string turns carry-forward off. */
  stickyFrom: z.string().trim(),
});

/**
 * Turns guest carry-forward on or off, from the date given.
 *
 * Deliberately its own action rather than a field on the main settings form:
 * that form upserts the whole settings row, so a field added there would be
 * reset to null by any ordinary save of hostel name or wifi multiplier. This
 * switch decides how money is calculated, and it should only move when somebody
 * deliberately moves it.
 */
export async function setStickyGuestMeals(
  input: z.infer<typeof stickySchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  const parsed = stickySchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid date"));

  const raw = parsed.data.stickyFrom.trim();
  let value: string | null = null;
  if (raw !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return fail("Pick a valid date, or leave it empty to turn this off.");
    }
    if (raw > todayKey()) {
      return fail("The start date cannot be in the future.");
    }
    value = raw;
  }

  try {
    const before = await getMessSettings();
    if ((before?.stickyGuestMealsFrom ?? null) === value) {
      return ok(value ? `Guests carry forward from ${value}.` : "Guest carry-forward is off.");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(messSettings)
        .set({ stickyGuestMealsFrom: value, updatedAt: new Date() })
        .where(eq(messSettings.id, 1));

      await recordAudit(
        {
          actor,
          action: "settings.guestSticky",
          entityType: "settings",
          entityId: "mess",
          summary: value
            ? `Guest meals now carry forward from ${value}`
            : "Guest meal carry-forward turned off",
          detail: {
            from: before?.stickyGuestMealsFrom ?? null,
            to: value,
          },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not save"));
  }

  refresh();
  return ok(
    value
      ? `Guests carry forward from ${value}. Earlier days are untouched.`
      : "Guest carry-forward is off. Guests reset to zero each day again.",
  );
}
