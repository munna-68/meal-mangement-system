import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, ShieldCheckIcon } from "lucide-react";

import { cn } from "cn";

import { PageHeader, SectionCard, Stat } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { computeRunningBalances } from "@/lib/calc";
import {
  addDays,
  formatDisplay,
  monthEnd,
  monthOf,
  monthStart,
  todayKey,
} from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { ensureAutoExtrasForRange } from "@/server/auto-extras";
import {
  getEarliestActivityDate,
  getLastClosedMonth,
  loadLedgerSnapshot,
} from "@/server/queries";

export const metadata: Metadata = { title: "Balances" };

export default async function BalancesPage() {
  await requireSession();

  const today = todayKey();
  const lastClosed = await getLastClosedMonth();
  const earliestActivity = await getEarliestActivityDate();

  // Make sure every recurring daily cost in the open period exists, otherwise
  // the month-to-date figure would understate what members owe.
  const periodStart = lastClosed
    ? addDays(monthEnd(lastClosed), 1)
    : monthStart(monthOf(earliestActivity ?? today));
  try {
    await ensureAutoExtrasForRange(periodStart, today);
  } catch {
    // Non-fatal: show the balance with whatever is already recorded.
  }

  const snapshot = await loadLedgerSnapshot();

  const result = computeRunningBalances({
    members: snapshot.members,
    rooms: snapshot.rooms,
    changes: snapshot.changes,
    guestMeals: snapshot.guestMeals,
    extras: snapshot.extras,
    bills: snapshot.bills,
    rateCards: snapshot.rateCards,
    deposits: snapshot.deposits,
    settlements: snapshot.settlements,
    lastClosedMonth: snapshot.lastClosedMonth,
    ramadanMode: snapshot.settings.ramadanMode,
    today: snapshot.today,
  });

  const activeRows = result.rows.filter((row) => row.active);

  return (
    <>
      <PageHeader
        title="Balance Dashboard"
        description={`Live position for ${formatDisplay(result.periodStart)} → ${formatDisplay(
          result.periodEnd,
        )}${snapshot.lastClosedMonth ? ` · after closing ${snapshot.lastClosedMonth}` : ""}`}
      />

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat
          label="Mess float"
          value={formatTaka(result.summary.balance)}
          tone={result.summary.balance < 0 ? "negative" : "positive"}
          hint="deposits held minus costs so far"
        />
        <Stat
          label="Deposits in period"
          value={formatTaka(result.summary.deposits)}
        />
        <Stat
          label="Cost to date"
          value={formatTaka(result.summary.cost)}
          hint="meals + Khala + bills + Extra"
        />
        <Stat
          label="Opening carried in"
          value={formatTaka(result.summary.openingBalance)}
          hint="from the last closed month"
        />
      </div>

      {result.summary.membersInDeficit > 0 ? (
        <Alert variant="destructive" className="mb-4 border-2">
          <AlertTriangleIcon />
          <AlertTitle>
            {result.summary.membersInDeficit} member
            {result.summary.membersInDeficit > 1 ? "s are" : " is"} in deficit —{" "}
            {formatTaka(result.summary.totalDeficit)} outstanding
          </AlertTitle>
          <AlertDescription>
            Their deposits no longer cover what they have eaten and shared this
            period. Rows below are highlighted.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="mb-4 border-emerald-300 bg-emerald-50">
          <ShieldCheckIcon className="text-emerald-700" />
          <AlertTitle className="text-emerald-900">
            Every member is in credit
          </AlertTitle>
          <AlertDescription className="text-emerald-800">
            Total credit standing at {formatTaka(result.summary.totalCredit)}.
          </AlertDescription>
        </Alert>
      )}

      <SectionCard
        title="Per member"
        description="Running balance = opening + deposits − month-to-date cost."
        contentClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Room</th>
                <th className="px-3 py-2 text-left font-medium">Member</th>
                <th className="px-3 py-2 text-right font-medium">Opening</th>
                <th className="px-3 py-2 text-right font-medium">Deposits</th>
                <th className="px-3 py-2 text-right font-medium">Cost to date</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.map((row) => {
                const negative = row.balance < 0;
                return (
                  <tr
                    key={row.memberId}
                    className={cn(
                      "border-t",
                      negative && "bg-red-50/70 hover:bg-red-50",
                    )}
                  >
                    <td className="px-3 py-2 tabular-nums">{row.roomNumber}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.memberName}</span>
                        {negative ? (
                          <Badge
                            variant="destructive"
                            className="gap-1 border-red-600 bg-red-600 text-white"
                          >
                            <AlertTriangleIcon className="size-3" />
                            Deficit
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTaka(row.openingBalance)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTaka(row.deposits)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTaka(row.cost)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-semibold tabular-nums",
                        negative ? "text-red-700" : "text-emerald-700",
                      )}
                    >
                      {formatTaka(row.balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 bg-muted/40 font-semibold">
              <tr>
                <td className="px-3 py-2" colSpan={2}>
                  Totals
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatTaka(result.summary.openingBalance)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatTaka(result.summary.deposits)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatTaka(result.summary.cost)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    result.summary.balance < 0 && "text-red-700",
                  )}
                >
                  {formatTaka(result.summary.balance)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </SectionCard>

      <p className="mt-3 text-xs text-muted-foreground">
        Meal costs accrue day by day. Month-level charges (Khala, electricity,
        wifi and the Extra pool) are billed in full for the in-progress month.{" "}
        <Link href="/settlement" className="underline">
          Close the month
        </Link>{" "}
        to lock these figures.
      </p>
    </>
  );
}
