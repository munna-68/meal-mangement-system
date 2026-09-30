import type { Metadata } from "next";

import { PageHeader, Stat } from "@/components/page-header";
import {
  computeMonth,
  computeMonthlyFixedExtraSummary,
  isMemberActiveInRange,
  khalaAmountFor,
  occupancyForRange,
  rateCardFor,
  type MonthlyFixedExtraSummary,
} from "@/lib/calc";
import {
  addMonths,
  currentMonthKey,
  daysInMonth,
  isSameOrAfter,
  isSameOrBefore,
  monthEnd,
  monthOf,
  monthStart,
  todayKey,
} from "@/lib/dates";
import { formatTaka, sum } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { ensureAutoExtrasForMonth } from "@/server/auto-extras";
import {
  getAllConfirmedBazarDates,
  getExtras,
  getMembersWithRooms,
  getRateCards,
  getRooms,
  getUtilityBills,
} from "@/server/queries";
import {
  ExtrasClient,
  type BillRecord,
  type ExtraRecord,
  type MonthCostPoolSummary,
} from "./extras-client";

export const metadata: Metadata = { title: "Extras & Bills" };

const RECENT_LIMIT = 150;

export default async function ExtrasPage() {
  await requireSession();

  const now = currentMonthKey();
  // Ensure the current month's auto extras are materialized for any confirmed bazar days.
  await ensureAutoExtrasForMonth(now);

  const [extras, bills, members, rooms, rateCards, allConfirmed] =
    await Promise.all([
      getExtras(),
      getUtilityBills(),
      getMembersWithRooms(),
      getRooms(),
      getRateCards(),
      getAllConfirmedBazarDates(),
    ]);

  const confirmedSet = new Set(allConfirmed);
  const today = todayKey();

  // Safely exclude legacy/auto-created manager fee rows
  const safeExtras = extras.filter(
    (item) =>
      item.category !== "MANAGER_FEE" &&
      !item.sourceKey?.startsWith("auto:manager-fee:"),
  );

  const extraRecords: ExtraRecord[] = safeExtras
    .slice(0, RECENT_LIMIT)
    .map((item) => ({
      id: item.id,
      date: item.date,
      label: item.label,
      amount: item.amount,
      category: item.category,
      showInDailyBudget: item.showInDailyBudget,
      voided: item.voided,
      isAuto: item.isAuto,
    }));

  const months = Array.from({ length: 12 }, (_, index) => addMonths(now, -index));

  // Khala is set by the rate card, not typed in here: the normal rate for the
  // month, or the solo rate for somebody alone in a multi-bed room. A figure
  // typed into a "Khala bill" box would quietly change what every member is
  // charged, so there is no such box.
  const billRecords: BillRecord[] = months.map((month) => {
    const from = monthStart(month);
    const to = monthEnd(month);
    const card = rateCardFor(rateCards, from);
    const monthMembers = members.filter((m) =>
      isMemberActiveInRange(m, from, to, today),
    );
    const occupancy = occupancyForRange({ members, rooms, from, to, today });
    const khala = monthMembers.reduce(
      (total, m) => total + khalaAmountFor({ member: m, occupancy, rateCard: card }),
      0,
    );

    const elecBill = bills.find(
      (bill) => bill.month === month && bill.type === "ELECTRICITY",
    );
    const wifiBill = bills.find(
      (bill) => bill.month === month && bill.type === "WIFI",
    );

    return {
      month,
      electricity: elecBill?.amount ?? null,
      wifi: wifiBill?.amount ?? null,
      khala: khala > 0 ? khala : null,
    };
  });

  const poolSummaries: MonthCostPoolSummary[] = months.map((month) => {
    const from = monthStart(month);
    const to = monthEnd(month);
    const confirmedCount = Array.from(confirmedSet).filter(
      (d) => isSameOrAfter(d, from) && isSameOrBefore(d, to),
    ).length;
    const activeMembers = members.filter((m) =>
      isMemberActiveInRange(m, from, to, today),
    );
    const boarderCount = activeMembers.length;
    const card = rateCardFor(rateCards, from);
    const dailyRate = card?.dailyExtraAmount ?? 0;

    // Extras pool = confirmed recurring daily extra + all manual one-offs
    const monthExtras = safeExtras.filter(
      (item) => monthOf(item.date) === month && !item.voided,
    );
    const recurringExtras = monthExtras.filter((item) => item.isAuto);
    const manualExtras = monthExtras.filter((item) => !item.isAuto);
    const recurringTotal = recurringExtras.reduce((sum, item) => sum + item.amount, 0);
    const manualTotal = manualExtras.reduce((sum, item) => sum + item.amount, 0);
    const extrasPoolTotal = recurringTotal + manualTotal;

    // What each member actually carries, from the same engine the Settlement
    // and Balances pages read. The extras pool is an equal split, so it differs
    // by at most a taka; the utility pool is split by room capacity, so it
    // genuinely ranges.
    const monthBills = bills
      .filter((bill) => bill.month === month)
      .map((bill) => ({
        month: bill.month,
        type: bill.type,
        amount: bill.amount,
      }));
    const monthComputation = computeMonth({
      month,
      cutoff: to,
      members,
      rooms,
      changes: [],
      guestMeals: [],
      extras: safeExtras,
      bills: monthBills,
      rateCards,
      today,
    });
    const utilityTotals = [...monthComputation.perMember.values()].map(
      (row) => row.khalaElecWifiAmount,
    );
    const extraShares = [...monthComputation.perMember.values()].map(
      (row) => row.extraAmount,
    );

    return {
      month,
      extrasPoolTotal,
      extrasPerHeadLow: extraShares.length > 0 ? Math.min(...extraShares) : 0,
      extrasPerHeadHigh: extraShares.length > 0 ? Math.max(...extraShares) : 0,
      recurringTotal,
      manualTotal,
      utilityPoolTotal: sum(utilityTotals),
      utilityPerHeadLow: utilityTotals.length > 0 ? Math.min(...utilityTotals) : 0,
      utilityPerHeadHigh: utilityTotals.length > 0 ? Math.max(...utilityTotals) : 0,
      boarderCount,
      mealDaysRan: confirmedCount,
      dailyRate,
      totalDaysInMonth: daysInMonth(month).length,
    };
  });

  const fixedSummaries: MonthlyFixedExtraSummary[] = months.map((month) => {
    const from = monthStart(month);
    const to = monthEnd(month);
    const confirmedCount = Array.from(confirmedSet).filter(
      (d) => isSameOrAfter(d, from) && isSameOrBefore(d, to),
    ).length;
    const activeMemberCount = members.filter((m) =>
      isMemberActiveInRange(m, from, to, today),
    ).length;
    const card = rateCardFor(rateCards, from);
    return computeMonthlyFixedExtraSummary({
      month,
      confirmedBazarDaysCount: confirmedCount,
      rateCard: card,
      activeMemberCount,
    });
  });

  const currentPool = poolSummaries[0];

  const todayBudget = safeExtras
    .filter((item) => item.date === today && item.showInDailyBudget && !item.voided)
    .reduce((total, item) => total + item.amount, 0);

  return (
    <>
      <PageHeader
        title="Extras & Utility Bills"
        description="The shared cost pools: Extras pool (daily recurring extra + manual charges) and Utility pool (electricity and wifi bills, plus Khala from the rate card)."
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Extras pool"
          value={`${formatTaka(currentPool.extrasPerHeadLow)}–${formatTaka(
            currentPool.extrasPerHeadHigh,
          )} / member`}
          hint={`total ${formatTaka(currentPool.extrasPoolTotal)} across ${currentPool.boarderCount} boarders`}
        />
        <Stat
          label="Utility pool"
          value={`${formatTaka(currentPool.utilityPerHeadLow)}–${formatTaka(
            currentPool.utilityPerHeadHigh,
          )} / member`}
          hint={`total ${formatTaka(currentPool.utilityPoolTotal)} across ${currentPool.boarderCount} boarders — split by room capacity`}
        />
        <Stat
          label="Active boarders"
          value={currentPool.boarderCount}
          hint="for cost pool splits"
        />
        <Stat
          label="In today's budget"
          value={formatTaka(todayBudget)}
          hint="daily extras in today's bazar"
        />
      </div>
      <ExtrasClient
        extras={extraRecords}
        bills={billRecords}
        months={months}
        poolSummaries={poolSummaries}
        fixedSummaries={fixedSummaries}
      />
    </>
  );
}
