import type { Metadata } from "next";

import { DateNav } from "@/components/date-nav";
import { PageHeader, Stat } from "@/components/page-header";
import {
  computeDayTotals,
  rateCardFor,
  roomBreakdownForDay,
} from "@/lib/calc";
import { formatLongDisplay, isValidDateKey, todayKey } from "@/lib/dates";
import { formatTaka } from "@/lib/money";
import { requireSession } from "@/server/auth";
import { ensureAutoExtrasForDate } from "@/server/auto-extras";
import { getBazarDuty, getBazarRecord, loadLedgerSnapshot } from "@/server/queries";
import { BazarWorkspace } from "./bazar-workspace";
import { DutyEditor } from "@/components/duty-editor";

export const metadata: Metadata = { title: "Today's Bazar" };

export default async function TodayPage(props: PageProps<"/today">) {
  await requireSession();

  const searchParams = await props.searchParams;
  const rawDate = typeof searchParams.date === "string" ? searchParams.date : undefined;
  const today = todayKey();
  const date =
    rawDate && isValidDateKey(rawDate) && rawDate <= today ? rawDate : today;

  // The recurring daily Extra and manager's fee must exist as real line items
  // so the day's budget and the month-end pool both include them.
  try {
    await ensureAutoExtrasForDate(date);
  } catch {
    // A read-only replica or a transient write failure should not blank the page.
  }

  const [snapshot, duty, record] = await Promise.all([
    loadLedgerSnapshot(),
    getBazarDuty(date),
    getBazarRecord(date),
  ]);

  const rateCard = rateCardFor(snapshot.rateCards, date);

  const totals = computeDayTotals({
    date,
    members: snapshot.members,
    changes: snapshot.changes,
    guestMeals: snapshot.guestMeals,
    extras: snapshot.extras,
    rateCard,
    deductionAmount: record?.deductionAmount ?? 0,
    ramadanMode: snapshot.settings.ramadanMode,
    today: snapshot.today,
  });

  const rooms = roomBreakdownForDay({
    date,
    members: snapshot.members,
    rooms: snapshot.rooms,
    changes: snapshot.changes,
    guestMeals: snapshot.guestMeals,
    ramadanMode: snapshot.settings.ramadanMode,
    today: snapshot.today,
  });

  const dayExtras = snapshot.extras.filter((item) => item.date === date);
  const budgetExtraAmount = dayExtras
    .filter((item) => item.showInDailyBudget && !item.voided)
    .reduce((total, item) => total + item.amount, 0);

  // Until the day is confirmed there are no recurring rows yet, but the shopper
  // still needs a budget that includes them. This mirrors what the workspace
  // shows, so the headline figure and the breakdown never disagree.
  const hasAutoRows = dayExtras.some((item) => item.isAuto);
  const pendingRecurringAmount =
    record === null && !hasAutoRows
      ? (rateCard?.dailyExtraAmount ?? 0) + (rateCard?.managerDailyFee ?? 0)
      : 0;

  const budgetTotal =
    totals.mealsSubtotal +
    budgetExtraAmount +
    pendingRecurringAmount -
    (record?.deductionAmount ?? 0);

  return (
    <>
      <PageHeader
        title="Today's Bazar"
        description={formatLongDisplay(date)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateNav date={date} basePath="/today" />
            <DutyEditor
              date={date}
              rooms={snapshot.rooms.map((room) => ({
                id: room.id,
                number: room.number,
              }))}
              selectedRoomIds={duty?.roomIds ?? []}
              khalaDidShopping={duty?.khalaDidShopping ?? false}
              note={duty?.note ?? null}
            />
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Target budget"
          value={formatTaka(budgetTotal)}
          hint="what the shopper should get"
        />
        <Stat
          label="Full / Half"
          value={`${totals.fullCount} / ${totals.halfCount}`}
          hint={`${totals.guestFullCount + totals.guestHalfCount} guest meals`}
        />
        <Stat
          label="On duty"
          value={
            duty?.khalaDidShopping
              ? "Khala"
              : duty && duty.roomNumbers.length > 0
                ? duty.roomNumbers.join(" + ")
                : "—"
          }
          hint={duty?.khalaDidShopping ? "maid did the market run" : "room number(s)"}
        />
        <Stat
          label="Recorded"
          value={record ? formatTaka(record.advanceGiven) : "—"}
          hint={record ? "advance given" : "not saved yet"}
        />
      </div>

      <BazarWorkspace
        key={date}
        date={date}
        hostelName={snapshot.settings.hostelName}
        address={snapshot.settings.address}
        dutyRoomNumbers={duty?.roomNumbers ?? []}
        khalaDidShopping={duty?.khalaDidShopping ?? false}
        rooms={rooms}
        totals={totals}
        extras={dayExtras}
        initial={{
          deductionAmount: record?.deductionAmount ?? 0,
          deductionReason: record?.deductionReason ?? "",
          advanceGiven: record?.advanceGiven ?? 0,
          actualExpense: record?.actualExpense ?? 0,
          changeReturned:
            record?.changeReturned ??
            (record ? (record.advanceGiven ?? 0) - (record.actualExpense ?? 0) : 0),
          confirmed: record !== null,
        }}
        ramadanMode={snapshot.settings.ramadanMode}
      />
    </>
  );
}
