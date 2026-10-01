import type { Metadata } from "next";
import { HistoryIcon } from "lucide-react";

import { PageHeader, SectionCard } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/dates";
import { requireSession } from "@/server/auth";
import { getRecentAuditEntries } from "@/server/audit";

export const metadata: Metadata = { title: "Audit Log" };

/** Actions that moved money get a louder badge than routine edits. */
const MONEY_ACTIONS = new Set([
  "bazar.confirm",
  "deposit.create",
  "deposit.delete",
  "deduction.create",
  "deduction.delete",
  "bill.save",
  "bill.delete",
  "extra.create",
  "extra.update",
  "extra.delete",
  "rate.create",
  "rate.update",
  "rate.delete",
  "month.close",
  "month.reopen",
  "member.delete",
]);

function actionTone(action: string): "default" | "secondary" | "destructive" {
  if (action === "month.reopen" || action === "member.delete") return "destructive";
  if (MONEY_ACTIONS.has(action)) return "default";
  return "secondary";
}

export default async function AuditPage() {
  await requireSession();
  const entries = await getRecentAuditEntries(300);

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Who changed what, and when. Newest first — the last 300 entries."
      />

      <SectionCard
        title="Recent changes"
        description="Every change that can move a balance is recorded against the account that made it."
        contentClassName="p-0"
      >
        {entries.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <HistoryIcon className="size-4" />
            Nothing recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Who</th>
                  <th className="px-3 py-2 text-left font-medium">Action</th>
                  <th className="px-3 py-2 text-left font-medium">What changed</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                      {formatTimestamp(entry.createdAt)}
                    </td>
                    <td className="px-3 py-2 font-medium">{entry.actorName}</td>
                    <td className="px-3 py-2">
                      <Badge variant={actionTone(entry.action)} className="font-mono text-[11px]">
                        {entry.action}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">{entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <p className="mt-3 text-xs text-muted-foreground">
        Entries are append-only. Deleting an account leaves its past entries
        intact, showing the name the account had at the time.
      </p>
    </>
  );
}
