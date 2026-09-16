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
  memberCount,
  totalCost,
  totalDeposits,
  totalClosing,
}: {
  month: string;
  months: string[];
  closed: boolean;
  memberCount: number;
  totalCost: number;
  totalDeposits: number;
  totalClosing: number;
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
            targetId="ledger-sheet"
            fileName={`settlement-${month}.pdf`}
            label="Share"
            format="a4"
            orientation="landscape"
            mode="share"
            variant="outline"
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
            <Button onClick={() => setConfirming(true)} disabled={pending}>
              <LockIcon />
              Close {formatMonthDisplay(month)}
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {closed
          ? "These figures are frozen. Editing meals, deposits or bills for this month will not change them."
          : "This is a live preview. Closing the month freezes these numbers and carries each closing balance into the next month."}
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
            <AlertDialogDescription>
              This discards the locked snapshot for the month and lets the numbers
              be recomputed. The next month&rsquo;s opening balances will change.
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
