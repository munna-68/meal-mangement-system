"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { messSettings } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { requireSession } from "@/server/auth";

const settingsSchema = z.object({
  hostelName: z.string().trim().min(1, "Hostel name is required").max(200),
  address: z.string().trim().min(1, "Address is required").max(400),
  ramadanMode: z.boolean().default(false),
});

export async function updateMessSettings(
  input: z.infer<typeof settingsSchema>,
): Promise<ActionResult> {
  await requireSession();
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid settings"));

  try {
    await db
      .insert(messSettings)
      .values({
        id: 1,
        hostelName: parsed.data.hostelName,
        address: parsed.data.address,
        ramadanMode: parsed.data.ramadanMode,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: messSettings.id,
        set: {
          hostelName: parsed.data.hostelName,
          address: parsed.data.address,
          ramadanMode: parsed.data.ramadanMode,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the settings"));
  }

  refresh();
  return ok("Settings saved");
}
