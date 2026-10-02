import type { Metadata } from "next";

import { AlertTriangleIcon } from "lucide-react";

import { LedgerSheet, type LedgerRowView } from "@/components/ledger-sheet";
import { MealRegisterSheet } from "@/components/meal-register-sheet";
import { PageHeader, Stat } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  apportionKhala,
  buildSettlementRows,
  computeMonth,
  mealChargeGate,
  mealRegisterForMonth,
  rateCardFor,
  unconfirmedChargeableDays,
  type RegisterSnapshot,
} from "@/lib/calc";
import {
  addMonths,
  currentMonthKey,
  daysInMonth,
  formatBengaliMonth,
  formatMonthLongDisplay,
  isValidMonthKey,
  monthEnd,
  monthStart,
} from "@/lib/dates";
import { closedMonthSet, laterClosedMonthsFor, monthsWithActivity, openingBalancesFor, requiredPrecedingClose } from "@/lib/locks";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { ensureAutoExtrasForMonth } from "@/server/auto-extras";
import {
  getAllConfirmedBazarDates,
  getClosedMonths,
  getMonthClose,
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
  const closedSet = closedMonthSet(closedMonths);
  const laterClosedMonths = laterClosedMonthsFor(month, closedSet);

  if (!isClosed && month <= currentMonthKey()) {
    try {
      await ensureAutoExtrasForMonth(month);
    } catch {
      // Preview only; a write failure should not blank the page.
    }
  }

  const snapshot = await loadLedgerSnapshot();

  // Khala is charged only on what has been paid, so a month closed with khala
  // still outstanding is billed short. Say so rather than letting the shortfall
  // quietly become nobody's cost.
  const khalaStanding = apportionKhala({
    members: snapshot.members,
    rooms: snapshot.rooms,
    payments: snapshot.khalaPayments,
    from: monthStart(month),
    to: monthEnd(month),
    rateCard: rateCardFor(snapshot.rateCards, monthStart(month)),
    today: snapshot.today,
  });

  // Months must be closed in order, because a month's opening balance is the
  // previous month's closing balance. Work out up front whether this one can be
  // closed, so the reason is shown before the user clicks rather than after.
  let closeBlock: string | null = null;
  if (!isClosed) {
    if (month >= currentMonthKey()) {
      // Closing a running month would freeze it part-way and lock out the rest
      // of it, so the button is disabled with the reason shown up front.
      closeBlock =
        `${formatMonthLongDisplay(month)} is still running. Close it once the ` +
        `month is over and every day has been confirmed — closing it now would ` +
        `lock the days that have not happened yet.`;
    } else if (laterClosedMonths.length > 0) {
      closeBlock =
        `${formatMonthLongDisplay(laterClosedMonths[0])} is already closed. Reopen it first — ` +
        `closing ${formatMonthLongDisplay(month)} now would leave it holding figures ` +
        `based on the old balance.`;
    } else {
      const blocker = requiredPrecedingClose({
        month,
        closedMonths: closedSet,
        activityMonths: monthsWithActivity({
          changes: snapshot.changes,
          guestMeals: snapshot.guestMeals,
          deposits: snapshot.deposits,
          extras: snapshot.extras,
          bills: snapshot.bills,
      khalaPayments: snapshot.khalaPayments,
          bazarDates: await getAllConfirmedBazarDates(),
        }),
      });
      if (blocker) {
        closeBlock =
          `${formatMonthLongDisplay(blocker)} is not closed yet. Close it first — ` +
          `${formatMonthLongDisplay(month)}'s opening balances come from the month ` +
          `before it, so closing this one now would skip it and understate what ` +
          `members owe.`;
      }
    }
  }

  let rows: LedgerRowView[];
  let totals: {
    utility: number;
    extra: number;
    cost: number;
    deposits: number;
    available: number;
    closing: number;
  };

  if (isClosed) {
    // A closed month reads only frozen data: the stored settlement rows and the
    // stored register. Nothing here is recomputed from live tables, so the
    // ledger PDF and the register PDF on this page can never disagree.
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
      utility: rows.reduce((total, row) => total + row.khalaElecWifiAmount, 0),
      extra: rows.reduce((total, row) => total + row.extraAmount, 0),
      cost: rows.reduce((total, row) => total + row.totalCost, 0),
      deposits: rows.reduce((total, row) => total + row.newDeposits, 0),
      available: rows.reduce((total, row) => total + row.availableBalance, 0),
      closing: rows.reduce((total, row) => total + row.closingBalance, 0),
    };
  } else {
    const computation = computeMonth({
      month,
      cutoff: monthEnd(month),
      // Match what closing the month would store: the flat monthly charges are
      // billed in full, so the preview and the frozen figures agree.
      finalize: true,
      members: snapshot.members,
      rooms: snapshot.rooms,
      changes: snapshot.changes,
      guestMeals: snapshot.guestMeals,
      extras: snapshot.extras,
      bills: snapshot.bills,
      khalaPayments: snapshot.khalaPayments,
      rateCards: snapshot.rateCards,
      ramadanMode: snapshot.settings.ramadanMode,
      soloElectricityMultiplier: snapshot.settings.soloElectricityMultiplier,
      soloWifiMultiplier: snapshot.settings.soloWifiMultiplier,
      today: snapshot.today,
    });

    // Opening balances come from a manager-declared opening balance for this
    // month when one exists, otherwise the immediately preceding closed month's
    // closing balance — matching exactly what closing this month will store.
    const openingBalances = openingBalancesFor({
      month,
      closedMonths: closedSet,
      settlements: snapshot.settlements,
      openingBalances: snapshot.openingBalances,
    });

    const preview = buildSettlementRows({
      computation,
      members: snapshot.members,
      rooms: snapshot.rooms,
      deposits: snapshot.deposits,
      deductions: snapshot.deductions,
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
      utility: rows.reduce((total, row) => total + row.khalaElecWifiAmount, 0),
      extra: rows.reduce((total, row) => total + row.extraAmount, 0),
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

  // The register shown next to the ledger always comes from the same source as
  // the ledger itself: frozen for a closed month, live only while it is open.
  let register: RegisterSnapshot;
  let registerMissing = false;

  if (isClosed) {
    const close = await getMonthClose(month);
    if (close?.registerSnapshot) {
      register = close.registerSnapshot;
    } else {
      register = { days: daysInMonth(month), rows: [] };
      registerMissing = true;
    }
  } else {
    const live = mealRegisterForMonth({
      month,
      cutoff: monthEnd(month),
      members: snapshot.members,
      rooms: snapshot.rooms,
      changes: snapshot.changes,
      today: snapshot.today,
    });
    register = { days: live.days, rows: live.rows };
  }

  // Days that had meals but no confirmed bazar, so they were never charged.
  // Closing the month freezes that for good, so the manager is warned first.
  const skippedDays = unconfirmedChargeableDays({
    gate: mealChargeGate(snapshot.settings, snapshot.confirmedBazarDates),
    members: snapshot.members,
    changes: snapshot.changes,
    guestMeals: snapshot.guestMeals,
    from: monthStart(month),
    to: monthEnd(month),
    today: snapshot.today,
  });

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
        laterClosedMonths={laterClosedMonths}
        closeBlock={closeBlock}
        memberCount={rows.length}
        totalCost={totals.cost}
        totalDeposits={totals.deposits}
        totalClosing={totals.closing}
        skippedDays={isClosed ? [] : skippedDays}
      />

      {!isClosed && khalaStanding && khalaStanding.outstanding > 0 ? (
        <Alert className="mt-4 border-amber-300 bg-amber-50/70">
          <AlertTriangleIcon className="text-amber-700" />
          <AlertTitle>
            {formatTaka(khalaStanding.outstanding)} of khala is still unpaid
          </AlertTitle>
          <AlertDescription className="text-xs">
            Only the {formatTaka(khalaStanding.totalPaid)} actually paid out of{" "}
            {formatTaka(khalaStanding.monthlyTarget)} is in these figures. Close the
            month as it stands and the unpaid remainder is not billed to anyone —
            log it on the Extras &amp; Bills page first if it should be carried
            into this month.
          </AlertDescription>
        </Alert>
      ) : null}

      {closeBlock ? (
        <Alert className="mt-4 border-amber-300 bg-amber-50/70">
          <AlertTriangleIcon className="text-amber-700" />
          <AlertTitle>This month cannot be closed yet</AlertTitle>
          <AlertDescription className="text-xs">{closeBlock}</AlertDescription>
        </Alert>
      ) : null}

      {registerMissing ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangleIcon />
          <AlertTitle>No frozen register for this month</AlertTitle>
          <AlertDescription className="text-xs">
            This month was closed before the register was stored with the
            settlement, so there is nothing to print. Reopen the month and close
            it again to freeze the register.
          </AlertDescription>
        </Alert>
      ) : null}

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
              <th className="px-3 py-2 text-right font-medium">
                Khala paid+Wifi+Electricity
              </th>
              <th className="px-3 py-2 text-right font-medium">Extras share</th>
              <th className="px-3 py-2 text-right font-medium">Total cost</th>
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
              <td className="px-3 py-2" colSpan={ramadanMode ? 6 : 5}>
                Totals
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatTaka(totals.utility)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatTaka(totals.extra)}
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
            isClosed={isClosed}
            rows={rows}
            ramadanMode={ramadanMode}
          />
        </div>

        <div id="meal-register-sheet" style={{ marginTop: 24 }}>
          <MealRegisterSheet
            hostelName={snapshot.settings.hostelName}
            address={snapshot.settings.address}
            month={month}
            days={register.days}
            rows={register.rows}
          />
        </div>
      </div>
    </>
  );
}
