"use client";

import { useState } from "react";
import { HistoryIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";

import { useAction } from "@/components/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays, formatDisplay, todayKey } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import {
  createRateCard,
  deleteRateCard,
  updateRateCard,
} from "@/server/actions/rates";

export interface RateCardView {
  id: string;
  label: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  fullMealRate: number;
  halfMealRate: number;
  guestFullRate: number;
  guestHalfRate: number;
  sehriRate: number;
  feastFlatCharge: number;
  khalaNormalRate: number;
  khalaSoloRate: number;
  managerDailyFee: number;
  dailyExtraAmount: number;
}

type RateValues = Omit<RateCardView, "id" | "effectiveTo">;

const FIELDS: { key: keyof Omit<RateValues, "label" | "effectiveFrom">; label: string; hint: string }[] = [
  { key: "fullMealRate", label: "Full meal rate", hint: "per member, both meals" },
  { key: "halfMealRate", label: "Half meal rate", hint: "lunch-only or dinner-only" },
  { key: "guestFullRate", label: "Guest full meal rate", hint: "per guest" },
  { key: "guestHalfRate", label: "Guest half meal rate", hint: "per guest" },
  { key: "sehriRate", label: "Sehri rate", hint: "Ramadan only" },
  { key: "feastFlatCharge", label: "Feast flat charge", hint: "suggested for a feast day" },
  { key: "khalaNormalRate", label: "Khala normal rate", hint: "per head, full room" },
  { key: "khalaSoloRate", label: "Khala solo rate", hint: "per head, alone in a 2-bed room" },
  { key: "managerDailyFee", label: "Manager's daily fee", hint: "per day" },
  { key: "dailyExtraAmount", label: "Daily recurring Extra", hint: "per day" },
];

export function RatesClient({ cards }: { cards: RateCardView[] }) {
  const [editing, setEditing] = useState<RateCardView | null>(null);
  const [creating, setCreating] = useState(false);
  const { run, pending } = useAction();

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="font-heading text-sm font-semibold">Current rates</h2>
            <p className="text-xs text-muted-foreground">
              Every calculation looks up the card in force on that date — nothing is
              hardcoded.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon />
            New version
          </Button>
        </header>

        {cards.length > 0 ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            {FIELDS.map((field) => (
              <div key={field.key} className="rounded-lg border px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {field.label}
                </p>
                <p className="mt-0.5 font-heading text-lg font-semibold tabular-nums">
                  {formatTaka(cards[0][field.key])}
                </p>
                <p className="text-[11px] text-muted-foreground">{field.hint}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            No rate card yet. Create one to start pricing meals.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <header className="border-b px-4 py-3">
          <h2 className="flex items-center gap-2 font-heading text-sm font-semibold">
            <HistoryIcon className="size-4" />
            Version history
          </h2>
          <p className="text-xs text-muted-foreground">
            Past rates are never overwritten — changing a rate creates a new version.
          </p>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Effective</th>
                <th className="px-4 py-2 text-left font-medium">Label</th>
                <th className="px-4 py-2 text-right font-medium">Full</th>
                <th className="px-4 py-2 text-right font-medium">Half</th>
                <th className="px-4 py-2 text-right font-medium">Guest F/H</th>
                <th className="px-4 py-2 text-right font-medium">Khala N/S</th>
                <th className="px-4 py-2 text-right font-medium">Manager</th>
                <th className="px-4 py-2 text-right font-medium">Extra/day</th>
                <th className="px-4 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card, index) => (
                <tr key={card.id} className="border-t">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">
                        {formatDisplay(card.effectiveFrom)}
                      </span>
                      {index === 0 ? (
                        <Badge variant="outline" className="border-emerald-400 text-emerald-700">
                          current
                        </Badge>
                      ) : null}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {card.effectiveTo ? `until ${formatDisplay(card.effectiveTo)}` : "open-ended"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {card.label ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatTaka(card.fullMealRate)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatTaka(card.halfMealRate)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatTaka(card.guestFullRate)} / {formatTaka(card.guestHalfRate)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatTaka(card.khalaNormalRate)} / {formatTaka(card.khalaSoloRate)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatTaka(card.managerDailyFee)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatTaka(card.dailyExtraAmount)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Edit rate card"
                        onClick={() => setEditing(card)}
                      >
                        <PencilIcon />
                      </Button>
                      {cards.length > 1 ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Delete rate card"
                          onClick={() => run(() => deleteRateCard(card.id))}
                        >
                          <TrashIcon />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {cards.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">
                    No versions yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        These figures are only starting defaults taken from the mess&rsquo;s paper
        records — adjust them to match current prices.
      </p>

      {creating ? (
        <RateDialog
          key="new"
          open
          title="New rate card version"
          description="Applies from the date you choose. The previous version is closed the day before."
          initial={{
            label: cards[0]?.label ? `${cards[0].label} (updated)` : "",
            effectiveFrom: addDays(todayKey(), 0),
            fullMealRate: cards[0]?.fullMealRate ?? 60,
            halfMealRate: cards[0]?.halfMealRate ?? 35,
            guestFullRate: cards[0]?.guestFullRate ?? 80,
            guestHalfRate: cards[0]?.guestHalfRate ?? 45,
            sehriRate: cards[0]?.sehriRate ?? 70,
            feastFlatCharge: cards[0]?.feastFlatCharge ?? 200,
            khalaNormalRate: cards[0]?.khalaNormalRate ?? 300,
            khalaSoloRate: cards[0]?.khalaSoloRate ?? 400,
            managerDailyFee: cards[0]?.managerDailyFee ?? 30,
            dailyExtraAmount: cards[0]?.dailyExtraAmount ?? 300,
          }}
          pending={pending}
          onClose={() => setCreating(false)}
          onSubmit={(values) =>
            run(() => createRateCard(values), { onSuccess: () => setCreating(false) })
          }
        />
      ) : null}

      {editing ? (
        <RateDialog
          key={editing.id}
          open
          title="Edit rate card"
          description="Correcting a version changes how past days are priced."
          initial={{
            label: editing.label ?? "",
            effectiveFrom: editing.effectiveFrom,
            fullMealRate: editing.fullMealRate,
            halfMealRate: editing.halfMealRate,
            guestFullRate: editing.guestFullRate,
            guestHalfRate: editing.guestHalfRate,
            sehriRate: editing.sehriRate,
            feastFlatCharge: editing.feastFlatCharge,
            khalaNormalRate: editing.khalaNormalRate,
            khalaSoloRate: editing.khalaSoloRate,
            managerDailyFee: editing.managerDailyFee,
            dailyExtraAmount: editing.dailyExtraAmount,
          }}
          pending={pending}
          onClose={() => setEditing(null)}
          onSubmit={(values) =>
            run(() => updateRateCard({ id: editing.id, ...values }), {
              onSuccess: () => setEditing(null),
            })
          }
        />
      ) : null}
    </div>
  );
}

function RateDialog({
  open,
  title,
  description,
  initial,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  initial: RateValues;
  pending: boolean;
  onClose: () => void;
  onSubmit: (values: RateValues) => void;
}) {
  const [label, setLabel] = useState(initial.label ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(initial.effectiveFrom);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      FIELDS.map((field) => [field.key, String(initial[field.key] ?? 0)]),
    ),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-3 overflow-y-auto py-2 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="rate-label">Label</Label>
            <Input
              id="rate-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. March price rise"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rate-from">Effective from</Label>
            <Input
              id="rate-from"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </div>
          {FIELDS.map((field) => (
            <div key={field.key} className="flex flex-col gap-2">
              <Label htmlFor={`rate-${field.key}`}>{field.label}</Label>
              <Input
                id={`rate-${field.key}`}
                type="number"
                min={0}
                inputMode="numeric"
                value={values[field.key]}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
              <p className="text-[11px] text-muted-foreground">{field.hint}</p>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSubmit({
                label,
                effectiveFrom,
                ...(Object.fromEntries(
                  FIELDS.map((field) => [field.key, Number(values[field.key] || 0)]),
                ) as Omit<RateValues, "label" | "effectiveFrom">),
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
