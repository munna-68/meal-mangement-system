"use client";

import { useState } from "react";
import { CheckIcon, TrashIcon, XIcon } from "lucide-react";

import { cn } from "cn";

import { useAction } from "@/components/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EXTRA_CATEGORY_LABELS, type ExtraCategory } from "@/lib/calc";
import { formatDisplay, formatMonthDisplay, todayKey } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import {
  createExtra,
  deleteExtra,
  saveUtilityBill,
} from "@/server/actions/ledger";

export interface ExtraRecord {
  id: string;
  date: string;
  label: string;
  amount: number;
  category: ExtraCategory;
  showInDailyBudget: boolean;
  voided: boolean;
  isAuto: boolean;
}

export interface BillRecord {
  month: string;
  electricity: number | null;
  wifi: number | null;
}

// The recurring daily Extra and the manager's fee are generated from confirmed
// bazar days, so they are not offered as manual categories here.
const CATEGORIES: ExtraCategory[] = [
  "ONE_OFF",
  "FEAST",
  "OTHER",
];

export function ExtrasClient({
  extras,
  bills,
  months,
}: {
  extras: ExtraRecord[];
  bills: BillRecord[];
  months: string[];
}) {
  const { run, pending } = useAction();
  const [date, setDate] = useState(todayKey());
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExtraCategory>("ONE_OFF");
  const [showInDailyBudget, setShowInDailyBudget] = useState(false);

  const [billMonth, setBillMonth] = useState(months[0] ?? "");
  const [electricity, setElectricity] = useState("");
  const [wifi, setWifi] = useState("");

  const selectedBill = bills.find((bill) => bill.month === billMonth);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card shadow-sm">
        <header className="border-b px-4 py-3">
          <h2 className="font-heading text-sm font-semibold">Log an extra cost</h2>
          <p className="text-xs text-muted-foreground">
            One-off costs, feast surcharges and meetings. Everything logged here is
            split evenly across members at month end.
          </p>
        </header>
        <div className="grid gap-3 p-4 lg:grid-cols-[1fr_1.6fr_1fr_1.2fr_auto] lg:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="extra-date">Date</Label>
            <Input
              id="extra-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="extra-label">Label</Label>
            <Input
              id="extra-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Fridge repair"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="extra-amount">Amount</Label>
            <Input
              id="extra-amount"
              type="number"
              min={0}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="extra-category">Category</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as ExtraCategory)}
            >
              <SelectTrigger id="extra-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {EXTRA_CATEGORY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={pending || !label || !amount}
            onClick={() =>
              run(
                () =>
                  createExtra({
                    date,
                    label,
                    amount: Number(amount),
                    category,
                    showInDailyBudget,
                  }),
                {
                  onSuccess: () => {
                    setLabel("");
                    setAmount("");
                    setShowInDailyBudget(false);
                  },
                },
              )
            }
          >
            Add extra
          </Button>
        </div>
        <label className="flex items-center gap-2 border-t px-4 py-3 text-sm">
          <Checkbox
            checked={showInDailyBudget}
            onCheckedChange={(checked) => setShowInDailyBudget(checked === true)}
          />
          Also show this in that day&rsquo;s bazar budget
          <span className="text-xs text-muted-foreground">
            (a meeting cost logged after the fact usually should not)
          </span>
        </label>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-heading text-sm font-semibold">Extra items</h2>
          <span className="text-xs text-muted-foreground">
            {extras.length} total
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Label</th>
                <th className="px-4 py-2 text-left font-medium">Category</th>
                <th className="px-4 py-2 text-center font-medium">In day budget</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {extras.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-4 py-2 tabular-nums">{formatDisplay(item.date)}</td>
                  <td
                    className={cn(
                      "px-4 py-2 font-medium",
                      item.voided && "text-muted-foreground line-through",
                    )}
                  >
                    {item.label}
                    {item.isAuto ? (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        auto
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {EXTRA_CATEGORY_LABELS[item.category]}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {item.voided ? (
                      <Badge variant="outline" className="border-red-300 text-red-700">
                        turned off
                      </Badge>
                    ) : item.showInDailyBudget ? (
                      <CheckIcon className="mx-auto size-4 text-emerald-600" />
                    ) : (
                      <XIcon className="mx-auto size-4 text-muted-foreground" />
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right font-semibold tabular-nums",
                      item.voided && "text-muted-foreground line-through",
                    )}
                  >
                    {formatTaka(item.amount)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete extra"
                      onClick={() => run(() => deleteExtra(item.id))}
                    >
                      <TrashIcon />
                    </Button>
                  </td>
                </tr>
              ))}
              {extras.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Nothing logged yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <header className="border-b px-4 py-3">
          <h2 className="font-heading text-sm font-semibold">
            Electricity &amp; wifi bills
          </h2>
          <p className="text-xs text-muted-foreground">
            Enter the month&rsquo;s total once the bill arrives. It is apportioned
            by room capacity.
          </p>
        </header>
        <div className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bill-month">Month</Label>
            <Select
              value={billMonth}
              onValueChange={(value) => {
                setBillMonth(value);
                const existing = bills.find((bill) => bill.month === value);
                setElectricity(existing?.electricity ? String(existing.electricity) : "");
                setWifi(existing?.wifi ? String(existing.wifi) : "");
              }}
            >
              <SelectTrigger id="bill-month" className="w-full">
                <SelectValue placeholder="Pick a month" />
              </SelectTrigger>
              <SelectContent>
                {months.map((month) => (
                  <SelectItem key={month} value={month}>
                    {formatMonthDisplay(month)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bill-electricity">Electricity total</Label>
            <Input
              id="bill-electricity"
              type="number"
              min={0}
              inputMode="numeric"
              value={electricity}
              placeholder={selectedBill?.electricity ? String(selectedBill.electricity) : "0"}
              onChange={(event) => setElectricity(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bill-wifi">Wifi total</Label>
            <Input
              id="bill-wifi"
              type="number"
              min={0}
              inputMode="numeric"
              value={wifi}
              placeholder={selectedBill?.wifi ? String(selectedBill.wifi) : "0"}
              onChange={(event) => setWifi(event.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              disabled={pending || !billMonth}
              onClick={() =>
                run(() =>
                  saveUtilityBill({
                    month: billMonth,
                    type: "ELECTRICITY",
                    amount: Number(electricity || 0),
                  }),
                )
              }
            >
              Save electricity
            </Button>
            <Button
              variant="outline"
              disabled={pending || !billMonth}
              onClick={() =>
                run(() =>
                  saveUtilityBill({
                    month: billMonth,
                    type: "WIFI",
                    amount: Number(wifi || 0),
                  }),
                )
              }
            >
              Save wifi
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Month</th>
                <th className="px-4 py-2 text-right font-medium">Electricity</th>
                <th className="px-4 py-2 text-right font-medium">Wifi</th>
                <th className="px-4 py-2 text-right font-medium">Combined</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <tr key={bill.month} className="border-t">
                  <td className="px-4 py-2 font-medium">
                    {formatMonthDisplay(bill.month)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {bill.electricity === null ? "—" : formatTaka(bill.electricity)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {bill.wifi === null ? "—" : formatTaka(bill.wifi)}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">
                    {formatTaka((bill.electricity ?? 0) + (bill.wifi ?? 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
