"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LockIcon, LockOpenIcon } from "lucide-react";

import { useAction } from "@/components/use-action";
import { PdfButton } from "@/components/pdf-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMonthDisplay } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { closeMonth, reopenMonth } from "@/server/actions/settlement";

export function SettlementClient({
  month,
  months,
  closed,
  laterClosedMonths,
  closeBlock,
  memberCount,
  totalCost,
  totalDeposits,
  totalClosing,
  skippedDays,
}: {
  month: string;
  months: string[];
  closed: boolean;
  /** Months closed after this one, whose opening balances will go stale. */
  laterClosedMonths: string[];
  /** Why this month cannot be closed yet, or null when it can. */
  closeBlock: string | null;
  memberCount: number;
  totalCost: number;
  totalDeposits: number;
  totalClosing: number;
  /**
   * Days in this month that had meals but no confirmed bazar, so they were not
   * charged. Closing freezes that permanently, so the manager is told before
   * doing it rather than after.
   */
  skippedDays: string[];
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [reopening, setReopening] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={month}
          onValueChange={(value) => router.push(`/settlement?month=${value}`)}
        >
          <SelectTrigger className="w-48" aria-label="Choose month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((value) => (
              <SelectItem key={value} value={value}>
                {formatMonthDisplay(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {closed ? (
          <Badge variant="outline" className="gap-1 border-emerald-400 text-emerald-700">
            <LockIcon className="size-3" />
            Closed &amp; locked
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-amber-400 text-amber-700">
            Preview — not locked
          </Badge>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PdfButton
            targetId="ledger-sheet"
            fileName={`settlement-${month}.pdf`}
            label="Download ledger"
            format="a4"
            orientation="landscape"
          />
          <PdfButton
            targetId="meal-register-sheet"
            fileName={`meal-register-${month}.pdf`}
            label="Meal register"
            format="a4"
            orientation="landscape"
            variant="outline"
          />
          <PdfButton
            targetId="meal-register-sheet"
            fileName={`meal-register-${month}.pdf`}
            label="Share register"
            format="a4"
            orientation="landscape"
            mode="share"
            variant="ghost"
          />
          <PdfButton
            targetId="ledger-sheet"
            fileName={`settlement-${month}.pdf`}
            label="Share ledger"
            format="a4"
            orientation="landscape"
            mode="share"
            variant="ghost"
          />
          {closed ? (
            <Button
              variant="outline"
              onClick={() => setReopening(true)}
              disabled={pending}
            >
              <LockOpenIcon />
              Reopen
            </Button>
          ) : (
            <Button
              onClick={() => setConfirming(true)}
              disabled={pending || closeBlock !== null}
              title={closeBlock ?? undefined}
            >
              <LockIcon />
              Close {formatMonthDisplay(month)}
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {closed
          ? "These figures are frozen, and the month is locked — the ledger, the meal register and both PDFs all come from the same stored snapshot. Reopen the month to make changes."
          : closeBlock
            ? "This is a live preview, but the month cannot be closed yet — see the note below."
            : "This is a live preview. Closing the month freezes these numbers and carries each closing balance into the next month. A month can only be closed once the month before it has been closed."}
      </p>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Close {formatMonthDisplay(month)}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  This locks the month for {memberCount} member
                  {memberCount === 1 ? "" : "s"}:
                </p>
                <ul className="list-inside list-disc text-muted-foreground">
                  <li>Total cost: {formatTaka(totalCost)}</li>
                  <li>Deposits this month: {formatTaka(totalDeposits)}</li>
                  <li>
                    Closing balance carried forward: {formatTaka(totalClosing)}
                  </li>
                </ul>
                <p className="text-muted-foreground">
                  Recurring daily extras and the manager&rsquo;s fee are generated
                  for every day first, so days nobody opened are still counted.
                </p>
                {skippedDays.length > 0 ? (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {skippedDays.length} day{skippedDays.length === 1 ? "" : "s"}{" "}
                      were not charged
                    </p>
                    <p className="mt-1">
                      {skippedDays.join(", ")} had meals recorded but no confirmed
                      bazar, so nothing was deducted for {skippedDays.length === 1 ? "it" : "them"}. That is
                      correct if the hostel was empty. If you did shop on{" "}
                      {skippedDays.length === 1 ? "that day" : "those days"}, unconfirm and
                      confirm {skippedDays.length === 1 ? "it" : "them"} first — closing now
                      freezes the gap permanently.
                    </p>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                run(() => closeMonth({ month }), {
                  onSuccess: () => setConfirming(false),
                });
              }}
            >
              Close and lock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reopening} onOpenChange={setReopening}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reopen {formatMonthDisplay(month)}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  This unlocks the month and discards its frozen snapshot — both
                  the money figures and the meal register. The month becomes
                  editable again.
                </p>
                <p className="font-medium text-foreground">
                  Every later month&rsquo;s opening balance changes.
                </p>
                {laterClosedMonths.length > 0 ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    These months are already closed and still hold figures based
                    on this month&rsquo;s old closing balances. Each will need to
                    be reopened and closed again to bring the chain back in step:
                    <ul className="mt-1 list-inside list-disc">
                      {laterClosedMonths.map((value) => (
                        <li key={value}>{formatMonthDisplay(value)}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    No later month is closed yet, so nothing downstream depends on
                    this one.
                  </p>
                )}
                <p className="text-muted-foreground">
                  Who reopened it and when is recorded in the audit log.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                run(() => reopenMonth(month), {
                  onSuccess: () => setReopening(false),
                });
              }}
            >
              Reopen month
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
