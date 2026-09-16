"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, formatDisplay, todayKey } from "@/lib/dates";

export function DateNav({
  date,
  basePath,
  paramName = "date",
  extraParams,
}: {
  date: string;
  basePath: string;
  paramName?: string;
  extraParams?: Record<string, string>;
}) {
  const router = useRouter();
  const today = todayKey();
  const isToday = date >= today;

  function hrefFor(target: string) {
    const params = new URLSearchParams(extraParams);
    if (target !== today) params.set(paramName, target);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" asChild>
        <Link href={hrefFor(addDays(date, -1))} aria-label="Previous day">
          <ChevronLeftIcon />
        </Link>
      </Button>

      <div className="relative">
        <CalendarDaysIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="date"
          value={date}
          max={today}
          aria-label="Pick a date"
          onChange={(event) => {
            const value = event.target.value;
            if (value) router.push(hrefFor(value));
          }}
          className="h-8 w-[10.5rem] pl-8"
        />
      </div>

      {isToday ? (
        <Button variant="outline" size="icon" disabled aria-label="Next day">
          <ChevronRightIcon />
        </Button>
      ) : (
        <Button variant="outline" size="icon" asChild>
          <Link href={hrefFor(addDays(date, 1))} aria-label="Next day">
            <ChevronRightIcon />
          </Link>
        </Button>
      )}

      {isToday ? (
        <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
          {formatDisplay(date)}
        </span>
      ) : (
        <Button variant="ghost" size="sm" asChild>
          <Link href={hrefFor(today)}>Today</Link>
        </Button>
      )}
    </div>
  );
}
