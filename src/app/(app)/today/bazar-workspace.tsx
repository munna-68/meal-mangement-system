"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  InfoIcon,
  RotateCcwIcon,
} from "lucide-react";

import { cn } from "cn";

import { BazarSlip } from "@/components/bazar-slip";
import { MealStatusLegend } from "@/components/meal-status";
import { PdfButton } from "@/components/pdf-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/action-result";
import type { DayTotals, ExtraCategory, RoomDayRow } from "@/lib/calc";
import { EXTRA_CATEGORY_LABELS } from "@/lib/calc";
import { todayKey } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import {
  saveBazarRecord,
  saveBazarRecordForm,
  toggleAutoExtra,
} from "@/server/actions/bazar";

export interface WorkspaceExtra {
  id: string;
  date: string;
  label: string;
  amount: number;
  category: ExtraCategory;
  showInDailyBudget: boolean;
  voided: boolean;
  isAuto: boolean;
  sourceKey: string | null;
}

export interface BazarInitial {
  deductionAmount: number;
  deductionReason: string;
  advanceGiven: number;
  actualExpense: number;
  changeReturned: number;
  /** Whether a bazar record exists for this date — i.e. the day is confirmed. */
  confirmed: boolean;
}

const initialActionState: ActionResult = { ok: true };

export function BazarWorkspace({
  date,
  hostelName,
  address,
  dutyRoomNumbers,
  khalaDidShopping,
  rooms,
  totals,
  extras,
  initial,
  ramadanMode,
}: {
  date: string;
  hostelName: string;
  address: string;
  dutyRoomNumbers: string[];
  khalaDidShopping: boolean;
  rooms: RoomDayRow[];
  totals: DayTotals;
  extras: WorkspaceExtra[];
  initial: BazarInitial;
  ramadanMode: boolean;
}) {
  const [state, formAction, saving] = useActionState(
    saveBazarRecordForm,
    initialActionState,
  );
  const [, startTransition] = useTransition();
  const router = useRouter();

  const [optimisticExtras, applyExtraPatch] = useOptimistic(
    extras,
    (current, patch: { id: string; voided: boolean }) =>
      current.map((item) =>
        item.id === patch.id ? { ...item, voided: patch.voided } : item,
      ),
  );

  const [deduction, setDeduction] = useState(initial.deductionAmount);
  const [reason, setReason] = useState(initial.deductionReason);
  const [advance, setAdvance] = useState(initial.advanceGiven);
  const [expense, setExpense] = useState(initial.actualExpense);
  const [manualChange, setManualChange] = useState<number | null>(
    initial.changeReturned === initial.advanceGiven - initial.actualExpense
      ? null
      : initial.changeReturned,
  );

  const budgetExtras = optimisticExtras.filter(
    (item) => item.date === date && item.showInDailyBudget && !item.voided,
  );
  const extraAmount = budgetExtras.reduce((total, item) => total + item.amount, 0);

  // The recurring daily Extra and the manager's fee are only materialised once
  // the day is confirmed. Until then they are shown as pending so the shopper's
  // target budget is right, but they are not yet charged to anyone.
  const isConfirmed = initial.confirmed;
  const autoRowsToday = optimisticExtras.filter(
    (item) => item.date === date && item.isAuto,
  );
  const pendingDailyExtra = totals.rateCard?.dailyExtraAmount ?? 0;
  const pendingManagerFee = totals.rateCard?.managerDailyFee ?? 0;
  const showPendingRecurring = !isConfirmed && autoRowsToday.length === 0;
  const pendingRecurringAmount = showPendingRecurring
    ? pendingDailyExtra + pendingManagerFee
    : 0;

  const displayExtraAmount = extraAmount + pendingRecurringAmount;
  const displayExtraItems = showPendingRecurring
    ? [
        ...totals.extraItems,
        ...(pendingDailyExtra > 0
          ? [
              {
                id: `pending-daily-extra-${date}`,
                date,
                label: "Daily recurring Extra",
                amount: pendingDailyExtra,
                category: "RECURRING_DAILY" as const,
                showInDailyBudget: true,
                voided: false,
              },
            ]
          : []),
        ...(pendingManagerFee > 0
          ? [
              {
                id: `pending-manager-fee-${date}`,
                date,
                label: "Manager's daily fee",
                amount: pendingManagerFee,
                category: "MANAGER_FEE" as const,
                showInDailyBudget: true,
                voided: false,
              },
            ]
          : []),
      ]
    : totals.extraItems;
  const computedChange = advance - expense;
  const changeReturned = manualChange ?? computedChange;
  const totalBudget = totals.mealsSubtotal + displayExtraAmount - deduction;
  const isFuture = date > todayKey();

  async function confirmDay(): Promise<boolean> {
    const result = await saveBazarRecord({
      date,
      deductionAmount: deduction,
      deductionReason: reason,
      advanceGiven: advance,
      actualExpense: expense,
      changeReturned: manualChange ?? undefined,
    });
    if (!result.ok) {
      toast.error(result.error ?? "Could not confirm the bazar");
      return false;
    }
    if (!isConfirmed) {
      toast.success("Bazar confirmed — daily Extra and manager fee registered");
    }
    return true;
  }

  /**
   * Exporting always confirms the day first, so a slip can never carry figures
   * that were not registered.
   */
  async function confirmThenExport(): Promise<boolean> {
    const okToExport = await confirmDay();
    if (!okToExport) return false;
    startTransition(() => router.refresh());
    return true;
  }

  function toggleRecurring(item: WorkspaceExtra, voided: boolean) {
    const kind = item.category === "MANAGER_FEE" ? "manager-fee" : "daily-extra";
    startTransition(async () => {
      applyExtraPatch({ id: item.id, voided });
      const result = await toggleAutoExtra({ date, kind, voided });
      if (!result.ok) toast.error(result.error ?? "Could not update the extra");
      else toast.success(result.message ?? "Updated");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <InfoIcon />
        <AlertDescription className="text-xs">
          This is the <strong>target budget</strong> — what the shopper should get.
          Actual spending is tracked separately below and never changes what an
          individual member owes.
        </AlertDescription>
      </Alert>

      {state.error ? (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.ok && state.message ? (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {isFuture ? null : isConfirmed ? (
        <Alert className="border-emerald-300 bg-emerald-50/60">
          <CheckCircle2Icon className="text-emerald-700" />
          <AlertDescription className="text-xs">
            This day is <strong>confirmed</strong>. The daily Extra and the
            manager&rsquo;s fee are registered, and the day counts towards the
            mess&rsquo;s running days for the month.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-amber-300 bg-amber-50/70">
          <AlertTriangleIcon className="text-amber-700" />
          <AlertDescription className="text-xs">
            This day is <strong>not confirmed yet</strong>, so nothing is
            registered. Confirming adds the {formatTaka(pendingDailyExtra)} daily
            Extra and the {formatTaka(pendingManagerFee)} manager&rsquo;s fee to
            the month pool. Downloading or sharing the slip confirms it for you.
          </AlertDescription>
        </Alert>
      )}

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <header className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
          <h2 className="font-heading text-sm font-semibold">Budget breakdown</h2>
          <span className="text-xs text-muted-foreground">
            rate card: {totals.rateCard ? formatTaka(totals.rateCard.fullMealRate) + " full" : "none"}
          </span>
        </header>
        <div className="divide-y">
          <Line
            label="Full Meal"
            detail={`${totals.fullCount} × ${totals.rateCard?.fullMealRate ?? 0}`}
            amount={totals.fullAmount}
          />
          <Line
            label="Half Meal"
            detail={`${totals.halfCount} × ${totals.rateCard?.halfMealRate ?? 0}`}
            amount={totals.halfAmount}
          />
          <Line
            label="Guest Full Meal"
            detail={`${totals.guestFullCount} × ${totals.rateCard?.guestFullRate ?? 0}`}
            amount={totals.guestFullAmount}
          />
          <Line
            label="Guest Half Meal"
            detail={`${totals.guestHalfCount} × ${totals.rateCard?.guestHalfRate ?? 0}`}
            amount={totals.guestHalfAmount}
          />
          {ramadanMode && totals.sehriCount > 0 ? (
            <Line
              label="Sehri"
              detail={`${totals.sehriCount} × ${totals.rateCard?.sehriRate ?? 0}`}
              amount={totals.sehriAmount}
            />
          ) : null}
          {displayExtraItems.length > 0 ? (
            displayExtraItems.map((item) => (
              <Line key={item.id} label={item.label} amount={item.amount} />
            ))
          ) : (
            <Line label="Extra" detail="nothing flagged for today" amount={0} />
          )}
          {deduction > 0 ? (
            <Line
              label="Deduction"
              detail={reason || "reason required"}
              amount={-deduction}
              negative
            />
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-3 py-2.5">
          <span className="font-heading text-sm font-semibold">Total Budget</span>
          <span className="font-heading text-lg font-semibold tabular-nums">
            {formatTaka(totalBudget)}
          </span>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <header className="border-b bg-muted/40 px-3 py-2">
          <h2 className="font-heading text-sm font-semibold">
            Today&rsquo;s recurring costs
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {isConfirmed
              ? "Charged for today because the bazar is confirmed. Turn either off if nothing was cooked."
              : "These are charged for each day the bazar actually runs. They register when you confirm today."}
          </p>
        </header>
        <div className="divide-y">
          {showPendingRecurring ? (
            <>
              {pendingDailyExtra > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Daily recurring Extra</p>
                    <p className="text-[11px] text-muted-foreground">
                      Pending — charged when you confirm today
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {formatTaka(pendingDailyExtra)}
                  </span>
                </div>
              ) : null}
              {pendingManagerFee > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      Manager&rsquo;s daily fee
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Pending — charged when you confirm today
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                    {formatTaka(pendingManagerFee)}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}

          {extras
            .filter((item) => item.date === date)
            .filter((item) => item.isAuto || item.category !== "RECURRING_DAILY")
            .map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      item.voided && "text-muted-foreground line-through",
                    )}
                  >
                    {item.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {EXTRA_CATEGORY_LABELS[item.category]} ·{" "}
                    {item.showInDailyBudget
                      ? "in today's budget"
                      : "month pool only"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      item.voided && "text-muted-foreground line-through",
                    )}
                  >
                    {formatTaka(item.amount)}
                  </span>
                  {item.isAuto ? (
                    <Switch
                      aria-label={`Include ${item.label} today`}
                      checked={!item.voided}
                      onCheckedChange={(checked) => toggleRecurring(item, !checked)}
                    />
                  ) : null}
                </div>
              </div>
            ))}
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="text-sm font-medium">Extra in today&rsquo;s budget</span>
            <span className="font-heading text-sm font-semibold tabular-nums">
              {formatTaka(displayExtraAmount)}
            </span>
          </div>
          {showPendingRecurring && pendingRecurringAmount > 0 ? (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              {formatTaka(pendingDailyExtra)} daily Extra +{" "}
              {formatTaka(pendingManagerFee)} manager fee ={" "}
              {formatTaka(pendingRecurringAmount)}. These join the month pool, so
              they also count as the mess&rsquo;s running days for the month.
            </p>
          ) : null}
        </div>
      </section>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="date" value={date} />

        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <header className="border-b bg-muted/40 px-3 py-2">
            <h2 className="font-heading text-sm font-semibold">
              Deduction &amp; cash
            </h2>
          </header>
          <div className="flex flex-col gap-4 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="deductionAmount">Deduction amount</Label>
                <Input
                  id="deductionAmount"
                  name="deductionAmount"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={deduction === 0 ? "" : deduction}
                  placeholder="0"
                  onChange={(event) =>
                    setDeduction(Math.max(0, Number(event.target.value) || 0))
                  }
                  className="h-10"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="deductionReason"
                  className={cn(deduction > 0 && "text-red-700")}
                >
                  Reason {deduction > 0 ? "(required)" : ""}
                </Label>
                <Input
                  id="deductionReason"
                  name="deductionReason"
                  value={reason}
                  required={deduction > 0}
                  aria-invalid={deduction > 0 && !reason.trim()}
                  aria-describedby="deductionReason-help"
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="e.g. Khala took money for masala"
                  className={cn(
                    "h-10",
                    deduction > 0 &&
                      "border-red-400 text-red-700 placeholder:text-red-400",
                  )}
                />
                <p id="deductionReason-help" className="text-[11px] text-muted-foreground">
                  Required only when the deduction amount is above 0.
                </p>
              </div>
            </div>

            {deduction > 0 ? (
              <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                −{formatTaka(deduction)}{" "}
                {reason ? `— ${reason}` : "— add a reason before saving"}
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="advanceGiven">Advance given</Label>
                <Input
                  id="advanceGiven"
                  name="advanceGiven"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={advance === 0 ? "" : advance}
                  placeholder="0"
                  onChange={(event) =>
                    setAdvance(Math.max(0, Number(event.target.value) || 0))
                  }
                  className="h-10"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="actualExpense">Actual market expense</Label>
                <Input
                  id="actualExpense"
                  name="actualExpense"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={expense === 0 ? "" : expense}
                  placeholder="0"
                  onChange={(event) =>
                    setExpense(Math.max(0, Number(event.target.value) || 0))
                  }
                  className="h-10"
                />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="changeReturned">Change returned</Label>
                  {manualChange !== null ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                      onClick={() => setManualChange(null)}
                    >
                      <RotateCcwIcon className="size-3" />
                      recalculate
                    </button>
                  ) : null}
                </div>
                <Input
                  id="changeReturned"
                  name="changeReturned"
                  type="number"
                  inputMode="numeric"
                  value={changeReturned}
                  onChange={(event) => setManualChange(Number(event.target.value) || 0)}
                  className="h-10"
                />
                <p className="text-[11px] text-muted-foreground">
                  {manualChange === null
                    ? "Advance − expense, corrected by hand if cash was rounded."
                    : "Manually corrected."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <span>Advance {formatTaka(advance)}</span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              <span>Spent {formatTaka(expense)}</span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              <span
                className={cn(
                  "font-semibold",
                  changeReturned < 0 && "text-red-700",
                )}
              >
                Returned {formatTaka(changeReturned)}
              </span>
              {changeReturned < 0 ? (
                <span className="text-xs font-medium text-red-700">
                  (the shopper spent more than the advance)
                </span>
              ) : null}
            </div>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="lg"
            disabled={saving || isFuture}
            className={cn(
              "text-base",
              isConfirmed
                ? "bg-emerald-700 text-white hover:bg-emerald-800"
                : "bg-emerald-600 text-white hover:bg-emerald-700",
            )}
          >
            {saving ? (
              "Confirming…"
            ) : (
              <>
                <CheckCircle2Icon />
                {isConfirmed ? "Update confirmed bazar" : "Confirm today's bazar"}
              </>
            )}
          </Button>
          <PdfButton
            targetId="bazar-slip"
            fileName={`bazar-slip-${date}.pdf`}
            label={isConfirmed ? "Download PDF slip" : "Confirm & download slip"}
            format="a4"
            orientation="portrait"
            size="lg"
            beforeExport={isFuture ? undefined : confirmThenExport}
            variant="outline"
          />
          <PdfButton
            targetId="bazar-slip"
            fileName={`bazar-slip-${date}.pdf`}
            label={isConfirmed ? "Share slip" : "Confirm & share slip"}
            format="a4"
            orientation="portrait"
            mode="share"
            variant="outline"
            size="lg"
            className="hidden sm:inline-flex"
            beforeExport={isFuture ? undefined : confirmThenExport}
          />
        </div>
        {isFuture ? (
          <p className="text-xs text-muted-foreground">
            You cannot record a bazar for a future date.
          </p>
        ) : null}
      </form>

      <section className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-sm font-semibold">Room by room</h2>
          <span className="text-xs text-muted-foreground">
            {khalaDidShopping
              ? "Khala did the shopping"
              : dutyRoomNumbers.length > 0
                ? `Duty: ${dutyRoomNumbers.map((room) => `Room ${room}`).join(" + ")}`
                : "No duty assigned"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Room</th>
                <th className="py-1.5 px-2 text-center font-medium">Full</th>
                <th className="py-1.5 px-2 text-center font-medium">Half</th>
                <th className="py-1.5 px-2 text-center font-medium">Guest</th>
                <th className="py-1.5 pl-2 text-center font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.roomId} className="border-b last:border-0">
                  <td className="py-1.5 pr-2 font-medium">{room.roomNumber}</td>
                  <td className="py-1.5 px-2 text-center tabular-nums">
                    {room.fullCount}
                  </td>
                  <td className="py-1.5 px-2 text-center tabular-nums">
                    {room.halfCount}
                  </td>
                  <td className="py-1.5 px-2 text-center tabular-nums">
                    {room.guestFullCount + room.guestHalfCount}
                  </td>
                  <td className="py-1.5 pl-2 text-center font-semibold tabular-nums">
                    {room.totalMeals}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <MealStatusLegend />
        </div>
      </section>

      {/* Rendered off-screen so it can be rasterised into the PDF. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: -10000,
          top: 0,
          pointerEvents: "none",
          zIndex: -1,
        }}
      >
        <div id="bazar-slip">
          <BazarSlip
            hostelName={hostelName}
            address={address}
            date={date}
            dutyRoomNumbers={dutyRoomNumbers}
            khalaDidShopping={khalaDidShopping}
            rooms={rooms}
            totals={{
              ...totals,
              extraItems: displayExtraItems,
              extraAmount: displayExtraAmount,
              totalBudget,
              deductionAmount: deduction,
            }}
            deductionReason={reason || null}
            advanceGiven={advance}
            actualExpense={expense}
            changeReturned={changeReturned}
            ramadanMode={ramadanMode}
          />
        </div>
      </div>
    </div>
  );
}

function Line({
  label,
  detail,
  amount,
  negative = false,
}: {
  label: string;
  detail?: string;
  amount: number;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {detail ? (
          <p className="truncate text-[11px] text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          negative && "text-red-700",
        )}
      >
        {negative ? `−${formatTaka(Math.abs(amount))}` : formatTaka(amount)}
      </span>
    </div>
  );
}
