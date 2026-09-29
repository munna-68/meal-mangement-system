"use server";

import { refresh } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { deposits, openingBalances } from "@/db/schema";
import { fail, firstIssue, type ActionResult } from "@/lib/action-result";
import { isValidDateKey, isValidMonthKey, monthStart } from "@/lib/dates";
import { resolveMember } from "@/lib/import-csv";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import { monthLockError } from "@/server/month-lock";
import { openingMonthError } from "@/server/opening-guard";
import { getMembersWithRooms } from "@/server/queries";

/**
 * An empty string means "not supplied" (the field does not apply to this kind,
 * or the row carries no date of its own), so it is allowed through and the code
 * falls back to a default. A non-empty value must be a real month/date.
 */
const optionalMonth = z
  .union([
    z.literal(""),
    z.string().refine(isValidMonthKey, "Pick a valid month"),
  ])
  .default("");
const optionalDate = z
  .union([z.literal(""), z.string().refine(isValidDateKey, "Bad date")])
  .default("");

const rowSchema = z.object({
  // 1-based line in the pasted text, kept so skip messages point at the row.
  line: z.number().int().optional().default(0),
  name: z.string().trim().min(1, "No name"),
  room: z.string().trim().optional().default(""),
  amount: z.number().int("Whole taka only"),
  // Only meaningful for deposits; ignored when importing opening balances.
  date: optionalDate,
  notes: z.string().trim().max(300).optional().default(""),
});

const importSchema = z.object({
  kind: z.enum(["deposit", "opening"]),
  /** Required for `opening`; ignored for `deposit`. */
  month: optionalMonth,
  /** Fallback date for deposit rows that do not carry one. */
  date: optionalDate,
  rows: z.array(rowSchema).min(1, "Nothing to import").max(500, "Too many rows at once"),
});

export interface ImportIssue {
  line: number;
  name: string;
  reason: string;
}

export interface ImportResult extends ActionResult {
  importedCount?: number;
  issues?: ImportIssue[];
}

/**
 * Bulk-adds rows pasted from a CSV — either as deposits or as opening
 * balances.
 *
 * Member matching is done here, on the server, from the row's name (and room to
 * break a name tie). The client never supplies member ids, so a tampered paste
 * cannot attach a deposit to the wrong person. Rows whose name is unknown or
 * ambiguous are skipped and returned as issues; everything else is inserted in
 * one transaction, with a single audit entry summarising the batch.
 */
export async function bulkImportRows(
  input: z.input<typeof importSchema>,
): Promise<ImportResult> {
  const actor = await requireSession();
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Could not read the pasted rows"));

  const { kind, month, date: fallbackDate, rows } = parsed.data;

  let openingError: string | null = null;
  if (kind === "opening") {
    if (!month) return fail("Pick the month these opening balances belong to.");
    openingError = await openingMonthError(month);
    if (openingError) return fail(openingError);
  }

  const members = await getMembersWithRooms();
  const issues: ImportIssue[] = [];
  const resolved: Array<{ memberId: string; amount: number; date: string; notes: string; line: number }> = [];

  for (const row of rows) {
    const match = resolveMember(row.name, row.room, members);
    if (!match.ok) {
      issues.push({
        line: row.line ?? 0,
        name: row.name,
        reason:
          match.reason === "ambiguous"
            ? `matches ${match.candidates.length} members — add a room number`
            : "no member with that name",
      });
      continue;
    }

    if (kind === "deposit") {
      const date = row.date || fallbackDate;
      if (!date) {
        issues.push({
          line: row.line ?? 0,
          name: row.name,
          reason: "no date on the row and no default date given",
        });
        continue;
      }
      resolved.push({ memberId: match.id, amount: row.amount, date, notes: row.notes, line: row.line ?? 0 });
    } else {
      resolved.push({ memberId: match.id, amount: row.amount, date: "", notes: row.notes, line: row.line ?? 0 });
    }
  }

  if (kind === "deposit" && resolved.length > 0) {
    const locked = await monthLockError(resolved.map((row) => row.date));
    if (locked) return fail(locked);
  }

  if (resolved.length === 0) {
    return {
      ok: false,
      error: issues.length > 0 ? "No rows could be matched to a member." : "Nothing to import.",
      issues,
    };
  }

  try {
    await db.transaction(async (tx) => {
      if (kind === "deposit") {
        await tx.insert(deposits).values(
          resolved.map((row) => ({
            memberId: row.memberId,
            date: row.date,
            amount: row.amount,
            notes: row.notes || null,
          })),
        );
      } else {
        await tx
          .insert(openingBalances)
          .values(
            resolved.map((row) => ({
              month: monthStart(month),
              memberId: row.memberId,
              amount: row.amount,
              notes: row.notes || null,
            })),
          )
          .onConflictDoUpdate({
            target: [openingBalances.month, openingBalances.memberId],
            // `set` is a single object applied to every conflicting row, so take
            // each row's own new amount from `excluded` rather than a value
            // captured from the outer loop.
            set: { amount: sql`excluded.amount`, updatedAt: new Date() },
          });
      }

      const total = resolved.reduce((sum, row) => sum + row.amount, 0);
      await recordAudit(
        {
          actor,
          action: kind === "deposit" ? "deposit.bulk_import" : "opening_balance.bulk_import",
          entityType: kind === "deposit" ? "deposit" : "opening_balance",
          entityId: kind === "deposit" ? fallbackDate : month,
          summary:
            kind === "deposit"
              ? `Imported ${resolved.length} deposits from CSV (${formatTaka(total)})`
              : `Imported ${resolved.length} opening balances from CSV (${formatTaka(total)})`,
          detail: { count: resolved.length, total, issues },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not save the imported rows"));
  }

  refresh();

  const skipped = issues.length > 0 ? `, ${issues.length} skipped` : "";
  return {
    ok: true,
    message: `Imported ${resolved.length} ${kind === "deposit" ? "deposits" : "opening balances"}${skipped}`,
    importedCount: resolved.length,
    issues,
  };
}
