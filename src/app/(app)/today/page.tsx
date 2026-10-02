import type { Metadata } from "next";
import Link from "next/link";

import { DateNav } from "@/components/date-nav";
import { PageHeader, Stat } from "@/components/page-header";
import {
  computeDayTotals,
  managerFeeDeduction,
  mealChargeGate,
  rateCardFor,
  roomBreakdownForDay,
  unconfirmedChargeableDays,
} from "@/lib/calc";
import {
  formatLongDisplay,
  isValidDateKey,
  monthOf,
  monthStart,
  todayKey,
} from "@/lib/dates";
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

  // Days this month that would have charged members but were never confirmed.
  // They cost nothing, which is the point — but the manager should see them
  // before a month-end bill freezes them away for good.
  const skippedDays = unconfirmedChargeableDays({
    gate: mealChargeGate(snapshot.settings, snapshot.confirmedBazarDates),
    members: snapshot.members,
    changes: snapshot.changes,
    guestMeals: snapshot.guestMeals,
    from: monthStart(monthOf(today)),
    to: today,
    today: snapshot.today,
  });

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

  const hasAutoRows = dayExtras.some((item) => item.isAuto);
  const pendingRecurringAmount =
    record === null && !hasAutoRows
      ? (rateCard?.dailyExtraAmount ?? 0)
      : 0;

  const hasActivity =
    totals.fullCount +
      totals.halfCount +
      totals.guestFullCount +
      totals.guestHalfCount +
      totals.sehriCount >
      0 ||
    budgetExtraAmount > 0 ||
    pendingRecurringAmount > 0;
  const deductionAmount = record?.deductionAmount ?? 0;
  // The one function the engine uses, so this card, the slip and the stored
  // record can never show three different budgets for the same day.
  const feeDeduction = managerFeeDeduction({
    fee: rateCard?.managerDailyFee ?? 0,
    hasActivity,
    mealsSubtotal: totals.mealsSubtotal,
    extraAmount: budgetExtraAmount + pendingRecurringAmount,
    deductionAmount,
  });

  const budgetTotal =
    totals.mealsSubtotal +
    budgetExtraAmount +
    pendingRecurringAmount -
    feeDeduction -
    deductionAmount;

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

      {skippedDays.length > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="font-heading font-semibold">
            {skippedDays.length} day{skippedDays.length === 1 ? "" : "s"} this
            month charged nobody
          </p>
          <p className="mt-1 text-muted-foreground">
            Meals were recorded but the bazar was never confirmed, so nothing was
            deducted. That is right for a day with nobody in the hostel — but if
            you did shop, confirm the day and it will be charged.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {skippedDays.map((day) => (
              <li key={day}>
                <Link
                  href={`/today?date=${day}`}
                  className="inline-block rounded-md border bg-background px-2 py-1 text-xs tabular-nums hover:bg-accent"
                >
                  {day}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
          confirmed: record !== null,
        }}
        ramadanMode={snapshot.settings.ramadanMode}
      />
    </>
  );
}
