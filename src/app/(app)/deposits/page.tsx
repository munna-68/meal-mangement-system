import type { Metadata } from "next";

import { PageHeader, Stat } from "@/components/page-header";
import {
  addMonths,
  currentMonthKey,
  formatMonthDisplay,
  todayKey,
} from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import {
  getDeductions,
  getDeposits,
  getLastClosedMonth,
  getMembersWithRooms,
  getOpeningBalances,
} from "@/server/queries";
import {
  CsvImportSection,
} from "./csv-import-section";
import {
  DepositsClient,
  type DeductionRecord,
  type DepositRecord,
} from "./deposits-client";
import {
  OpeningBalancesSection,
  type OpeningRecord,
} from "./opening-balances-section";

export const metadata: Metadata = { title: "Deposits" };

export default async function DepositsPage() {
  await requireSession();

  const [members, deposits, deductionRows, openingRows, lastClosedMonth] =
    await Promise.all([
      getMembersWithRooms(),
      getDeposits(),
      getDeductions(),
      getOpeningBalances(),
      getLastClosedMonth(),
    ]);

  const memberById = new Map(members.map((member) => [member.id, member]));

  // The first month of the open period — the one whose opening is a manual
  // decision, because there is no closed month to carry forward into it. This
  // is the default target month for the opening-balance and import forms.
  const openMonth = lastClosedMonth
    ? addMonths(lastClosedMonth, 1)
    : currentMonthKey();
  const today = todayKey();

  const openings: OpeningRecord[] = openingRows.map((row) => {
    const member = memberById.get(row.memberId);
    return {
      memberId: row.memberId,
      memberName: member?.name ?? "Unknown",
      roomNumber: member?.roomNumber ?? "-",
      month: row.month,
      amount: row.amount,
      notes: row.notes,
    };
  });

  const records: DepositRecord[] = deposits.map((deposit) => {
    const member = memberById.get(deposit.memberId);
    return {
      id: deposit.id,
      memberId: deposit.memberId,
      memberName: member?.name ?? "Unknown",
      roomNumber: member?.roomNumber ?? "-",
      date: deposit.date,
      amount: deposit.amount,
      notes: deposit.notes,
    };
  });

  const deductionRecords: DeductionRecord[] = deductionRows.map((deduction) => {
    const member = memberById.get(deduction.memberId);
    return {
      id: deduction.id,
      memberId: deduction.memberId,
      memberName: member?.name ?? "Unknown",
      roomNumber: member?.roomNumber ?? "-",
      date: deduction.date,
      amount: deduction.amount,
      notes: deduction.notes,
    };
  });

  const options = members
    .filter((member) => member.active)
    .map((member) => ({
      id: member.id,
      name: member.name,
      roomNumber: member.roomNumber,
      total: deposits
        .filter((deposit) => deposit.memberId === member.id)
        .reduce((total, deposit) => total + deposit.amount, 0),
      takenOut: deductionRows
        .filter((deduction) => deduction.memberId === member.id)
        .reduce((total, deduction) => total + deduction.amount, 0),
    }));

  const total = deposits.reduce((sum, deposit) => sum + deposit.amount, 0);
  const takenOutTotal = deductionRows.reduce(
    (sum, deduction) => sum + deduction.amount,
    0,
  );
  const month = currentMonthKey();
  const thisMonth = deposits
    .filter((deposit) => deposit.date.slice(0, 7) === month)
    .reduce((sum, deposit) => sum + deposit.amount, 0);

  return (
    <>
      <PageHeader
        title="Deposits"
        description="Everything members have paid in, what has been taken back out, and what is still outstanding."
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="All-time deposits" value={formatTaka(total)} />
        <Stat
          label="All-time taken out"
          value={formatTaka(takenOutTotal)}
          hint="money handed back"
        />
        <Stat
          label={`This month (${formatMonthDisplay(month)})`}
          value={formatTaka(thisMonth)}
        />
        <Stat
          label="Members with no deposit"
          value={options.filter((option) => option.total === 0).length}
          hint="of active members"
        />
      </div>
      <div className="flex flex-col gap-6">
        <DepositsClient
          members={options}
          deposits={records}
          deductions={deductionRecords}
        />
        <OpeningBalancesSection
          members={options}
          openings={openings}
          openMonth={openMonth}
        />
        <CsvImportSection
          members={options}
          today={today}
          openMonth={openMonth}
        />
      </div>
    </>
  );
}
