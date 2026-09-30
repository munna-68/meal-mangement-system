"use client";

import { useState } from "react";
import {
  CalculatorIcon,
  CheckIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";

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
import {
  EXTRA_CATEGORY_LABELS,
  type ExtraCategory,
  type MonthlyFixedExtraSummary,
} from "@/lib/calc";
import { formatDisplay, formatMonthDisplay, monthStart, todayKey } from "@/lib/dates";
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
  khala: number | null;
  calculatedKhala: number;
  hasSavedKhala: boolean;
}

export interface MonthCostPoolSummary {
  month: string;
  extrasPoolTotal: number;
  extrasPerHead: number;
  utilityPoolTotal: number;
  utilityPerHead: number;
  boarderCount: number;
  mealDaysRan: number;
  dailyRate: number;
  totalDaysInMonth: number;
}

interface UnifiedItem {
  id: string;
  date: string;
  label: string;
  categoryLabel: string;
  pool: "EXTRAS" | "UTILITY";
  showInDailyBudget: boolean;
  amount: number;
  isAuto: boolean;
  voided: boolean;
  canDelete: boolean;
}

const CATEGORIES: ExtraCategory[] = [
  "ONE_OFF",
  "FEAST",
  "OTHER",
];

export function ExtrasClient({
  extras,
  bills,
  months,
  poolSummaries,
  fixedSummaries,
}: {
  extras: ExtraRecord[];
  bills: BillRecord[];
  months: string[];
  poolSummaries: MonthCostPoolSummary[];
  fixedSummaries: MonthlyFixedExtraSummary[];
}) {
  const { run, pending } = useAction();
  const [date, setDate] = useState(todayKey());
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExtraCategory>("ONE_OFF");
  const [showInDailyBudget, setShowInDailyBudget] = useState(false);

  const [summaryMonth, setSummaryMonth] = useState(months[0] ?? "");
  const [itemFilter, setItemFilter] = useState<
    "ALL" | "EXTRAS" | "UTILITY" | "MANUAL" | "AUTO"
  >("ALL");

  const [billMonth, setBillMonth] = useState(months[0] ?? "");
  const [electricity, setElectricity] = useState("");
  const [wifi, setWifi] = useState("");
  const [khala, setKhala] = useState("");

  const currentSummary =
    fixedSummaries.find((s) => s.month === summaryMonth) ?? fixedSummaries[0];
  const currentPool =
    poolSummaries.find((p) => p.month === summaryMonth) ?? poolSummaries[0];
  const selectedBill = bills.find((bill) => bill.month === billMonth);

  // Synthesize utility items into unified items list
  const safeExtras = extras.filter((item) => item.category !== "MANAGER_FEE");

  const utilityItems: UnifiedItem[] = bills.flatMap((bill) => {
    const items: UnifiedItem[] = [];
    const dateStr = monthStart(bill.month);
    const monthLabel = formatMonthDisplay(bill.month);

    if (bill.electricity !== null && bill.electricity > 0) {
      items.push({
        id: `utility-electricity-${bill.month}`,
        date: dateStr,
        label: `Electricity bill (${monthLabel})`,
        categoryLabel: "Utility pool",
        pool: "UTILITY",
        showInDailyBudget: false,
        amount: bill.electricity,
        isAuto: true,
        voided: false,
        canDelete: false,
      });
    }
    if (bill.wifi !== null && bill.wifi > 0) {
      items.push({
        id: `utility-wifi-${bill.month}`,
        date: dateStr,
        label: `Wifi bill (${monthLabel})`,
        categoryLabel: "Utility pool",
        pool: "UTILITY",
        showInDailyBudget: false,
        amount: bill.wifi,
        isAuto: true,
        voided: false,
        canDelete: false,
      });
    }
    if (bill.khala !== null && bill.khala > 0) {
      items.push({
        id: `utility-khala-${bill.month}`,
        date: dateStr,
        label: `Khala bill (${monthLabel})`,
        categoryLabel: "Utility pool",
        pool: "UTILITY",
        showInDailyBudget: false,
        amount: bill.khala,
        isAuto: true,
        voided: false,
        canDelete: false,
      });
    }
    return items;
  });

  const extraUnifiedItems: UnifiedItem[] = safeExtras.map((item) => ({
    id: item.id,
    date: item.date,
    label: item.label,
    categoryLabel: EXTRA_CATEGORY_LABELS[item.category],
    pool: "EXTRAS",
    showInDailyBudget: item.showInDailyBudget,
    amount: item.amount,
    isAuto: item.isAuto,
    voided: item.voided,
    canDelete: !item.isAuto,
  }));

  const allItems: UnifiedItem[] = [...extraUnifiedItems, ...utilityItems].sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0),
  );

  const extrasCount = extraUnifiedItems.length;
  const utilityCount = utilityItems.length;
  const manualCount = extraUnifiedItems.filter((i) => !i.isAuto).length;
  const autoCount = allItems.filter((i) => i.isAuto).length;

  const filteredItems = allItems.filter((item) => {
    if (itemFilter === "EXTRAS") return item.pool === "EXTRAS";
    if (itemFilter === "UTILITY") return item.pool === "UTILITY";
    if (itemFilter === "MANUAL") return !item.isAuto;
    if (itemFilter === "AUTO") return item.isAuto;
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card shadow-sm">
        <header className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CalculatorIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="font-heading text-sm font-semibold">
                Cost Pools &amp; Rates
              </h2>
              <Badge
                variant="secondary"
                className="bg-emerald-50 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              >
                Two Separate Pools
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Extras pool (recurring daily extra + manual one-offs) and Utility pool
              (electricity + wifi + khala). Each has its own per-head cost.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label
              htmlFor="summary-month"
              className="whitespace-nowrap text-xs text-muted-foreground"
            >
              Month:
            </Label>
            <Select value={summaryMonth} onValueChange={setSummaryMonth}>
              <SelectTrigger id="summary-month" className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {formatMonthDisplay(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>

        {currentPool && currentSummary ? (
          <div className="flex flex-col gap-4 p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="rounded-lg border bg-muted/20 p-3">
                <span className="text-xs text-muted-foreground">Meal Days Ran</span>
                <div className="mt-1 font-heading text-xl font-bold tabular-nums">
                  {currentPool.mealDaysRan}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    / {currentPool.totalDaysInMonth} days
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  confirmed bazar days
                </span>
              </div>

              <div className="rounded-lg border bg-muted/20 p-3">
                <span className="text-xs text-muted-foreground">Daily Extra Rate</span>
                <div className="mt-1 font-heading text-xl font-bold tabular-nums">
                  {formatTaka(currentPool.dailyRate)}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  per day meal runs
                </span>
              </div>

              {/* Extras pool side-by-side card */}
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
                    Extras Pool
                  </span>
                  <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-700 dark:text-emerald-300">
                    Pool 1
                  </Badge>
                </div>
                <div className="mt-1 font-heading text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {formatTaka(currentPool.extrasPoolTotal)}
                </div>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {formatTaka(currentPool.extrasPerHead)} / head
                </span>
                <p className="mt-0.5 text-[10px] text-emerald-600/80 dark:text-emerald-400/80">
                  daily extra + manual one-offs
                </p>
              </div>

              {/* Utility pool side-by-side card */}
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-blue-800 dark:text-blue-300">
                    Utility Pool
                  </span>
                  <Badge variant="outline" className="border-blue-300 text-[10px] text-blue-700 dark:text-blue-300">
                    Pool 2
                  </Badge>
                </div>
                <div className="mt-1 font-heading text-xl font-bold tabular-nums text-blue-700 dark:text-blue-400">
                  {formatTaka(currentPool.utilityPoolTotal)}
                </div>
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                  {formatTaka(currentPool.utilityPerHead)} / head
                </span>
                <p className="mt-0.5 text-[10px] text-blue-600/80 dark:text-blue-400/80">
                  electricity + wifi + khala
                </p>
              </div>

              <div className="col-span-2 rounded-lg border bg-muted/20 p-3 sm:col-span-1">
                <span className="text-xs text-muted-foreground">Active Boarders</span>
                <div className="mt-1 font-heading text-xl font-bold tabular-nums">
                  {currentPool.boarderCount}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  members in hostel
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  <strong>Automatically Calculated:</strong> Each confirmed bazar adds{" "}
                  {formatTaka(currentPool.dailyRate)} to the Extras pool. Utility bills and one-off
                  extras automatically update their respective pools and per-head costs.
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <header className="border-b px-4 py-3">
          <h2 className="font-heading text-sm font-semibold">Log an extra cost</h2>
          <p className="text-xs text-muted-foreground">
            One-off costs, feast surcharges and meetings. Everything logged here is
            added to the Extras pool and split evenly across members.
          </p>
        </header>
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
          💡 <strong>Notice:</strong> The {formatTaka(currentSummary?.dailyRate ?? 300)}/day
          recurring extra is automatically calculated above whenever Today&rsquo;s Bazar is
          confirmed. Use this form <strong>only</strong> for occasional one-off expenses (e.g.,
          repairs, feast extras, meeting snacks, cleaning items).
        </div>
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
        <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-sm font-semibold">Shared pool costs</h2>
            <p className="text-xs text-muted-foreground">
              {allItems.length} total ({extrasCount} extras pool, {utilityCount} utility pool)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant={itemFilter === "ALL" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setItemFilter("ALL")}
            >
              All ({allItems.length})
            </Button>
            <Button
              size="sm"
              variant={itemFilter === "EXTRAS" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setItemFilter("EXTRAS")}
            >
              Extras pool ({extrasCount})
            </Button>
            <Button
              size="sm"
              variant={itemFilter === "UTILITY" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setItemFilter("UTILITY")}
            >
              Utility pool ({utilityCount})
            </Button>
            <Button
              size="sm"
              variant={itemFilter === "MANUAL" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setItemFilter("MANUAL")}
            >
              Manual only ({manualCount})
            </Button>
            <Button
              size="sm"
              variant={itemFilter === "AUTO" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setItemFilter("AUTO")}
            >
              Auto items ({autoCount})
            </Button>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Date / Month</th>
                <th className="px-4 py-2 text-left font-medium">Label</th>
                <th className="px-4 py-2 text-left font-medium">Cost Pool</th>
                <th className="px-4 py-2 text-center font-medium">In day budget</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-4 py-2 tabular-nums">
                    {item.pool === "UTILITY"
                      ? formatMonthDisplay(item.date.slice(0, 7))
                      : formatDisplay(item.date)}
                  </td>
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
                    {item.pool === "UTILITY" ? (
                      <Badge
                        variant="secondary"
                        className="bg-blue-50 text-[11px] text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      >
                        Utility pool
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[11px]"
                      >
                        {item.categoryLabel}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {item.pool === "UTILITY" ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : item.voided ? (
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
                    {item.pool === "UTILITY" ? (
                      <span
                        className="text-[11px] text-muted-foreground italic px-2 select-none"
                        title="Monthly utility bill. Manage in the Utility bills section below."
                      >
                        utility bill
                      </span>
                    ) : item.isAuto ? (
                      <span
                        className="text-[11px] text-muted-foreground italic px-2 select-none"
                        title="Auto-generated from bazar confirmation. Turn off on Today's Bazar if needed."
                      >
                        bazar auto
                      </span>
                    ) : (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete extra"
                        onClick={() => run(() => deleteExtra(item.id))}
                      >
                        <TrashIcon />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Nothing logged for this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <header className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <ZapIcon className="size-4 text-blue-600 dark:text-blue-400" />
            <h2 className="font-heading text-sm font-semibold">Utility bills</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter the month&rsquo;s total once the bill arrives. Electricity, wifi, and khala
            are apportioned by room capacity.
          </p>
        </header>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bill-month">Month</Label>
            <Select
              value={billMonth}
              onValueChange={(value) => {
                setBillMonth(value);
                const existing = bills.find((bill) => bill.month === value);
                setElectricity(existing?.electricity ? String(existing.electricity) : "");
                setWifi(existing?.wifi ? String(existing.wifi) : "");
                setKhala(existing?.hasSavedKhala ? String(existing.khala) : "");
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="bill-khala">Khala total</Label>
            <Input
              id="bill-khala"
              type="number"
              min={0}
              inputMode="numeric"
              value={khala}
              placeholder={
                selectedBill?.khala
                  ? String(selectedBill.khala)
                  : selectedBill?.calculatedKhala
                    ? String(selectedBill.calculatedKhala)
                    : "0"
              }
              onChange={(event) => setKhala(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 sm:col-span-2 lg:col-span-1">
            <Button
              size="sm"
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
              Save elec
            </Button>
            <Button
              size="sm"
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
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !billMonth}
              onClick={() =>
                run(() =>
                  saveUtilityBill({
                    month: billMonth,
                    type: "KHALA",
                    amount: Number(khala || 0),
                  }),
                )
              }
            >
              Save khala
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
                <th className="px-4 py-2 text-right font-medium">Khala</th>
                <th className="px-4 py-2 text-right font-medium">Combined</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => {
                const elec = bill.electricity ?? 0;
                const wifi = bill.wifi ?? 0;
                const khalaVal = bill.khala ?? 0;
                const combined = elec + wifi + khalaVal;

                return (
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
                    <td className="px-4 py-2 text-right tabular-nums">
                      {bill.khala === null ? (
                        "—"
                      ) : (
                        <span>
                          {formatTaka(bill.khala)}
                          {!bill.hasSavedKhala && bill.calculatedKhala > 0 ? (
                            <span
                              className="ml-1 text-[10px] text-muted-foreground"
                              title="Calculated from rate card and occupancy"
                            >
                              (auto)
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">
                      {formatTaka(combined)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
