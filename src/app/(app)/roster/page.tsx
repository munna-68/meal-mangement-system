import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { PdfButton } from "@/components/pdf-button";
import { RosterSheet } from "@/components/roster-sheet";
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
import { getBazarDutiesInRange, getRooms, getSettingsOrDefaults } from "@/server/queries";
import { RosterBoard, type RosterDay } from "./roster-board";

export const metadata: Metadata = { title: "Bazar Roster" };

function roomTypeLabel(capacity: number): string {
  if (capacity <= 1) return "single";
  if (capacity === 2) return "double";
  if (capacity === 3) return "triple";
  return `${capacity} beds`;
}

export default async function RosterPage(props: PageProps<"/roster">) {
  await requireSession();

  const searchParams = await props.searchParams;
  const rawMonth = typeof searchParams.month === "string" ? searchParams.month : undefined;
  const month = rawMonth && isValidMonthKey(rawMonth) ? rawMonth : currentMonthKey();
  const today = todayKey();

  const [rooms, duties, settings] = await Promise.all([
    getRooms(),
    getBazarDutiesInRange(monthStart(month), monthEnd(month)),
    getSettingsOrDefaults(),
  ]);

  const dutyByDate = new Map(duties.map((duty) => [duty.date, duty]));
  const days = daysInMonth(month);

  const rosterDays: RosterDay[] = days.map((day) => {
    const duty = dutyByDate.get(day);
    return {
      date: day,
      label: formatDisplay(day),
      isToday: day === today,
      roomIds: duty?.roomIds ?? [],
      roomNumbers: duty?.roomNumbers ?? [],
      khalaDidShopping: duty?.khalaDidShopping ?? false,
      note: duty?.note ?? null,
    };
  });

  const assignedDays = days.filter((day) => dutyByDate.has(day)).length;
  const khalaDays = duties.filter((duty) => duty.khalaDidShopping).length;

  return (
    <>
      <PageHeader
        title="Bazar Duty Roster"
        description={formatMonthLongDisplay(month)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
            <PdfButton
              targetId="roster-sheet"
              fileName={`bazar-duty-${month}.pdf`}
              label="Download duty list"
              format="a4"
              orientation="portrait"
              variant="secondary"
            />
            <PdfButton
              targetId="roster-sheet"
              fileName={`bazar-duty-${month}.pdf`}
              label="Share duty list"
              format="a4"
              orientation="portrait"
              mode="share"
              variant="outline"
            />
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Days assigned" value={`${assignedDays} / ${days.length}`} />
        <Stat label="Khala shopping days" value={khalaDays} />
        <Stat label="Rooms in rotation" value={rooms.length} />
        <Stat
          label="Single rooms"
          value={rooms.filter((room) => room.capacity <= 1).length}
          hint="paired two-up per day"
        />
      </div>

      <RosterBoard
        month={month}
        days={rosterDays}
        rooms={rooms.map((room) => ({
          id: room.id,
          number: room.number,
          typeLabel: roomTypeLabel(room.capacity),
        }))}
      />

      {/* Off-screen copy used to build the PDF. */}
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
        <div id="roster-sheet">
          <RosterSheet
            hostelName={settings.hostelName}
            address={settings.address}
            month={month}
            rows={rosterDays.map((day) => ({
              date: day.date,
              roomNumbers: day.roomNumbers,
              khalaDidShopping: day.khalaDidShopping,
              note: day.note,
            }))}
          />
        </div>
      </div>
    </>
  );
}
