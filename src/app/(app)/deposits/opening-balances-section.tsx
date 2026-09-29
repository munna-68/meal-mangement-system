"use client";

import { useState } from "react";
import { TrashIcon } from "lucide-react";

import { MemberPicker } from "@/components/member-picker";
import { useAction } from "@/components/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMonthDisplay } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { deleteOpeningBalance, setOpeningBalance } from "@/server/actions/opening";

export interface OpeningRecord {
  memberId: string;
  memberName: string;
  roomNumber: string;
  month: string;
  amount: number;
  notes: string | null;
}

export interface OpeningMemberOption {
  id: string;
  name: string;
  roomNumber: string;
}

/**
 * The manual "balance as at the 1st" recorder.
 *
 * A month's opening is normally carried forward automatically from the previous
 * closed month, so this is only ever needed for the very first month the mess
 * tracks (nothing to carry) — or to correct a carry. Setting a value here
 * replaces the automatic carry for that month until it is closed.
 *
 * The amount is signed: a negative value means the member already owed the mess
 * when the month began.
 */
export function OpeningBalancesSection({
  members,
  openings,
  openMonth,
}: {
  members: OpeningMemberOption[];
  openings: OpeningRecord[];
  openMonth: string;
}) {
  const { run, pending } = useAction();
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [month, setMonth] = useState(openMonth);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");

  const monthOpenings = openings.filter((row) => row.month === month);
  const existing = monthOpenings.find((row) => row.memberId === memberId);

  const save = () =>
    run(
      () =>
        setOpeningBalance({
          memberId,
          month,
          amount: Number(amount),
          notes,
        }),
      {
        onSuccess: () => {
          setAmount("");
          setNotes("");
        },
      },
    );

  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <header className="border-b px-4 py-3">
        <h2 className="font-heading text-sm font-semibold">Opening balance</h2>
        <p className="text-xs text-muted-foreground">
          Where each person stood on the 1st of the month. Normally this carries
          forward automatically from the last closed month — set it by hand only
          for the first month, or to correct a carry. A negative value means the
          member already owed the mess.
        </p>
      </header>

      <div className="grid gap-3 p-4 lg:grid-cols-[1.4fr_1fr_1fr_1.6fr_auto] lg:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor="opening-member">Member</Label>
          <MemberPicker
            id="opening-member"
            members={members.map((member) => ({
              id: member.id,
              name: member.name,
              roomNumber: member.roomNumber,
            }))}
            value={memberId}
            onChange={setMemberId}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="opening-month">Month</Label>
          <Input
            id="opening-month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="opening-amount">Amount</Label>
          <Input
            id="opening-amount"
            type="number"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={existing ? String(existing.amount) : "0"}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="opening-notes">Notes</Label>
          <Input
            id="opening-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="e.g. carried over from paper book"
          />
        </div>
        <Button
          disabled={pending || !memberId || !month || amount === ""}
          onClick={save}
        >
          {existing ? "Update" : "Set"} opening
        </Button>
      </div>

      {existing ? (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {existing.memberName} already has an opening balance of{" "}
          {formatTaka(existing.amount)} for {formatMonthDisplay(month)}. Saving a
          new value replaces it.
        </p>
      ) : null}

      <div className="border-t">
        <header className="flex items-center justify-between px-4 py-3">
          <h3 className="font-heading text-sm font-medium">
            Opening balances · {formatMonthDisplay(month)}
          </h3>
          <span className="text-xs text-muted-foreground">
            {monthOpenings.length} set
          </span>
        </header>
        {monthOpenings.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            No opening balances set for {formatMonthDisplay(month)} — this month
            opens from the carried-forward balance.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Room</th>
                  <th className="px-4 py-2 text-left font-medium">Member</th>
                  <th className="px-4 py-2 text-right font-medium">Opening</th>
                  <th className="px-4 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {monthOpenings.map((row) => (
                  <tr key={row.memberId} className="border-t">
                    <td className="px-4 py-2 tabular-nums">{row.roomNumber}</td>
                    <td className="px-4 py-2 font-medium">
                      {row.memberName}
                      {row.notes ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {row.notes}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={
                        row.amount < 0
                          ? "px-4 py-2 text-right font-semibold tabular-nums text-red-700"
                          : "px-4 py-2 text-right font-semibold tabular-nums"
                      }
                    >
                      {formatTaka(row.amount)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove opening balance for ${row.memberName}`}
                        onClick={() =>
                          run(() =>
                            deleteOpeningBalance({ month, memberId: row.memberId }),
                          )
                        }
                      >
                        <TrashIcon />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
