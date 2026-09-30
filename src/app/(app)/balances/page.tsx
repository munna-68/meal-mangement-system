import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, ShieldCheckIcon } from "lucide-react";

import { cn } from "cn";

import { BalanceSheet } from "@/components/balance-sheet";
import { PageHeader, SectionCard, Stat } from "@/components/page-header";
import { PdfButton } from "@/components/pdf-button";
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
    openingBalances: snapshot.openingBalances,
    lastClosedMonth: snapshot.lastClosedMonth,
    ramadanMode: snapshot.settings.ramadanMode,
    soloElectricityMultiplier: snapshot.settings.soloElectricityMultiplier,
    soloWifiMultiplier: snapshot.settings.soloWifiMultiplier,
    today: snapshot.today,
  });

  // Every member is listed, including one who has since left: their share of the
  // cost is still theirs, so hiding the row would quietly remove it from the
  // column and leave the totals disagreeing with the sum of the rows above them.
  // Left members are dimmed instead, and they appear in the PDF too.
  const rows = result.rows;

  const activeRows = rows.filter((row) => row.active);
  const leftCount = rows.length - activeRows.length;

  // The opening figure comes from a manager-declared opening balance for the
  // first open month when one is set, and otherwise from the last closed
  // month's closing balance. Say which, rather than always claiming a carry.
  const declaredOpeningMonth = result.periodStart.slice(0, 7);
  const hasDeclaredOpening = snapshot.openingBalances.some(
    (opening) => opening.month === declaredOpeningMonth,
  );
  const openingHint = hasDeclaredOpening
    ? snapshot.lastClosedMonth
      ? `set by hand, overriding ${snapshot.lastClosedMonth}`
      : "set by hand for the first month"
    : snapshot.lastClosedMonth
      ? `carried from ${snapshot.lastClosedMonth}`
      : "no closed month to carry from yet";

  return (
    <>
      <PageHeader
        title="Balance Dashboard"
        description={`Live position for ${formatDisplay(result.periodStart)} → ${formatDisplay(
          result.periodEnd,
        )}${snapshot.lastClosedMonth ? ` · after closing ${snapshot.lastClosedMonth}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PdfButton
              targetId="balance-sheet"
              fileName={`balances-${today}.pdf`}
              label="Download balances"
              format="a4"
              orientation="portrait"
            />
            <PdfButton
              targetId="balance-sheet"
              fileName={`balances-${today}.pdf`}
              label="Share balances"
              format="a4"
              orientation="portrait"
              mode="share"
              variant="outline"
            />
          </div>
        }
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
          label="Accrued cost"
          value={formatTaka(result.summary.cost)}
          hint="meals + Khala + bills + Extra, accrued to date"
        />
        <Stat
          label={hasDeclaredOpening ? "Opening balance set" : "Opening carried in"}
          value={formatTaka(result.summary.openingBalance)}
          hint={openingHint}
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
                <th className="px-3 py-2 text-right font-medium">Khala+Wifi+Electricity</th>
                <th className="px-3 py-2 text-right font-medium">Extras share</th>
                <th className="px-3 py-2 text-right font-medium">Total cost</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const negative = row.balance < 0;
                return (
                  <tr
                    key={row.memberId}
                    className={cn(
                      "border-t",
                      negative && "bg-red-50/70 hover:bg-red-50",
                      !row.active && "text-muted-foreground",
                    )}
                  >
                    <td className="px-3 py-2 tabular-nums">{row.roomNumber}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.memberName}</span>
                        {!row.active ? (
                          <Badge variant="secondary">Left</Badge>
                        ) : null}
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
                      {formatTaka(row.utilityCost)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTaka(row.extraCost)}
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
                  {formatTaka(result.summary.utilityCost)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatTaka(result.summary.extraCost)}
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
        Meals and guest meals are counted day by day. Khala, electricity and wifi
        are flat monthly charges: every member of a month pays the whole of them,
        whoever joined late or left early, so these figures do not move during
        the month and Balances always agrees with Settlement.
        {leftCount > 0
          ? ` ${leftCount} member${leftCount === 1 ? "" : "s"} who have left are still listed and still counted in the totals.`
          : ""}{" "}
        <Link href="/settlement" className="underline">
          Close the month
        </Link>{" "}
        to lock these figures.
      </p>

      {/* Off-screen copy used to build the PDF. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: -10000,
          top: 0,
          pointerEvents: "none",
          zIndex: -1,
        }}
      >
        <div id="balance-sheet">
          <BalanceSheet
            hostelName={snapshot.settings.hostelName}
            address={snapshot.settings.address}
            periodStart={result.periodStart}
            periodEnd={result.periodEnd}
            generatedOn={today}
            rows={rows.map((row) => ({
              memberId: row.memberId,
              roomNumber: row.roomNumber,
              memberName: row.memberName,
              openingBalance: row.openingBalance,
              deposits: row.deposits,
              utilityCost: row.utilityCost,
              extraCost: row.extraCost,
              cost: row.cost,
              balance: row.balance,
              active: row.active,
            }))}
            summary={result.summary}
          />
        </div>
      </div>
    </>
  );
}
