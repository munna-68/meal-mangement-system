"use client";

import { useState } from "react";
import { TrashIcon } from "lucide-react";

import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { todayKey } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { createDeposit, deleteDeposit } from "@/server/actions/ledger";

export interface DepositRecord {
  id: string;
  memberId: string;
  memberName: string;
  roomNumber: string;
  date: string;
  amount: number;
  notes: string | null;
}

export interface DepositMemberOption {
  id: string;
  name: string;
  roomNumber: string;
  total: number;
}

export function DepositsClient({
  members,
  deposits,
}: {
  members: DepositMemberOption[];
  deposits: DepositRecord[];
}) {
  const { run, pending } = useAction();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [date, setDate] = useState(todayKey());
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const selected = members.find((member) => member.id === memberId);
  const grandTotal = members.reduce((total, member) => total + member.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card shadow-sm">
        <header className="border-b px-4 py-3">
          <h2 className="font-heading text-sm font-semibold">Record a deposit</h2>
          <p className="text-xs text-muted-foreground">
            Money a member has paid into the mess.
          </p>
        </header>
        <div className="grid gap-3 p-4 lg:grid-cols-[1.4fr_1fr_1fr_1.6fr_auto] lg:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="deposit-member">Member</Label>
            <Select value={memberId} onValueChange={setMemberId}>
              <SelectTrigger id="deposit-member" className="w-full">
                <SelectValue placeholder="Pick a member" />
              </SelectTrigger>
              <SelectContent>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name} — Room {member.roomNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="deposit-date">Date</Label>
            <Input
              id="deposit-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="deposit-amount">Amount</Label>
            <Input
              id="deposit-amount"
              type="number"
              min={0}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="deposit-notes">Notes</Label>
            <Input
              id="deposit-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="e.g. bkash"
            />
          </div>
          <Button
            disabled={pending || !memberId || !amount}
            onClick={() =>
              run(
                () =>
                  createDeposit({
                    memberId,
                    date,
                    amount: Number(amount),
                    notes,
                  }),
                {
                  onSuccess: () => {
                    setAmount("");
                    setNotes("");
                  },
                },
              )
            }
          >
            Add deposit
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-heading text-sm font-semibold">Totals per member</h2>
          <span className="text-sm font-semibold tabular-nums">
            {formatTaka(grandTotal)}
          </span>
        </header>
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between rounded-lg border px-3 py-2"
            >
              <span className="text-sm">
                <span className="font-medium">{member.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  Room {member.roomNumber}
                </span>
              </span>
              <span
                className={
                  member.total > 0
                    ? "text-sm font-semibold tabular-nums"
                    : "text-sm tabular-nums text-muted-foreground"
                }
              >
                {formatTaka(member.total)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-heading text-sm font-semibold">Deposit ledger</h2>
          <span className="text-xs text-muted-foreground">
            {deposits.length} entries
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Room</th>
                <th className="px-4 py-2 text-left font-medium">Member</th>
                <th className="px-4 py-2 text-left font-medium">Notes</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((deposit) => (
                <tr key={deposit.id} className="border-t">
                  <td className="px-4 py-2 tabular-nums">{deposit.date}</td>
                  <td className="px-4 py-2 tabular-nums">{deposit.roomNumber}</td>
                  <td className="px-4 py-2 font-medium">{deposit.memberName}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {deposit.notes ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {formatTaka(deposit.amount)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete deposit"
                      onClick={() => run(() => deleteDeposit(deposit.id))}
                    >
                      <TrashIcon />
                    </Button>
                  </td>
                </tr>
              ))}
              {deposits.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No deposits recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {selected && selected.total > 0 ? (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            {selected.name} has deposited {formatTaka(selected.total)} in total.
          </p>
        ) : null}
      </section>
    </div>
  );
}
