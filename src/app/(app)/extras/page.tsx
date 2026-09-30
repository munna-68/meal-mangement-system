import type { Metadata } from "next";

import { PageHeader, Stat } from "@/components/page-header";
import {
  computeMonthlyFixedExtraSummary,
  isMemberActiveInRange,
  rateCardFor,
  type MonthlyFixedExtraSummary,
} from "@/lib/calc";
import {
  addMonths,
  currentMonthKey,
  isSameOrAfter,
  isSameOrBefore,
  monthEnd,
  monthOf,
  monthStart,
  todayKey,
} from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { ensureAutoExtrasForMonth } from "@/server/auto-extras";
import {
  getAllConfirmedBazarDates,
  getExtras,
  getMembersWithRooms,
  getRateCards,
  getUtilityBills,
} from "@/server/queries";
import { ExtrasClient, type BillRecord, type ExtraRecord } from "./extras-client";

export const metadata: Metadata = { title: "Extras & Bills" };

const RECENT_LIMIT = 150;

export default async function ExtrasPage() {
  await requireSession();

  const now = currentMonthKey();
  // Ensure the current month's auto extras are materialized for any confirmed bazar days.
  await ensureAutoExtrasForMonth(now);

  const [extras, bills, members, rateCards, allConfirmed] = await Promise.all([
    getExtras(),
    getUtilityBills(),
    getMembersWithRooms(),
    getRateCards(),
    getAllConfirmedBazarDates(),
  ]);

  const confirmedSet = new Set(allConfirmed);
  const today = todayKey();

  const extraRecords: ExtraRecord[] = extras.slice(0, RECENT_LIMIT).map((item) => ({
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

  const billRecords: BillRecord[] = months
    .map((month) => ({
      month,
      electricity:
        bills.find((bill) => bill.month === month && bill.type === "ELECTRICITY")
          ?.amount ?? null,
      wifi:
        bills.find((bill) => bill.month === month && bill.type === "WIFI")?.amount ??
        null,
    }))
    .filter((bill) => bill.electricity !== null || bill.wifi !== null);

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

  const currentSummary = fixedSummaries[0];

  const monthExtras = extras.filter(
    (item) => monthOf(item.date) === now && !item.voided,
  );
  const monthPool = monthExtras.reduce((total, item) => total + item.amount, 0);
  const todayBudget = extras
    .filter((item) => item.date === today && item.showInDailyBudget && !item.voided)
    .reduce((total, item) => total + item.amount, 0);

  return (
    <>
      <PageHeader
        title="Extras & Utility Bills"
        description="The shared cost pool: fixed daily recurring extra, one-off charges, feast surcharges and monthly bills."
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="This month's pool"
          value={formatTaka(monthPool)}
          hint="split evenly at month end"
        />
        <Stat label="In today's budget" value={formatTaka(todayBudget)} />
        <Stat
          label="Daily extra per head"
          value={formatTaka(currentSummary?.perBoarderCost ?? 0)}
          hint={`${currentSummary?.mealDaysRan ?? 0} days × ${formatTaka(currentSummary?.dailyRate ?? 300)}`}
        />
        <Stat
          label="Active boarders"
          value={currentSummary?.boarderCount ?? members.length}
          hint="for extra pool split"
        />
      </div>
      <ExtrasClient
        extras={extraRecords}
        bills={billRecords}
        months={months}
        fixedSummaries={fixedSummaries}
      />
    </>
  );
}
