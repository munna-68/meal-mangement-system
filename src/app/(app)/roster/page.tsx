import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, Wand2Icon } from "lucide-react";

import { cn } from "cn";

import { DutyEditor } from "@/components/duty-editor";
import { PageHeader, Stat } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  addMonths,
  currentMonthKey,
  daysInMonth,
  formatDisplay,
  formatMonthLongDisplay,
  isValidMonthKey,
  monthEnd,
  monthStart,
  todayKey,
} from "@/lib/dates";
import { requireSession } from "@/server/auth";
import { getBazarDutiesInRange, getRooms } from "@/server/queries";

export const metadata: Metadata = { title: "Bazar Roster" };

export default async function RosterPage(props: PageProps<"/roster">) {
  await requireSession();

  const searchParams = await props.searchParams;
  const rawMonth = typeof searchParams.month === "string" ? searchParams.month : undefined;
  const month = rawMonth && isValidMonthKey(rawMonth) ? rawMonth : currentMonthKey();
  const today = todayKey();

  const [rooms, duties] = await Promise.all([
    getRooms(),
    getBazarDutiesInRange(monthStart(month), monthEnd(month)),
  ]);

  const dutyByDate = new Map(duties.map((duty) => [duty.date, duty]));
  const days = daysInMonth(month);

  // Convenience only: the room that has gone longest without a turn.
  const lastDutyIndex = new Map<string, number>();
  for (const duty of duties) {
    if (duty.roomIds.length !== 1) continue;
    lastDutyIndex.set(duty.roomIds[0], days.indexOf(duty.date));
  }
  const suggestedRoom = rooms
    .map((room) => ({ room, last: lastDutyIndex.get(room.id) ?? -1 }))
    .sort((a, b) => a.last - b.last)[0]?.room;

  const assignedDays = days.filter((day) => dutyByDate.has(day)).length;
  const khalaDays = duties.filter((duty) => duty.khalaDidShopping).length;

  return (
    <>
      <PageHeader
        title="Bazar Duty Roster"
        description={formatMonthLongDisplay(month)}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" asChild>
              <Link
                href={`/roster?month=${addMonths(month, -1)}`}
                aria-label="Previous month"
              >
                <ChevronLeftIcon />
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/roster?month=${currentMonthKey()}`}>This month</Link>
            </Button>
            <Button variant="outline" size="icon" asChild>
              <Link href={`/roster?month=${addMonths(month, 1)}`} aria-label="Next month">
                <ChevronRightIcon />
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Days assigned" value={`${assignedDays} / ${days.length}`} />
        <Stat label="Khala shopping days" value={khalaDays} />
        <Stat label="Rooms in rotation" value={rooms.length} />
        <Stat
          label="Suggested next"
          value={suggestedRoom ? `Room ${suggestedRoom.number}` : "—"}
          hint="longest without a turn"
        />
      </div>

      <div className="mb-3 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Wand2Icon className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Assignments are manual — the suggestion is only a hint and nothing is
          rotated automatically. You can fill in days ahead of time.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="divide-y">
          {days.map((day) => {
            const duty = dutyByDate.get(day);
            const isToday = day === today;
            return (
              <div
                key={day}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 px-3 py-2.5",
                  isToday && "bg-primary/5",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "w-24 shrink-0 text-sm tabular-nums",
                      isToday ? "font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {formatDisplay(day)}
                  </span>
                  <span className="text-sm">
                    {duty?.khalaDidShopping ? (
                      <span className="font-medium">Khala did the shopping</span>
                    ) : duty && duty.roomNumbers.length > 0 ? (
                      <span className="font-medium">
                        {duty.roomNumbers.map((room) => `Room ${room}`).join(" + ")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not assigned</span>
                    )}
                  </span>
                  {duty?.note ? (
                    <span className="text-xs text-muted-foreground">— {duty.note}</span>
                  ) : null}
                </div>
                <DutyEditor
                  date={day}
                  rooms={rooms.map((room) => ({ id: room.id, number: room.number }))}
                  selectedRoomIds={duty?.roomIds ?? []}
                  khalaDidShopping={duty?.khalaDidShopping ?? false}
                  note={duty?.note ?? null}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
