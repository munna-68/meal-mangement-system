/**
 * Append-only audit trail for money-related changes.
 *
 * Every write that can move a balance calls `recordAudit`, usually inside the
 * same transaction as the change itself, so a change and its record either both
 * land or neither does. `actorName` is copied in so the trail stays readable
 * even if the account is later removed.
 */

import { desc } from "drizzle-orm";

import { db, type Executor } from "@/db";
import { auditLog } from "@/db/schema";
import type { SessionUser } from "@/lib/session";

export interface AuditEntry {
  actor: SessionUser;
  /** Short machine-readable verb, e.g. `deposit.create`. */
  action: string;
  /** What kind of record was touched, e.g. `deposit`. */
  entityType: string;
  entityId?: string | null;
  /** One line a human can read in the audit screen. */
  summary: string;
  detail?: Record<string, unknown> | null;
}

export async function recordAudit(
  entry: AuditEntry,
  executor: Executor = db,
): Promise<void> {
  await executor.insert(auditLog).values({
    accountId: entry.actor.accountId,
    actorName: entry.actor.displayName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    detail: entry.detail ?? null,
  });
}

export interface AuditRow {
  id: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
}

export async function getRecentAuditEntries(limit = 200): Promise<AuditRow[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      actorName: auditLog.actorName,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      summary: auditLog.summary,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    detail: (row.detail as Record<string, unknown> | null) ?? null,
  }));
}
