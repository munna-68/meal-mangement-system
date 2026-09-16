import type { Metadata } from "next";

import { PageHeader, Stat } from "@/components/page-header";
import { addMonths, currentMonthKey, monthOf, todayKey } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { getExtras, getUtilityBills } from "@/server/queries";
import { ExtrasClient, type BillRecord, type ExtraRecord } from "./extras-client";

export const metadata: Metadata = { title: "Extras & Bills" };

const RECENT_LIMIT = 150;

export default async function ExtrasPage() {
  await requireSession();

  const [extras, bills] = await Promise.all([getExtras(), getUtilityBills()]);
  const now = currentMonthKey();

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

  const monthExtras = extras.filter(
    (item) => monthOf(item.date) === now && !item.voided,
  );
  const monthPool = monthExtras.reduce((total, item) => total + item.amount, 0);
  const today = todayKey();
  const todayBudget = extras
    .filter((item) => item.date === today && item.showInDailyBudget && !item.voided)
    .reduce((total, item) => total + item.amount, 0);

  return (
    <>
      <PageHeader
        title="Extras & Utility Bills"
        description="The shared cost pool: one-off charges, feast surcharges and the monthly bills."
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="This month's pool"
          value={formatTaka(monthPool)}
          hint="split evenly at month end"
        />
        <Stat label="In today's budget" value={formatTaka(todayBudget)} />
        <Stat
          label="Auto items this month"
          value={monthExtras.filter((item) => item.isAuto).length}
          hint="daily Extra + manager fee"
        />
        <Stat
          label="Months with bills"
          value={billRecords.length}
          hint="electricity and wifi"
        />
      </div>
      <ExtrasClient extras={extraRecords} bills={billRecords} months={months} />
    </>
  );
}
