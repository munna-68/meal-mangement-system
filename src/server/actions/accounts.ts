"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { accounts } from "@/db/schema";
import { fail, firstIssue, ok, type ActionResult } from "@/lib/action-result";
import { hashPassword, passwordProblem } from "@/lib/password";
import { requireSession } from "@/server/auth";
import { recordAudit } from "@/server/audit";

/**
 * Account management. Only an OWNER may create or change sign-ins, so a
 * manager cannot quietly add themselves a second identity or reset somebody
 * else's password.
 */

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters")
  .max(60)
  .regex(/^[a-z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores only");

const createSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1, "Give the account a name").max(120),
  role: z.enum(["OWNER", "MANAGER"]).default("MANAGER"),
  password: z.string().min(1, "Set a password"),
});

const updateSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(1, "Give the account a name").max(120),
  role: z.enum(["OWNER", "MANAGER"]),
  active: z.boolean(),
});

const passwordSchema = z.object({
  id: z.string().min(1),
  password: z.string().min(1, "Set a password"),
});

const idSchema = z.object({ id: z.string().min(1) });

/** How many active owners are left, ignoring one account. */
async function activeOwnerCount(excludeId?: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts)
    .where(
      excludeId
        ? and(
            eq(accounts.role, "OWNER"),
            eq(accounts.active, true),
            ne(accounts.id, excludeId),
          )
        : and(eq(accounts.role, "OWNER"), eq(accounts.active, true)),
    );
  return row?.count ?? 0;
}

export async function createAccount(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  if (actor.role !== "OWNER") {
    return fail("Only the owner account can add sign-ins.");
  }

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid account"));
  const data = parsed.data;

  const problem = passwordProblem(data.password);
  if (problem) return fail(problem);

  try {
    const passwordHash = await hashPassword(data.password);

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(accounts)
        .values({
          username: data.username,
          displayName: data.displayName,
          role: data.role,
          passwordHash,
        })
        .returning({ id: accounts.id });

      await recordAudit(
        {
          actor,
          action: "account.create",
          entityType: "account",
          entityId: created?.id ?? data.username,
          summary: `Created the ${data.role.toLowerCase()} sign-in "${data.username}" for ${data.displayName}`,
          detail: { username: data.username, role: data.role },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(
      firstIssue(error, "Could not create the account (is that username taken?)"),
    );
  }

  refresh();
  return ok("Sign-in created");
}

export async function updateAccount(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  if (actor.role !== "OWNER") {
    return fail("Only the owner account can change sign-ins.");
  }

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid account"));
  const data = parsed.data;

  try {
    const [existing] = await db
      .select({
        username: accounts.username,
        role: accounts.role,
        active: accounts.active,
      })
      .from(accounts)
      .where(eq(accounts.id, data.id))
      .limit(1);
    if (!existing) return fail("That account no longer exists.");

    // Never let the last way in be removed.
    const losingOwner =
      existing.role === "OWNER" &&
      existing.active &&
      (data.role !== "OWNER" || !data.active);
    if (losingOwner && (await activeOwnerCount(data.id)) === 0) {
      return fail(
        "This is the last active owner. Make another account an owner first, or you would lock everybody out.",
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({
          displayName: data.displayName,
          role: data.role,
          active: data.active,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, data.id));

      await recordAudit(
        {
          actor,
          action: "account.update",
          entityType: "account",
          entityId: data.id,
          summary:
            `Updated the sign-in "${existing.username}" — ${data.role.toLowerCase()}, ` +
            `${data.active ? "active" : "deactivated"}`,
          detail: { role: data.role, active: data.active },
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not update the account"));
  }

  refresh();
  return ok("Sign-in updated");
}

export async function resetAccountPassword(
  input: z.infer<typeof passwordSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  if (actor.role !== "OWNER") {
    return fail("Only the owner account can reset passwords.");
  }

  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid password"));
  const data = parsed.data;

  const problem = passwordProblem(data.password);
  if (problem) return fail(problem);

  try {
    const [existing] = await db
      .select({ username: accounts.username })
      .from(accounts)
      .where(eq(accounts.id, data.id))
      .limit(1);
    if (!existing) return fail("That account no longer exists.");

    const passwordHash = await hashPassword(data.password);

    await db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({
          passwordHash,
          // A reset is also the way out of a lockout.
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, data.id));

      await recordAudit(
        {
          actor,
          action: "account.password",
          entityType: "account",
          entityId: data.id,
          summary: `Reset the password for "${existing.username}"`,
          detail: null,
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not reset the password"));
  }

  refresh();
  return ok("Password reset");
}

export async function unlockAccount(
  input: z.infer<typeof idSchema>,
): Promise<ActionResult> {
  const actor = await requireSession();
  if (actor.role !== "OWNER") {
    return fail("Only the owner account can unlock sign-ins.");
  }

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return fail(firstIssue(parsed.error, "Invalid account"));

  try {
    const [existing] = await db
      .select({ username: accounts.username })
      .from(accounts)
      .where(eq(accounts.id, parsed.data.id))
      .limit(1);
    if (!existing) return fail("That account no longer exists.");

    await db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(accounts.id, parsed.data.id));

      await recordAudit(
        {
          actor,
          action: "account.unlock",
          entityType: "account",
          entityId: parsed.data.id,
          summary: `Unlocked the sign-in "${existing.username}"`,
          detail: null,
        },
        tx,
      );
    });
  } catch (error) {
    return fail(firstIssue(error, "Could not unlock the account"));
  }

  refresh();
  return ok("Sign-in unlocked");
}
