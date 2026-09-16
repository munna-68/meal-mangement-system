import type { Metadata } from "next";

import { LedgerSheet, type LedgerRowView } from "@/components/ledger-sheet";
import { PageHeader, Stat } from "@/components/page-header";
import { buildSettlementRows, computeMonth } from "@/lib/calc";
import {
  addMonths,
  currentMonthKey,
  formatBengaliMonth,
  formatMonthLongDisplay,
  isValidMonthKey,
  monthEnd,
  monthStart,
} from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { ensureAutoExtrasForMonth } from "@/server/auto-extras";
import {
  getClosedMonths,
  getSettlementRowsForMonth,
  loadLedgerSnapshot,
} from "@/server/queries";
import { SettlementClient } from "./settlement-client";

export const metadata: Metadata = { title: "Monthly Settlement" };

export default async function SettlementPage(props: PageProps<"/settlement">) {
  await requireSession();

  const searchParams = await props.searchParams;
  const rawMonth =
    typeof searchParams.month === "string" ? searchParams.month : undefined;
  const month =
    rawMonth && isValidMonthKey(rawMonth) ? rawMonth : currentMonthKey();

  const closedMonths = await getClosedMonths();
  const isClosed = closedMonths.includes(month);

  if (!isClosed && month <= currentMonthKey()) {
    try {
      await ensureAutoExtrasForMonth(month);
    } catch {
      // Preview only; a write failure should not blank the page.
    }
  }

  const snapshot = await loadLedgerSnapshot();

  let rows: LedgerRowView[];
  let totals: {
    cost: number;
    deposits: number;
    available: number;
    closing: number;
  };

  if (isClosed) {
    const stored = await getSettlementRowsForMonth(month);
    rows = stored.map((row) => ({
      memberId: row.memberId,
      roomNumber: row.roomNumber,
      memberName: row.memberName,
      fullMealCount: row.fullMealCount,
      halfMealCount: row.halfMealCount,
      sehriCount: row.sehriCount,
      guestFullCount: row.guestFullCount,
      guestHalfCount: row.guestHalfCount,
      khalaElecWifiAmount: row.khalaElecWifiAmount,
      extraAmount: row.extraAmount,
      totalCost: row.totalCost,
      openingBalance: row.openingBalance,
      newDeposits: row.newDeposits,
      availableBalance: row.availableBalance,
      closingBalance: row.closingBalance,
    }));
    totals = {
      cost: rows.reduce((total, row) => total + row.totalCost, 0),
      deposits: rows.reduce((total, row) => total + row.newDeposits, 0),
      available: rows.reduce((total, row) => total + row.availableBalance, 0),
      closing: rows.reduce((total, row) => total + row.closingBalance, 0),
    };
  } else {
    const computation = computeMonth({
      month,
      cutoff: monthEnd(month),
      members: snapshot.members,
      rooms: snapshot.rooms,
      changes: snapshot.changes,
      guestMeals: snapshot.guestMeals,
      extras: snapshot.extras,
      bills: snapshot.bills,
      rateCards: snapshot.rateCards,
      ramadanMode: snapshot.settings.ramadanMode,
      today: snapshot.today,
    });

    const openingBalances = new Map<string, number>();
    const prior = snapshot.settlements
      .filter((settlement) => settlement.month < month)
      .sort((a, b) => (a.month < b.month ? 1 : -1));
    for (const settlement of prior) {
      if (!openingBalances.has(settlement.memberId)) {
        openingBalances.set(settlement.memberId, settlement.closingBalance);
      }
    }

    const preview = buildSettlementRows({
      computation,
      members: snapshot.members,
      rooms: snapshot.rooms,
      deposits: snapshot.deposits,
      openingBalances,
    });

    rows = preview.map((row) => ({
      memberId: row.memberId,
      roomNumber: row.roomNumber,
      memberName: row.memberName,
      fullMealCount: row.fullMealCount,
      halfMealCount: row.halfMealCount,
      sehriCount: row.sehriCount,
      guestFullCount: row.guestFullCount,
      guestHalfCount: row.guestHalfCount,
      khalaElecWifiAmount: row.khalaElecWifiAmount,
      extraAmount: row.extraAmount,
      totalCost: row.totalCost,
      openingBalance: row.openingBalance,
      newDeposits: row.newDeposits,
      availableBalance: row.availableBalance,
      closingBalance: row.closingBalance,
    }));

    totals = {
      cost: computation.totals.totalCost,
      deposits: rows.reduce((total, row) => total + row.newDeposits, 0),
      available: rows.reduce((total, row) => total + row.availableBalance, 0),
      closing: rows.reduce((total, row) => total + row.closingBalance, 0),
    };
  }

  const monthOptions = Array.from(
    new Set([
      month,
      ...closedMonths,
      ...Array.from({ length: 12 }, (_, index) => addMonths(currentMonthKey(), -index)),
    ]),
  ).sort((a, b) => (a < b ? 1 : -1));

  const ramadanMode = snapshot.settings.ramadanMode;

  return (
    <>
      <PageHeader
        title="Monthly Settlement"
        description={formatMonthLongDisplay(month)}
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Members" value={rows.length} />
        <Stat
          label="Total cost"
          value={formatTaka(totals.cost)}
          hint={`${formatMonthLongDisplay(month)}`}
        />
        <Stat label="Deposits this month" value={formatTaka(totals.deposits)} />
        <Stat
          label="Closing carried forward"
          value={formatTaka(totals.closing)}
          tone={totals.closing < 0 ? "negative" : "positive"}
        />
      </div>

      <SettlementClient
        month={month}
        months={monthOptions}
        closed={isClosed}
        memberCount={rows.length}
        totalCost={totals.cost}
        totalDeposits={totals.deposits}
        totalClosing={totals.closing}
      />

      <div className="mt-5 overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Room</th>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Full</th>
              <th className="px-3 py-2 text-right font-medium">Half</th>
              {ramadanMode ? (
                <th className="px-3 py-2 text-right font-medium">Sehri</th>
              ) : null}
              <th className="px-3 py-2 text-right font-medium">Guest F/H</th>
              <th className="px-3 py-2 text-right font-medium">Kha+Wifi+Elec</th>
              <th className="px-3 py-2 text-right font-medium">Extra</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">Opening</th>
              <th className="px-3 py-2 text-right font-medium">Deposit</th>
              <th className="px-3 py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.memberId} className="border-t">
                <td className="px-3 py-2 tabular-nums">{row.roomNumber}</td>
                <td className="px-3 py-2 font-medium">{row.memberName}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.fullMealCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.halfMealCount}
                </td>
                {ramadanMode ? (
                  <td className="px-3 py-2 text-right tabular-nums">
                    {row.sehriCount}
                  </td>
                ) : null}
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.guestFullCount}/{row.guestHalfCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatTaka(row.khalaElecWifiAmount)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatTaka(row.extraAmount)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {formatTaka(row.totalCost)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatTaka(row.openingBalance)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatTaka(row.newDeposits)}
                </td>
                <td
                  className={
                    row.closingBalance < 0
                      ? "px-3 py-2 text-right font-semibold tabular-nums text-red-700"
                      : "px-3 py-2 text-right font-semibold tabular-nums text-emerald-700"
                  }
                >
                  {formatTaka(row.closingBalance)}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={ramadanMode ? 12 : 11}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No members were active in this month.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot className="border-t-2 bg-muted/40 font-semibold">
            <tr>
              <td className="px-3 py-2" colSpan={ramadanMode ? 8 : 7}>
                Totals
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatTaka(totals.cost)}
              </td>
              <td />
              <td className="px-3 py-2 text-right tabular-nums">
                {formatTaka(totals.deposits)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatTaka(totals.closing)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

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
        <div id="ledger-sheet">
          <LedgerSheet
            hostelName={snapshot.settings.hostelName}
            address={snapshot.settings.address}
            month={month}
            previousMonthLabel={`${formatBengaliMonth(addMonths(month, -1))} এর`}
            rows={rows}
            ramadanMode={ramadanMode}
          />
        </div>
      </div>
    </>
  );
}
