"use client";

import { useState } from "react";
import {
  CalculatorIcon,
  CheckIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";

import { cn } from "cn";

import { useAction } from "@/components/use-action";
import { useIdempotencyKey } from "@/components/use-idempotency-key";
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
import { formatTaka, sum } from "@/lib/money";
import {
  createExtra,
  deleteExtra,
  deleteKhalaPayment,
  logKhalaPayment,
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

export interface KhalaPaymentRecord {
  id: string;
  date: string;
  amount: number;
  notes: string | null;
}

/** What has been paid for one month's khala, and what the rate card expects. */
export interface KhalaMonthRecord {
  month: string;
  paid: number;
  target: number;
  outstanding: number;
  count: number;
}

export interface MonthCostPoolSummary {
  month: string;
  extrasPoolTotal: number;
  /** The lowest and highest share any single member carries. */
  extrasPerHeadLow: number;
  extrasPerHeadHigh: number;
  recurringTotal: number;
  manualTotal: number;
  utilityPoolTotal: number;
  utilityPerHeadLow: number;
  utilityPerHeadHigh: number;
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
  khalaPayments,
  khalaMonths,
  months,
  poolSummaries,
  fixedSummaries,
}: {
  extras: ExtraRecord[];
  bills: BillRecord[];
  khalaPayments: KhalaPaymentRecord[];
  khalaMonths: KhalaMonthRecord[];
  months: string[];
  poolSummaries: MonthCostPoolSummary[];
  fixedSummaries: MonthlyFixedExtraSummary[];
}) {
  const { run, pending } = useAction();
  const idempotency = useIdempotencyKey();
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
  const initialBill = bills.find((b) => b.month === (months[0] ?? ""));
  const [electricity, setElectricity] = useState(
    initialBill?.electricity !== null && initialBill?.electricity !== undefined
      ? String(initialBill.electricity)
      : "",
  );
  const [wifi, setWifi] = useState(
    initialBill?.wifi !== null && initialBill?.wifi !== undefined
      ? String(initialBill.wifi)
      : "",
  );
  const [khalaDate, setKhalaDate] = useState(todayKey());
  const [khalaAmount, setKhalaAmount] = useState("");
  const [khalaNotes, setKhalaNotes] = useState("");

  // The ceiling and the outstanding figure both follow the *payment date*, not
  // the bill month picker: khala is entered as a dated payment, so the month it
  // lands in is the one it is counted against.
  const khalaTargetMonth = khalaDate.slice(0, 7);
  const khalaMonthRecord = khalaMonths.find((r) => r.month === khalaTargetMonth);
  const khalaPaidTotal = sum(
    khalaPayments
      .filter((payment) => payment.date.slice(0, 7) === khalaTargetMonth)
      .map((payment) => payment.amount),
  );
  const khalaTarget = khalaMonthRecord?.target ?? 0;
  const khalaRemaining = Math.max(0, khalaTarget - khalaPaidTotal);

  const currentSummary =
    fixedSummaries.find((s) => s.month === summaryMonth) ?? fixedSummaries[0];
  const currentPool =
    poolSummaries.find((p) => p.month === summaryMonth) ?? poolSummaries[0];
  const selectedBill = bills.find((bill) => bill.month === billMonth);
  const selectedKhalaForBill = khalaMonths.find((r) => r.month === billMonth);

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
    return items;
  });

  // Each khala payment is a real, dated, deletable record — unlike the old
  // synthetic "Khala for the month" row, which had no row behind it at all and so
  // could never be removed once the rate card had produced a figure for it.
  const khalaItems: UnifiedItem[] = khalaPayments.map((payment) => ({
    id: `khala-${payment.id}`,
    date: payment.date,
    label: payment.notes?.trim()
      ? `Khala paid — ${payment.notes.trim()}`
      : "Khala paid",
    categoryLabel: "Utility pool",
    pool: "UTILITY",
    showInDailyBudget: false,
    amount: payment.amount,
    isAuto: false,
    voided: false,
    canDelete: true,
  }));

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

  const allItems: UnifiedItem[] = [
    ...extraUnifiedItems,
    ...utilityItems,
    ...khalaItems,
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const extrasCount = extraUnifiedItems.length;
  const utilityCount = utilityItems.length + khalaItems.length;
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
                  {formatTaka(currentPool.extrasPerHeadLow)}
                  {currentPool.extrasPerHeadHigh !== currentPool.extrasPerHeadLow
                    ? `–${formatTaka(currentPool.extrasPerHeadHigh)}`
                    : null}{" "}
                  / member
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-300">
                  total {formatTaka(currentPool.extrasPoolTotal)} across {currentPool.boarderCount} boarders
                </div>
                <div className="mt-2 flex flex-col gap-1 border-t border-emerald-200/60 pt-2 text-[11px] text-emerald-800/90 dark:border-emerald-800/60 dark:text-emerald-300/90">
                  <div className="flex justify-between">
                    <span>Daily recurring:</span>
                    <span className="font-semibold tabular-nums">{formatTaka(currentPool.recurringTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Manual one-offs:</span>
                    <span className="font-semibold tabular-nums">{formatTaka(currentPool.manualTotal)}</span>
                  </div>
                </div>
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
                  {formatTaka(currentPool.utilityPerHeadLow)}
                  {currentPool.utilityPerHeadHigh !== currentPool.utilityPerHeadLow
                    ? `–${formatTaka(currentPool.utilityPerHeadHigh)}`
                    : null}{" "}
                  / member
                </div>
                <div className="text-xs text-blue-700 dark:text-blue-300">
                  total {formatTaka(currentPool.utilityPoolTotal)} across {currentPool.boarderCount} boarders
                </div>
                <p className="mt-2 border-t border-blue-200/60 pt-2 text-[10px] text-blue-600/80 dark:border-blue-800/60 dark:text-blue-400/80">
                  electricity + wifi + Khala, split by room capacity. Quote a member their own row.
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
                    amount,
                    category,
                    showInDailyBudget,
                    idempotencyKey: idempotency.current(),
                  }),
                {
                  onSuccess: () => {
                    idempotency.reset();
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
                <th className="px-4 py-2 text-left font-medium">Date</th>
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
                      ? "—"
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
                    {item.pool === "UTILITY" && !item.canDelete ? (
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
                        aria-label={
                          item.pool === "UTILITY"
                            ? "Delete khala payment"
                            : "Delete extra"
                        }
                        onClick={() =>
                          run(() =>
                            item.pool === "UTILITY"
                              ? deleteKhalaPayment({ id: item.id.replace(/^khala-/, "") })
                              : deleteExtra(item.id),
                          )
                        }
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
          <h2 className="font-heading text-sm font-semibold">Log khala payments</h2>
          <p className="text-xs text-muted-foreground">
            Khala is handed over in instalments, so log each payment on the day you
            make it. Members only carry the khala you have actually paid, split by
            room capacity.
          </p>
        </header>
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue-200 bg-blue-50/60 p-2.5 text-xs text-blue-900 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-200">
          <span>
            Paid for {formatMonthDisplay(khalaTargetMonth)}:{" "}
            <strong className="tabular-nums">{formatTaka(khalaPaidTotal)}</strong>
          </span>
          <span>
            Rate card says a full month:{" "}
            <strong className="tabular-nums">{formatTaka(khalaTarget)}</strong>
          </span>
          <span>
            Still outstanding:{" "}
            <strong className="tabular-nums">{formatTaka(khalaRemaining)}</strong>
          </span>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-[1fr_1fr_1.6fr_auto] lg:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="khala-date">Paid on</Label>
            <Input
              id="khala-date"
              type="date"
              value={khalaDate}
              onChange={(event) => setKhalaDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="khala-amount">Amount</Label>
            <Input
              id="khala-amount"
              type="number"
              min={1}
              inputMode="numeric"
              value={khalaAmount}
              placeholder="0"
              onChange={(event) => setKhalaAmount(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="khala-notes">Note (optional)</Label>
            <Input
              id="khala-notes"
              value={khalaNotes}
              placeholder="e.g. first instalment"
              onChange={(event) => setKhalaNotes(event.target.value)}
            />
          </div>
          <Button
            disabled={pending || khalaAmount === "" || Number(khalaAmount) <= 0}
            onClick={() =>
              run(
                () =>
                  logKhalaPayment({
                    date: khalaDate,
                    amount: Number(khalaAmount),
                    notes: khalaNotes || undefined,
                    idempotencyKey: idempotency.current(),
                  }),
                {
                  onSuccess: () => {
                    idempotency.reset();
                    setKhalaAmount("");
                    setKhalaNotes("");
                  },
                },
              )
            }
          >
            Log payment
          </Button>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-[1.2fr_1fr_1fr_1.2fr_auto] lg:items-end">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bill-month">Month</Label>
            <Select
              value={billMonth}
              onValueChange={(value) => {
                setBillMonth(value);
                const existing = bills.find((bill) => bill.month === value);
                setElectricity(existing?.electricity !== null && existing?.electricity !== undefined ? String(existing.electricity) : "");
                setWifi(existing?.wifi !== null && existing?.wifi !== undefined ? String(existing.wifi) : "");
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
            <Label htmlFor="bill-electricity">Electricity</Label>
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
            <Label htmlFor="bill-wifi">Wifi</Label>
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
            <Label>Khala</Label>
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm tabular-nums text-muted-foreground">
              {selectedKhalaForBill && selectedKhalaForBill.paid > 0
                ? formatTaka(selectedKhalaForBill.paid)
                : "—"}
              <span className="block text-[11px]">paid so far — logged above</span>
            </p>
          </div>
          <Button
            disabled={pending || !billMonth}
            onClick={() =>
              run(async () => {
                const tasks = [];
                if (electricity !== "") {
                  tasks.push(
                    saveUtilityBill({
                      month: billMonth,
                      type: "ELECTRICITY",
                      amount: Number(electricity),
                    }),
                  );
                }
                if (wifi !== "") {
                  tasks.push(
                    saveUtilityBill({
                      month: billMonth,
                      type: "WIFI",
                      amount: Number(wifi),
                    }),
                  );
                }
                const results = await Promise.all(tasks);
                const failed = results.find((r) => !r.ok);
                if (failed) return failed;
                return { ok: true, message: "Utility bills saved" };
              })
            }
          >
            Save bills
          </Button>
        </div>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <header className="border-b px-4 py-3">
          <h2 className="font-heading text-sm font-semibold">Utility bill records</h2>
          <p className="text-xs text-muted-foreground">
            Electricity and wifi are entered once for the month. Khala is the amount
            you have actually paid, and the rate card figure next to it is what a
            full month is expected to come to.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Month</th>
                <th className="px-4 py-2 text-right font-medium">Electricity</th>
                <th className="px-4 py-2 text-right font-medium">Wifi</th>
                <th className="px-4 py-2 text-right font-medium">Khala paid</th>
                <th className="px-4 py-2 text-right font-medium">Khala target</th>
                <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                <th className="px-4 py-2 text-right font-medium">Khala+Wifi+Electricity</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => {
                const khalaRecord = khalaMonths.find((r) => r.month === bill.month);
                const elec = bill.electricity ?? 0;
                const wifi = bill.wifi ?? 0;
                const khalaPaid = khalaRecord?.paid ?? 0;
                const combined = elec + wifi + khalaPaid;

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
                    <td className="px-4 py-2 text-right font-semibold tabular-nums">
                      {khalaPaid > 0 ? formatTaka(khalaPaid) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {khalaRecord && khalaRecord.target > 0
                        ? formatTaka(khalaRecord.target)
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {khalaRecord && khalaRecord.outstanding > 0 ? (
                        <span className="text-amber-700 dark:text-amber-400">
                          {formatTaka(khalaRecord.outstanding)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
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
