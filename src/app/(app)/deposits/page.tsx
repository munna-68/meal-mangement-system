import type { Metadata } from "next";

import { PageHeader, Stat } from "@/components/page-header";
import { currentMonthKey, formatMonthDisplay } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { getDeposits, getMembersWithRooms } from "@/server/queries";
import { DepositsClient, type DepositRecord } from "./deposits-client";

export const metadata: Metadata = { title: "Deposits" };

export default async function DepositsPage() {
  await requireSession();

  const [members, deposits] = await Promise.all([
    getMembersWithRooms(),
    getDeposits(),
  ]);

  const memberById = new Map(members.map((member) => [member.id, member]));

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

  const options = members
    .filter((member) => member.active)
    .map((member) => ({
      id: member.id,
      name: member.name,
      roomNumber: member.roomNumber,
      total: deposits
        .filter((deposit) => deposit.memberId === member.id)
        .reduce((total, deposit) => total + deposit.amount, 0),
    }));

  const total = deposits.reduce((sum, deposit) => sum + deposit.amount, 0);
  const month = currentMonthKey();
  const thisMonth = deposits
    .filter((deposit) => deposit.date.slice(0, 7) === month)
    .reduce((sum, deposit) => sum + deposit.amount, 0);

  return (
    <>
      <PageHeader
        title="Deposits"
        description="Everything members have paid in, and what is still outstanding."
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="All-time deposits" value={formatTaka(total)} />
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
      <DepositsClient members={options} deposits={records} />
    </>
  );
}
