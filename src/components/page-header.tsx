import type { ReactNode } from "react";

import { cn } from "cn";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      {title || actions ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="font-heading text-sm font-semibold">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4", contentClassName)}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "positive" | "negative" | "warning";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5",
        tone === "positive" && "border-emerald-300 bg-emerald-50",
        tone === "negative" && "border-red-300 bg-red-50",
        tone === "warning" && "border-amber-300 bg-amber-50",
        className,
      )}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-heading text-lg font-semibold tabular-nums">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
