import { Ban, Moon, Sun, Utensils, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "cn";

import type { MealStatus } from "@/lib/calc";

/**
 * The four meal states are given deliberately different shapes and colors so
 * they are distinguishable at a glance and never rely on a number alone.
 */
export const MEAL_STATUS_META: Record<
  MealStatus,
  {
    label: string;
    short: string;
    hint: string;
    Icon: LucideIcon;
    solid: string;
    outline: string;
    text: string;
  }
> = {
  FULL: {
    label: "Full Meal",
    short: "Full",
    hint: "Ate both lunch and dinner",
    Icon: Utensils,
    solid: "bg-emerald-600 text-white",
    outline: "border-emerald-600 text-emerald-700 bg-emerald-50",
    text: "text-emerald-600",
  },
  HALF_DAY: {
    label: "Half-Day",
    short: "Half-Day",
    hint: "Lunch only, dinner off",
    Icon: Sun,
    solid: "bg-amber-500 text-white",
    outline: "border-amber-500 text-amber-700 bg-amber-50",
    text: "text-amber-600",
  },
  HALF_NIGHT: {
    label: "Half-Night",
    short: "Half-Night",
    hint: "Dinner only, lunch off",
    Icon: Moon,
    solid: "bg-indigo-600 text-white",
    outline: "border-indigo-600 text-indigo-700 bg-indigo-50",
    text: "text-indigo-600",
  },
  OFF: {
    label: "Off",
    short: "Off",
    hint: "Ate neither meal",
    Icon: Ban,
    solid: "bg-muted text-muted-foreground",
    outline: "border-border text-muted-foreground bg-muted/50",
    text: "text-muted-foreground",
  },
};

export function MealStatusBadge({
  status,
  withLabel = false,
  filled = true,
  className,
}: {
  status: MealStatus;
  withLabel?: boolean;
  filled?: boolean;
  className?: string;
}) {
  const meta = MEAL_STATUS_META[status];
  const Icon = meta.Icon;
  return (
    <span
      title={`${meta.label} — ${meta.hint}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border text-xs font-medium",
        filled ? cn(meta.solid, "border-transparent") : meta.outline,
        withLabel ? "px-1.5 py-0.5" : "size-6 justify-center",
        className,
      )}
    >
      {status === "OFF" ? (
        <Ban className="size-3.5" aria-hidden />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {withLabel ? <span>{meta.short}</span> : null}
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

/**
 * Guest meals are a separate add-on from the member's own status, so they get
 * their own badge (with a "G") rather than being folded into one number.
 */
export function GuestBadge({
  full = 0,
  half = 0,
  className,
}: {
  full?: number;
  half?: number;
  className?: string;
}) {
  if (full <= 0 && half <= 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {full > 0 ? (
        <span
          title={`${full} guest full meal${full > 1 ? "s" : ""}`}
          className="inline-flex items-center gap-0.5 rounded-md border border-violet-400 bg-violet-100 px-1.5 py-0.5 text-xs font-semibold text-violet-800"
        >
          <Users className="size-3" aria-hidden />
          <span aria-hidden>G{full}</span>
          <span className="sr-only">
            {full} guest full meal{full > 1 ? "s" : ""}
          </span>
        </span>
      ) : null}
      {half > 0 ? (
        <span
          title={`${half} guest half meal${half > 1 ? "s" : ""}`}
          className="inline-flex items-center gap-0.5 rounded-md border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-xs font-semibold text-violet-700"
        >
          <Users className="size-3" aria-hidden />
          <span aria-hidden>G½{half}</span>
          <span className="sr-only">
            {half} guest half meal{half > 1 ? "s" : ""}
          </span>
        </span>
      ) : null}
    </span>
  );
}

export function MealStatusLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      {(["FULL", "HALF_DAY", "HALF_NIGHT", "OFF"] as MealStatus[]).map(
        (status) => (
          <span key={status} className="inline-flex items-center gap-1.5">
            <MealStatusBadge status={status} />
            <span>{MEAL_STATUS_META[status].label}</span>
          </span>
        ),
      )}
      <span className="inline-flex items-center gap-1.5">
        <GuestBadge full={1} />
        <span>Guest meal</span>
      </span>
    </div>
  );
}
