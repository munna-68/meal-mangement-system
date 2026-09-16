import type { Metadata } from "next";

import { DateNav } from "@/components/date-nav";
import { MealStatusLegend } from "@/components/meal-status";
import { PageHeader, Stat } from "@/components/page-header";
import { computeDayTotals, memberDayStates, rateCardFor } from "@/lib/calc";
import { formatLongDisplay, isValidDateKey, todayKey } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { loadLedgerSnapshot } from "@/server/queries";
import { MealBoard, type BoardRoom } from "./meal-board";

export const metadata: Metadata = { title: "Meal Status" };

export default async function MealsPage(props: PageProps<"/meals">) {
  await requireSession();

  const searchParams = await props.searchParams;
  const rawDate = typeof searchParams.date === "string" ? searchParams.date : undefined;
  const today = todayKey();
  const date =
    rawDate && isValidDateKey(rawDate) && rawDate <= today ? rawDate : today;

  const snapshot = await loadLedgerSnapshot();
  const states = memberDayStates({
    date,
    members: snapshot.members,
    changes: snapshot.changes,
    guestMeals: snapshot.guestMeals,
    today: snapshot.today,
  });

  const rooms: BoardRoom[] = snapshot.rooms
    .map((room) => ({
      id: room.id,
      number: room.number,
      capacity: room.capacity,
      members: snapshot.members
        .filter((member) => member.roomId === room.id && member.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((member) => {
          const state = states.get(member.id);
          return {
            id: member.id,
            name: member.name,
            bloodGroup: member.bloodGroup,
            phone: member.phone,
            active: member.active,
            status: state?.status ?? "OFF",
            sehri: state?.sehri ?? false,
            guestFull: state?.guestFullCount ?? 0,
            guestHalf: state?.guestHalfCount ?? 0,
          };
        }),
    }))
    .filter((room) => room.members.length > 0);

  const totals = computeDayTotals({
    date,
    members: snapshot.members,
    changes: snapshot.changes,
    guestMeals: snapshot.guestMeals,
    extras: snapshot.extras,
    rateCard: rateCardFor(snapshot.rateCards, date),
    ramadanMode: snapshot.settings.ramadanMode,
    today: snapshot.today,
  });

  return (
    <>
      <PageHeader
        title="Meal Status Board"
        description={formatLongDisplay(date)}
        actions={<DateNav date={date} basePath="/meals" />}
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Full meals" value={totals.fullCount} />
        <Stat label="Half meals" value={totals.halfCount} />
        <Stat
          label="Guest meals"
          value={totals.guestFullCount + totals.guestHalfCount}
          hint={`${totals.guestFullCount} full · ${totals.guestHalfCount} half`}
        />
        <Stat
          label="Meal cost today"
          value={formatTaka(totals.mealsSubtotal)}
          hint="meals only, no extras"
        />
      </div>

      <div className="mb-4">
        <MealStatusLegend />
      </div>

      <p className="mb-3 text-xs text-muted-foreground">
        A status is sticky — set it once and it applies every following day until
        you change it again. Editing a past date updates the months that follow.
      </p>

      <MealBoard
        key={date}
        date={date}
        rooms={rooms}
        ramadanMode={snapshot.settings.ramadanMode}
      />
    </>
  );
}
