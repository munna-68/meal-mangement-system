/**
 * The mess's calculation engine.
 *
 * Everything in this module is pure: it takes plain data in and returns plain
 * data out, with no database or framework access. Every money figure shown in
 * the app or printed on a PDF comes from here, so the business rules live in
 * exactly one place.
 */

import {
  addDays,
  compare,
  daysInMonth,
  isSameOrAfter,
  isSameOrBefore,
  monthEnd,
  monthOf,
  monthStart,
  todayKey,
  type DateKey,
  type MonthKey,
} from "./dates";
import { roundTaka, sum } from "./money";

export type MealStatus = "FULL" | "HALF_DAY" | "HALF_NIGHT" | "OFF";
export type GuestMealType = "GUEST_FULL" | "GUEST_HALF";
export type ExtraCategory =
  | "RECURRING_DAILY"
  | "ONE_OFF"
  | "MANAGER_FEE"
  | "FEAST"
  | "OTHER";
export type UtilityType = "ELECTRICITY" | "WIFI" | "KHALA";

export interface RateCardData {
  id: string;
  effectiveFrom: DateKey;
  effectiveTo: DateKey | null;
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

export interface RoomData {
  id: string;
  number: string;
  capacity: number;
  /** Let out whole to one person. Absent on older callers, treated as false. */
  solo?: boolean;
}

export interface MemberData {
  id: string;
  name: string;
  roomId: string;
  active: boolean;
  joinDate: DateKey;
  leaveDate: DateKey | null;
}

export interface StatusChangeData {
  memberId: string;
  date: DateKey;
  status: MealStatus;
  sehri: boolean;
}

export interface GuestMealData {
  memberId: string;
  date: DateKey;
  type: GuestMealType;
  count: number;
}

export interface ExtraItemData {
  id: string;
  date: DateKey;
  label: string;
  amount: number;
  category: ExtraCategory;
  showInDailyBudget: boolean;
  voided: boolean;
}

export interface UtilityBillData {
  month: MonthKey;
  type: UtilityType;
  amount: number;
}

export interface DepositData {
  memberId: string;
  date: DateKey;
  amount: number;
}

/**
 * Money taken back out of a member's balance on a given day.
 *
 * `amount` is always positive — the manager types how much to take out — and is
 * *subtracted* from the balance. Storing it signed would make a deduction
 * indistinguishable from a deposit to any query that does not look closely, so
 * the direction lives in the table, not in the number.
 */
export interface DeductionData {
  memberId: string;
  date: DateKey;
  amount: number;
}

/**
 * One dated instalment of khala actually paid to the khala lady. Khala is
 * collected in pieces across the month, so a month carries as many of these as
 * the manager made payments — including none at all, which means the members
 * carry no khala for that month rather than being charged in advance for it.
 */
export interface KhalaPaymentData {
  date: DateKey;
  amount: number;
}

export interface SettlementData {
  memberId: string;
  month: MonthKey;
  openingBalance: number;
  closingBalance: number;
}

/**
 * A manager-declared opening balance: the position a member started a given
 * month with. Signed — positive is credit, negative is an existing debt.
 */
export interface OpeningBalanceData {
  memberId: string;
  month: MonthKey;
  amount: number;
}

export interface MemberStatusOnDay {
  status: MealStatus;
  sehri: boolean;
}

// ---------------------------------------------------------------------------
// Rate cards
// ---------------------------------------------------------------------------

/**
 * The rate card in force on a date: the most recent one that had already taken
 * effect. Dates before the earliest card fall back to that earliest card so an
 * unconfigured day is still computable rather than silently free.
 */
export function rateCardFor(
  cards: RateCardData[],
  date: DateKey,
): RateCardData | null {
  if (cards.length === 0) return null;
  const sorted = [...cards].sort((a, b) =>
    compare(a.effectiveFrom, b.effectiveFrom),
  );
  let chosen: RateCardData | null = null;
  for (const card of sorted) {
    if (isSameOrBefore(card.effectiveFrom, date)) {
      if (card.effectiveTo && compare(card.effectiveTo, date) < 0) continue;
      if (!chosen || compare(card.effectiveFrom, chosen.effectiveFrom) >= 0) {
        chosen = card;
      }
    }
  }
  return chosen ?? sorted[0];
}

// ---------------------------------------------------------------------------
// Membership activity
// ---------------------------------------------------------------------------

export interface ActiveRange {
  from: DateKey;
  to: DateKey | null;
}

/**
 * The window during which a member accrues daily costs. A member marked
 * inactive without an explicit leave date stops accruing from today onwards,
 * so history stays accurate.
 */
export function memberActiveRange(
  member: MemberData,
  today: DateKey = todayKey(),
): ActiveRange {
  const to = member.leaveDate ?? (member.active ? null : today);
  return { from: member.joinDate, to };
}

export function isMemberActiveOn(
  member: MemberData,
  date: DateKey,
  today: DateKey = todayKey(),
): boolean {
  const { from, to } = memberActiveRange(member, today);
  if (compare(date, from) < 0) return false;
  if (to && compare(date, to) > 0) return false;
  return true;
}

export function isMemberActiveInRange(
  member: MemberData,
  from: DateKey,
  to: DateKey,
  today: DateKey = todayKey(),
): boolean {
  const range = memberActiveRange(member, today);
  if (compare(range.from, to) > 0) return false;
  if (range.to && compare(range.to, from) < 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sticky meal status
// ---------------------------------------------------------------------------

/**
 * Resolves each member's status for every day in [from, to] by walking their
 * status changes in order, so a status set once carries forward until the next
 * change. Days before a member's first change count as OFF.
 */
export function resolveStatusTimeline(
  changes: StatusChangeData[],
  memberIds: string[],
  from: DateKey,
  to: DateKey,
): Map<string, Map<DateKey, MemberStatusOnDay>> {
  const byMember = new Map<string, StatusChangeData[]>();
  for (const change of changes) {
    const list = byMember.get(change.memberId);
    if (list) list.push(change);
    else byMember.set(change.memberId, [change]);
  }

  const days: DateKey[] = [];
  let cursor = from;
  let guard = 0;
  while (compare(cursor, to) <= 0) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    if (++guard > 4000) break;
  }

  const timeline = new Map<string, Map<DateKey, MemberStatusOnDay>>();
  for (const memberId of memberIds) {
    const list = (byMember.get(memberId) ?? []).sort((a, b) =>
      compare(a.date, b.date),
    );
    const perDay = new Map<DateKey, MemberStatusOnDay>();
    let pointer = 0;
    let current: MemberStatusOnDay = { status: "OFF", sehri: false };
    for (const day of days) {
      while (pointer < list.length && compare(list[pointer].date, day) <= 0) {
        current = { status: list[pointer].status, sehri: list[pointer].sehri };
        pointer += 1;
      }
      perDay.set(day, current);
    }
    timeline.set(memberId, perDay);
  }
  return timeline;
}

/** Status in force for one member on one day. */
export function statusOnDate(
  changes: StatusChangeData[],
  memberId: string,
  date: DateKey,
): MemberStatusOnDay {
  let current: MemberStatusOnDay = { status: "OFF", sehri: false };
  let best: DateKey | null = null;
  for (const change of changes) {
    if (change.memberId !== memberId) continue;
    if (compare(change.date, date) > 0) continue;
    if (!best || compare(change.date, best) >= 0) {
      best = change.date;
      current = { status: change.status, sehri: change.sehri };
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// Guest meals
// ---------------------------------------------------------------------------

export interface GuestCounts {
  /** Guests eating a full meal, hosted by this member. */
  full: number;
  /** Guests eating a half meal, hosted by this member. */
  half: number;
}

const NO_GUESTS: GuestCounts = { full: 0, half: 0 };

/**
 * Guest counts in force for every member on every day in [from, to].
 *
 * Two readings of the same rows, split at `stickyFrom`:
 *
 * - Before it, a row is an absolute per-day figure: "that many guests, that
 *   day". No row means none. This is how the app has always read the table.
 * - From it on, a row is a *change* that holds until the next one, exactly like
 *   a meal status. So a host set to two full guests keeps two until somebody
 *   changes it, and setting them back to zero is a real change rather than the
 *   deletion of a row.
 *
 * The split is what makes the change safe to ship. Reading every existing row as
 * a change would silently rebill every day after a guest was last seen, moving
 * money for a month that has already been charged. With `stickyFrom` null this
 * is exactly the old behaviour, day for day.
 *
 * A stored zero counts as no guests, the same as no row at all. Both encodings
 * therefore answer identically, so which one a save happened to write can never
 * change a figure — only record whether a change was made.
 */
export function resolveGuestTimeline(input: {
  guestMeals: GuestMealData[];
  memberIds: string[];
  from: DateKey;
  to: DateKey;
  stickyFrom?: DateKey | null;
}): Map<string, Map<DateKey, GuestCounts>> {
  const { guestMeals, memberIds, from, to, stickyFrom = null } = input;

  // Everything up to the end of the window is needed: rows inside it are the
  // changes, and rows before it are what carry-forward continues from, so the
  // scan cannot stop at the window's start. Zero rows are kept too — they are
  // how a carried count is stopped, and dropping them here would resurrect the
  // guests they had cleared.
  const relevant = guestMeals.filter((guest) => compare(guest.date, to) <= 0);
  const byMember = new Map<string, GuestMealData[]>();
  for (const guest of relevant) {
    const list = byMember.get(guest.memberId);
    if (list) list.push(guest);
    else byMember.set(guest.memberId, [guest]);
  }

  const days: DateKey[] = [];
  let cursor = from;
  let guard = 0;
  while (compare(cursor, to) <= 0) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    if (++guard > 4000) break;
  }

  const timeline = new Map<string, Map<DateKey, GuestCounts>>();
  for (const memberId of memberIds) {
    const list = (byMember.get(memberId) ?? []).slice().sort((a, b) =>
      compare(a.date, b.date),
    );
    // One row per type per day, because the table is unique on
    // (member, date, type). A stored zero reads as "none" here, identically to
    // the day having no row at all.
    // Deliberately partial: a row records one type for one day, so saving two
    // full guests must not also clear somebody's three half guests.
    const changeOn = new Map<DateKey, Partial<GuestCounts>>();
    for (const guest of list) {
      const entry = changeOn.get(guest.date) ?? {};
      const count = guest.count > 0 ? guest.count : 0;
      if (guest.type === "GUEST_FULL") entry.full = count;
      else entry.half = count;
      changeOn.set(guest.date, entry);
    }
    const absoluteOn = (day: DateKey): GuestCounts => {
      const entry = changeOn.get(day);
      return { full: entry?.full ?? 0, half: entry?.half ?? 0 };
    };

    const perDay = new Map<DateKey, GuestCounts>();

    if (!stickyFrom) {
      // Carry-forward off: every day is absolute, which is the behaviour the
      // app has always had.
      for (const day of days) perDay.set(day, absoluteOn(day));
      timeline.set(memberId, perDay);
      continue;
    }

    // Days before the boundary. A row here describes that day and nothing else,
    // so a month already billed cannot move when the mess switches this on.
    for (const day of days) {
      if (compare(day, stickyFrom) >= 0) break;
      perDay.set(day, absoluteOn(day));
    }

    // The carry-forward region. The walk starts at the boundary rather than at
    // `from`, because a change recorded inside the sticky range but before the
    // window is just as much in force as one inside it. The first sticky day
    // continues the count already in force instead of dropping everybody to zero
    // on the day the switch is flipped: the seed is the most recent row per type
    // from before the boundary, so a guest deliberately cleared stays cleared.
    const latest = new Map<string, DateKey>();
    for (const guest of list) {
      if (compare(guest.date, stickyFrom) >= 0) continue;
      const previous = latest.get(guest.type);
      if (!previous || compare(guest.date, previous) > 0) {
        latest.set(guest.type, guest.date);
      }
    }
    let full = 0;
    let half = 0;
    for (const guest of list) {
      if (guest.date !== latest.get(guest.type)) continue;
      const count = guest.count > 0 ? guest.count : 0;
      if (guest.type === "GUEST_FULL") full = count;
      else half = count;
    }

    // The walk begins at the boundary itself, never earlier: a day before it is
    // absolute and must not be overwritten by the carried value.
    let walk = stickyFrom;
    let steps = 0;
    while (compare(walk, to) <= 0 && ++steps <= 4000) {
      const change = changeOn.get(walk);
      if (change) {
        if (change.full !== undefined) full = change.full;
        if (change.half !== undefined) half = change.half;
      }
      if (compare(walk, from) >= 0) perDay.set(walk, { full, half });
      walk = addDays(walk, 1);
    }

    timeline.set(memberId, perDay);
  }
  return timeline;
}


/** The guest counts in force for one member on one day. Always a value. */
export function guestCountsOn(
  guestMeals: GuestMealData[],
  memberId: string,
  date: DateKey,
  stickyFrom?: DateKey | null,
): GuestCounts {
  const timeline = resolveGuestTimeline({
    guestMeals,
    memberIds: [memberId],
    from: date,
    to: date,
    stickyFrom,
  });
  return timeline.get(memberId)?.get(date) ?? NO_GUESTS;
}

// ---------------------------------------------------------------------------
// Daily totals (the Today's Bazar budget)
// ---------------------------------------------------------------------------

export interface DayTotals {
  date: DateKey;
  rateCard: RateCardData | null;
  fullCount: number;
  halfCount: number;
  /** Members eating the night meal (ফুল + হাফ-নাইট). */
  nightCount: number;
  /** Members eating the noon meal (ফুল + হাফ-ডে). */
  noonCount: number;
  guestFullCount: number;
  guestHalfCount: number;
  sehriCount: number;
  fullAmount: number;
  halfAmount: number;
  guestFullAmount: number;
  guestHalfAmount: number;
  guestDeductionAmount: number;
  sehriAmount: number;
  mealsSubtotal: number;
  extraItems: ExtraItemData[];
  extraAmount: number;
  managerFeeAmount: number;
  deductionAmount: number;
  totalBudget: number;
}

export interface DayTotalsInput {
  date: DateKey;
  members: MemberData[];
  changes: StatusChangeData[];
  guestMeals: GuestMealData[];
  extras: ExtraItemData[];
  rateCard: RateCardData | null;
  deductionAmount?: number;
  ramadanMode?: boolean;
  today?: DateKey;
  /** See `resolveGuestTimeline`. Null leaves guests as a plain per-day figure. */
  stickyGuestMealsFrom?: DateKey | null;
}

/**
 * How much of the manager's daily fee is held back from the bazar cash.
 *
 * The fee can never exceed what the day actually cost, so a very cheap day
 * cannot produce a negative budget — a number nobody can hand over or read off a
 * slip. Every screen that shows the day's budget reads this one function, so
 * the figure on the slip, on the card and in the stored record always agree.
 */
export function managerFeeDeduction(input: {
  fee: number;
  hasActivity: boolean;
  mealsSubtotal: number;
  extraAmount: number;
  deductionAmount?: number;
}): number {
  if (!input.hasActivity) return 0;
  const available = Math.max(
    0,
    input.mealsSubtotal + input.extraAmount - (input.deductionAmount ?? 0),
  );
  return Math.min(input.fee, available);
}

/**
 * The day's budget: meal counts priced at the day's rate card, plus the extras
 * flagged for the daily budget, minus any deduction.
 */
export function computeDayTotals(input: DayTotalsInput): DayTotals {
  const {
    date,
    members,
    changes,
    guestMeals,
    extras,
    rateCard,
    deductionAmount = 0,
    ramadanMode = false,
    today = todayKey(),
  } = input;

  const activeMembers = members.filter((member) =>
    isMemberActiveOn(member, date, today),
  );
  const activeIds = new Set(activeMembers.map((m) => m.id));

  let fullCount = 0;
  let halfCount = 0;
  let nightCount = 0;
  let noonCount = 0;
  let sehriCount = 0;
  for (const member of activeMembers) {
    const { status, sehri } = statusOnDate(changes, member.id, date);
    if (status === "FULL") {
      fullCount += 1;
      // A full member eats both meal-times.
      nightCount += 1;
      noonCount += 1;
    } else if (status === "HALF_DAY") {
      halfCount += 1;
      noonCount += 1;
    } else if (status === "HALF_NIGHT") {
      halfCount += 1;
      nightCount += 1;
    }
    if (ramadanMode && sehri) sehriCount += 1;
  }

  let guestFullCount = 0;
  let guestHalfCount = 0;
  // Read through the resolver rather than by matching the date, so the day
  // budget counts the same guests the board shows and the month will charge.
  const dayGuests = resolveGuestTimeline({
    guestMeals,
    memberIds: [...activeIds],
    from: date,
    to: date,
    stickyFrom: input.stickyGuestMealsFrom ?? null,
  });
  for (const memberId of activeIds) {
    const counts = dayGuests.get(memberId)?.get(date) ?? NO_GUESTS;
    guestFullCount += counts.full;
    guestHalfCount += counts.half;
  }

  const dailyExtras = extras.filter(
    (item) =>
      item.date === date &&
      item.showInDailyBudget &&
      !item.voided &&
      item.category !== "MANAGER_FEE" &&
      !("sourceKey" in item && typeof (item as { sourceKey?: string }).sourceKey === "string" && (item as { sourceKey?: string }).sourceKey?.startsWith("auto:manager-fee:")),
  );
  const extraAmount = sum(dailyExtras.map((item) => item.amount));

  const fullAmount = rateCard ? fullCount * rateCard.fullMealRate : 0;
  const halfAmount = rateCard ? halfCount * rateCard.halfMealRate : 0;
  const guestFullAmount = rateCard ? guestFullCount * rateCard.guestFullRate : 0;
  const guestHalfAmount = rateCard ? guestHalfCount * rateCard.guestHalfRate : 0;
  const totalGuestMeals = guestFullCount + guestHalfCount;
  const guestDeductionAmount =
    rateCard && totalGuestMeals > 0 ? totalGuestMeals * 5 : 0;
  const sehriAmount = rateCard && ramadanMode ? sehriCount * rateCard.sehriRate : 0;

  const mealsSubtotal =
    fullAmount +
    halfAmount +
    guestFullAmount +
    guestHalfAmount -
    guestDeductionAmount +
    sehriAmount;

  // The manager's daily fee is held back / deducted from the bazar cash.
  const hasActivity =
    fullCount + halfCount + guestFullCount + guestHalfCount + sehriCount > 0 ||
    extraAmount > 0;
  const managerFeeAmount = managerFeeDeduction({
    fee: rateCard?.managerDailyFee ?? 0,
    hasActivity,
    mealsSubtotal,
    extraAmount,
    deductionAmount,
  });
  const totalBudget =
    mealsSubtotal + extraAmount - managerFeeAmount - deductionAmount;

  return {
    date,
    rateCard,
    fullCount,
    halfCount,
    nightCount,
    noonCount,
    guestFullCount,
    guestHalfCount,
    sehriCount,
    fullAmount,
    halfAmount,
    guestFullAmount,
    guestHalfAmount,
    guestDeductionAmount,
    sehriAmount,
    mealsSubtotal,
    extraItems: dailyExtras,
    extraAmount,
    managerFeeAmount,
    deductionAmount,
    totalBudget,
  };
}

export interface RoomDayRow {
  roomId: string;
  roomNumber: string;
  capacity: number;
  memberNames: string[];
  fullCount: number;
  halfCount: number;
  /** Members eating the night meal (ফুল + হাফ-নাইট). */
  nightCount: number;
  /** Members eating the noon meal (ফুল + হাফ-ডে). */
  noonCount: number;
  guestFullCount: number;
  guestHalfCount: number;
  guestCount: number;
  sehriCount: number;
  totalMeals: number;
}

/** Room-by-room table used on the daily bazar slip. */
export function roomBreakdownForDay(input: {
  date: DateKey;
  members: MemberData[];
  rooms: RoomData[];
  changes: StatusChangeData[];
  guestMeals: GuestMealData[];
  ramadanMode?: boolean;
  today?: DateKey;
  stickyGuestMealsFrom?: DateKey | null;
}): RoomDayRow[] {
  const {
    date,
    members,
    rooms,
    changes,
    guestMeals,
    ramadanMode = false,
    today = todayKey(),
  } = input;

  const rows = new Map<string, RoomDayRow>();
  for (const room of rooms) {
    rows.set(room.id, {
      roomId: room.id,
      roomNumber: room.number,
      capacity: room.capacity,
      memberNames: [],
      fullCount: 0,
      halfCount: 0,
      nightCount: 0,
      noonCount: 0,
      guestFullCount: 0,
      guestHalfCount: 0,
      guestCount: 0,
      sehriCount: 0,
      totalMeals: 0,
    });
  }

  for (const member of members) {
    if (!isMemberActiveOn(member, date, today)) continue;
    const row = rows.get(member.roomId);
    if (!row) continue;
    row.memberNames.push(member.name);
    const { status, sehri } = statusOnDate(changes, member.id, date);
    if (status === "FULL") {
      row.fullCount += 1;
      row.nightCount += 1;
      row.noonCount += 1;
    } else if (status === "HALF_DAY") {
      row.halfCount += 1;
      row.noonCount += 1;
    } else if (status === "HALF_NIGHT") {
      row.halfCount += 1;
      row.nightCount += 1;
    }
    if (ramadanMode && sehri) row.sehriCount += 1;
  }

  // Read through the resolver so a room card shows the same guest counts the
  // day budget and the month charge are using.
  const dayGuests = resolveGuestTimeline({
    guestMeals,
    memberIds: members.map((member) => member.id),
    from: date,
    to: date,
    stickyFrom: input.stickyGuestMealsFrom ?? null,
  });
  for (const [memberId, countsForDay] of dayGuests) {
    const counts = countsForDay.get(date) ?? NO_GUESTS;
    if (counts.full <= 0 && counts.half <= 0) continue;
    const member = members.find((m) => m.id === memberId);
    if (!member) continue;
    if (!isMemberActiveOn(member, date, today)) continue;
    const row = rows.get(member.roomId);
    if (!row) continue;
    row.guestFullCount += counts.full;
    row.guestHalfCount += counts.half;
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      guestCount: row.guestFullCount + row.guestHalfCount,
      totalMeals:
        row.fullCount + row.halfCount + row.guestFullCount + row.guestHalfCount,
    }))
    .sort((a, b) =>
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }),
    );
}

export interface RegisterCell {
  day: DateKey;
  /** null when the member was not living here yet, or the day is still ahead. */
  status: MealStatus | null;
  /**
   * False only when the day happened but is not settled yet, because its bazar
   * is still unconfirmed. Such a day is left out of the row's totals and
   * printed blank, so the register shows only what has been confirmed and its
   * figures agree with the settlement. The status stays on the cell because the
   * meal really did happen — only the printing and the count ignore it. Absent
   * on snapshots frozen before this existed, which reads as "counted", keeping
   * older closed months exactly as they were.
   */
  billable?: boolean;
}

export interface RegisterRow {
  memberId: string;
  name: string;
  roomNumber: string;
  cells: RegisterCell[];
  fullCount: number;
  halfCount: number;
}

/**
 * A month's meal register frozen at close time. Stored on `month_closes` so the
 * closed-month screen and its PDFs read one frozen source instead of
 * recomputing from live data.
 */
export interface RegisterSnapshot {
  days: DateKey[];
  rows: RegisterRow[];
}

/**
 * Month-at-a-glance register: one row per member, one column per day, with the
 * F / D / N / off code for each. Days beyond the cutoff (or before the member
 * joined) stay blank, and only counted days contribute to the totals — so the
 * ফুল / হাফ figures here always agree with the settlement ledger.
 */
export function mealRegisterForMonth(input: {
  month: MonthKey;
  cutoff?: DateKey;
  members: MemberData[];
  rooms: RoomData[];
  changes: StatusChangeData[];
  today?: DateKey;
  /**
   * When the mess charges a day only after its bazar is confirmed, the register
   * has to use the same rule or its totals disagree with the settlement. Passed
   * in rather than read here so one caller decides policy for every screen.
   */
  gate?: MealChargeGate | null;
}): { days: DateKey[]; cutoff: DateKey; rows: RegisterRow[] } {
  const { month, members, rooms, changes, today = todayKey() } = input;
  const gate = input.gate ?? null;

  const days = daysInMonth(month);
  const first = monthStart(month);
  const last = monthEnd(month);
  // Never show codes for days that have not happened yet.
  const requested = input.cutoff ?? last;
  const withinMonth = compare(requested, last) < 0 ? requested : last;
  const cutoff = compare(withinMonth, today) < 0 ? withinMonth : today;

  const activeMembers = members.filter((member) =>
    isMemberActiveInRange(member, first, cutoff),
  );
  const timeline = resolveStatusTimeline(
    changes,
    activeMembers.map((m) => m.id),
    first,
    cutoff,
  );

  const roomNumberById = new Map(rooms.map((room) => [room.id, room.number]));

  const rows: RegisterRow[] = activeMembers.map((member) => {
    const perDay = timeline.get(member.id);
    let fullCount = 0;
    let halfCount = 0;

    const cells = days.map((day) => {
      // Blank for days outside this member's stay, and for days still ahead.
      if (compare(day, cutoff) > 0 || !isMemberActiveOn(member, day, today)) {
        return { day, status: null };
      }
      const { status } = perDay?.get(day) ?? { status: "OFF" as MealStatus };
      // Same test the money uses, so the ফুল / হাফ totals here are the totals
      // that were billed. The status stays on the cell because the meal did
      // happen; the flag is what tells the sheet to print the day blank until
      // its bazar is confirmed, so the register only ever shows settled days.
      const billable = !gate || dayIsChargeable(day, gate);
      if (billable) {
        if (status === "FULL") fullCount += 1;
        else if (status === "HALF_DAY" || status === "HALF_NIGHT") halfCount += 1;
      }
      return { day, status, billable };
    });

    return {
      memberId: member.id,
      name: member.name,
      roomNumber: roomNumberById.get(member.roomId) ?? "—",
      cells,
      fullCount,
      halfCount,
    };
  });

  rows.sort(
    (a, b) =>
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }) ||
      a.name.localeCompare(b.name),
  );

  return { days, cutoff, rows };
}

// ---------------------------------------------------------------------------
// Per-member day status + guest summary (Meal Status Board, PDF indicators)
// ---------------------------------------------------------------------------

export interface MemberDayState {
  memberId: string;
  status: MealStatus;
  sehri: boolean;
  guestFullCount: number;
  guestHalfCount: number;
  active: boolean;
}

export function memberDayStates(input: {
  date: DateKey;
  members: MemberData[];
  changes: StatusChangeData[];
  guestMeals: GuestMealData[];
  today?: DateKey;
  stickyGuestMealsFrom?: DateKey | null;
}): Map<string, MemberDayState> {
  const {
    date,
    members,
    changes,
    guestMeals,
    today = todayKey(),
    stickyGuestMealsFrom = null,
  } = input;
  const states = new Map<string, MemberDayState>();
  for (const member of members) {
    const { status, sehri } = statusOnDate(changes, member.id, date);
    states.set(member.id, {
      memberId: member.id,
      status,
      sehri,
      guestFullCount: 0,
      guestHalfCount: 0,
      active: isMemberActiveOn(member, date, today),
    });
  }
  // One resolver for the whole day, so the board can never show a guest count
  // that the day budget or the month charge would disagree with.
  const timeline = resolveGuestTimeline({
    guestMeals,
    memberIds: members.map((member) => member.id),
    from: date,
    to: date,
    stickyFrom: stickyGuestMealsFrom,
  });
  for (const member of members) {
    const state = states.get(member.id);
    if (!state) continue;
    const counts = timeline.get(member.id)?.get(date) ?? NO_GUESTS;
    state.guestFullCount = counts.full;
    state.guestHalfCount = counts.half;
  }
  return states;
}

// ---------------------------------------------------------------------------
// Month-level shared costs
// ---------------------------------------------------------------------------

export interface RoomOccupancy {
  roomId: string;
  capacity: number;
  /** Room is let out whole to one person — a "special" room. */
  solo: boolean;
  occupants: number;
  hasActiveMember: boolean;
}

export function occupancyForRange(input: {
  members: MemberData[];
  rooms: RoomData[];
  from: DateKey;
  to: DateKey;
  today?: DateKey;
}): Map<string, RoomOccupancy> {
  const { members, rooms, from, to, today = todayKey() } = input;
  const map = new Map<string, RoomOccupancy>();
  for (const room of rooms) {
    map.set(room.id, {
      roomId: room.id,
      capacity: room.capacity,
      solo: room.solo ?? false,
      occupants: 0,
      hasActiveMember: false,
    });
  }
  for (const member of members) {
    if (!isMemberActiveInRange(member, from, to, today)) continue;
    const entry = map.get(member.roomId);
    if (!entry) continue;
    entry.occupants += 1;
    entry.hasActiveMember = true;
  }
  return map;
}

export interface UtilityShare {
  electricity: number;
  wifi: number;
  total: number;
}

export interface UtilityApportionment {
  perHeadElectricity: number;
  perHeadWifi: number;
  totalElectricity: number;
  totalWifi: number;
  memberCount: number;
  soloCount: number;
  byMember: Map<string, UtilityShare>;
}

/**
 * A member counts as "solo" when they are the only occupant of a room with two
 * or more beds. That single condition drives both the higher Khala rate and the
 * solo utility multipliers, so it lives in one place.
 *
 * `room.solo` records that the room is let out whole to one person. It is kept
 * deliberately out of the arithmetic: a special room still has to be *alone* to
 * bill as solo, so a second person moving in turns it back into an ordinary
 * shared room rather than leaving one person charged for a whole double room
 * that is now shared. Ordinary multi-bed rooms with a single occupant continue
 * to bill as solo, which is what makes an unfilled double expensive for the
 * person in it.
 */
export function isSoloInSharedRoom(room: RoomOccupancy | undefined): boolean {
  return !!room && room.capacity >= 2 && room.occupants <= 1;
}

/**
 * Distributes an integer money total across items according to proportional weights,
 * using the largest-remainder (Hare-Niemeyer) method. The sum of the resulting
 * integers is guaranteed to equal `totalAmount` exactly.
 */
export function distributeTaka(totalAmount: number, weights: number[]): number[] {
  if (totalAmount === 0 || weights.length === 0) {
    return weights.map(() => 0);
  }
  const totalWeight = sum(weights);
  if (totalWeight <= 0) {
    return weights.map(() => 0);
  }

  const exacts = weights.map((w) => (w / totalWeight) * totalAmount);
  const floors = exacts.map((e) => Math.floor(e));
  const currentSum = sum(floors);
  const remainder = Math.round(totalAmount - currentSum);

  const indices = weights.map((_, i) => i);
  indices.sort((a, b) => {
    const diffA = exacts[a] - floors[a];
    const diffB = exacts[b] - floors[b];
    return diffB - diffA || a - b;
  });

  const result = [...floors];
  for (let i = 0; i < remainder && i < indices.length; i++) {
    result[indices[i]] += 1;
  }
  return result;
}

/**
 * Electricity and wifi are split using room capacity weights: a member alone in
 * a multi-bed room pays a multiple of the electricity and/or wifi share.
 * The total bill is apportioned proportionally across all members so that the sum
 * of all members' shares equals the bill amount exactly (no phantom overcharging).
 */
export function apportionUtilities(input: {
  members: MemberData[];
  rooms: RoomData[];
  bills: UtilityBillData[];
  from: DateKey;
  to: DateKey;
  soloElectricityMultiplier?: number;
  soloWifiMultiplier?: number;
  today?: DateKey;
}): UtilityApportionment {
  const {
    members,
    rooms,
    bills,
    from,
    to,
    soloElectricityMultiplier = 2,
    soloWifiMultiplier = 1,
    today = todayKey(),
  } = input;
  const month = monthOf(from);
  const occupancy = occupancyForRange({ members, rooms, from, to, today });

  const monthBills = bills.filter((bill) => bill.month === month);
  const totalElectricity = sum(
    monthBills
      .filter((bill) => bill.type === "ELECTRICITY")
      .map((bill) => bill.amount),
  );
  const totalWifi = sum(
    monthBills.filter((bill) => bill.type === "WIFI").map((bill) => bill.amount),
  );

  const activeMembers = members.filter((member) =>
    isMemberActiveInRange(member, from, to, today),
  );
  const memberCount = activeMembers.length;

  const isSoloList = activeMembers.map((member) =>
    isSoloInSharedRoom(occupancy.get(member.roomId)),
  );
  const soloCount = isSoloList.filter(Boolean).length;

  const elecWeights = isSoloList.map((solo) =>
    solo ? soloElectricityMultiplier : 1,
  );
  const wifiWeights = isSoloList.map((solo) =>
    solo ? soloWifiMultiplier : 1,
  );

  const totalElecWeight = sum(elecWeights);
  const totalWifiWeight = sum(wifiWeights);

  const perHeadElectricity =
    totalElecWeight > 0 ? totalElectricity / totalElecWeight : 0;
  const perHeadWifi =
    totalWifiWeight > 0 ? totalWifi / totalWifiWeight : 0;

  const fullElectricityShares = distributeTaka(totalElectricity, elecWeights);
  const fullWifiShares = distributeTaka(totalWifi, wifiWeights);

  // These are flat monthly bills charged in full to every member of the month,
  // so there is no per-member fraction to apply here.
  const byMember = new Map<string, UtilityShare>();
  activeMembers.forEach((member, i) => {
    const electricity = fullElectricityShares[i];
    const wifi = fullWifiShares[i];
    byMember.set(member.id, {
      electricity,
      wifi,
      total: electricity + wifi,
    });
  });

  return {
    perHeadElectricity: roundTaka(perHeadElectricity),
    perHeadWifi: roundTaka(perHeadWifi),
    totalElectricity,
    totalWifi,
    memberCount,
    soloCount,
    byMember,
  };
}

/**
 * The khala rate a single member *would* carry for a whole month: the normal
 * rate when a room is at full occupancy, the higher solo rate when a member is
 * alone in a multi-bed room, and the normal rate in a 1-capacity room.
 *
 * This is the rate the mess *intends* to charge, used for two things only:
 * what a full month's khala should come to, and the ceiling on how much may be
 * logged as paid. It is deliberately not the amount anybody is charged — see
 * `apportionKhala`, which charges only khala that has actually been handed over.
 */
export function khalaAmountFor(input: {
  member: MemberData;
  occupancy: Map<string, RoomOccupancy>;
  rateCard: RateCardData | null;
}): number {
  const { member, occupancy, rateCard } = input;
  if (!rateCard) return 0;
  const room = occupancy.get(member.roomId);
  if (!room) return rateCard.khalaNormalRate;
  return isSoloInSharedRoom(room)
    ? rateCard.khalaSoloRate
    : rateCard.khalaNormalRate;
}

export interface KhalaApportionment {
  /** Every member's own share. The shares always add back up to `totalPaid`. */
  byMember: Map<string, number>;
  /** Khala actually handed over this month. */
  totalPaid: number;
  /** What the rate card says a full month of khala should cost. */
  monthlyTarget: number;
  /** `monthlyTarget − totalPaid`. Never negative: logging is capped at target. */
  outstanding: number;
  /** True once the month's khala has been paid in full. */
  fullyPaid: boolean;
  memberCount: number;
}

/**
 * Splits the khala the manager has actually paid out this month across the
 * members of the month.
 *
 * Khala is handed over in instalments — 5,000 now, the rest later — so the mess
 * cannot know the month's khala on the 1st and must not charge for it in
 * advance. Each member therefore carries a share of what has genuinely been
 * paid, and nobody carries anything for a month where nothing has been paid.
 * That keeps `balance = opening + deposits − cost − deductions` an honest
 * statement about money: it never counts khala that is still sitting in the
 * mess's hand.
 *
 * The split is weighted exactly as the rate card intends, so a solo member
 * carries the solo *proportion* of the paid khala. The shares always sum to
 * `totalPaid` exactly, so the mess's own khala outflow is never over- or
 * under-charged across the board.
 */
export function apportionKhala(input: {
  members: MemberData[];
  rooms: RoomData[];
  payments: KhalaPaymentData[];
  from: DateKey;
  to: DateKey;
  rateCard: RateCardData | null;
  today?: DateKey;
}): KhalaApportionment {
  const { members, rooms, payments, from, to, rateCard, today = todayKey() } =
    input;

  const activeMembers = members.filter((member) =>
    isMemberActiveInRange(member, from, to, today),
  );
  const occupancy = occupancyForRange({ members, rooms, from, to, today });

  // A month's khala is whatever was paid on a date inside that month, however
  // many instalments it took.
  const totalPaid = sum(
    payments
      .filter(
        (payment) =>
          compare(payment.date, from) >= 0 && compare(payment.date, to) <= 0,
      )
      .map((payment) => payment.amount),
  );

  // The rate card's per-head amounts double as the split weights, so a fully
  // paid month apportions out to exactly the rates on the card and a partly paid
  // month apportions the same proportions of what has been paid so far.
  const weights = activeMembers.map((member) =>
    khalaAmountFor({ member, occupancy, rateCard }),
  );
  const monthlyTarget = sum(weights);

  const shares = distributeTaka(totalPaid, weights);
  const byMember = new Map<string, number>();
  activeMembers.forEach((member, index) => {
    byMember.set(member.id, shares[index]);
  });

  return {
    byMember,
    totalPaid,
    monthlyTarget,
    outstanding: Math.max(0, monthlyTarget - totalPaid),
    fullyPaid: totalPaid >= monthlyTarget && monthlyTarget > 0,
    memberCount: activeMembers.length,
  };
}

export interface ExtraPool {
  total: number;
  /** Every member's own share. The shares always add back up to `total`. */
  shares: Map<string, number>;
  /** The lowest share, which is the only figure safe to quote as "per head". */
  perMember: number;
  memberCount: number;
}

/**
 * Every extra line item dated in the window is pooled and split across the
 * members active in that window.
 *
 * The split is by largest remainder, so every member's own share is handed to
 * them and the shares add back up to the pool to the taka. Individual shares
 * differ by at most one taka; there is no rounding fund and no created or lost
 * money.
 *
 * NOTE (deliberate, do not "fix"): the manager's daily fee is a *separate*
 * line item that is added on top of the recurring daily Extra, not carved out
 * of it. Both are created by `server/auto-extras.ts` and both are summed here.
 * The mess owner confirmed the two figures are meant to be additive.
 *
 * Unlike Khala and the utility bills, the pool is naturally bounded by `to`:
 * it only contains line items dated on or before that day.
 */
export function extraPoolForRange(input: {
  extras: ExtraItemData[];
  from: DateKey;
  to: DateKey;
  activeMemberIds: string[];
}): ExtraPool {
  const { extras, from, to, activeMemberIds } = input;
  const total = sum(
    extras
      .filter(
        (item) =>
          !item.voided &&
          item.category !== "MANAGER_FEE" &&
          !("sourceKey" in item && typeof (item as { sourceKey?: string }).sourceKey === "string" && (item as { sourceKey?: string }).sourceKey?.startsWith("auto:manager-fee:")) &&
          isSameOrAfter(item.date, from) &&
          isSameOrBefore(item.date, to),
      )
      .map((item) => item.amount),
  );
  const memberCount = activeMemberIds.length;
  // Equal weights, split by largest remainder, so the members' shares always add
  // back up to the pool exactly. Rounding the average instead would invent or
  // lose taka every month the pool was not divisible by the head count.
  const amounts = distributeTaka(
    total,
    activeMemberIds.map(() => 1),
  );
  const shares = new Map<string, number>();
  activeMemberIds.forEach((id, index) => shares.set(id, amounts[index]));
  const perMember = amounts.length > 0 ? Math.min(...amounts) : 0;
  return { total, shares, perMember, memberCount };
}

export interface MonthlyFixedExtraSummary {
  month: MonthKey;
  totalDaysInMonth: number;
  mealDaysRan: number;
  dailyRate: number;
  totalDailyExtra: number;
  boarderCount: number;
  perBoarderCost: number;
  managerDailyFee: number;
  totalManagerFee: number;
  perBoarderManagerFee: number;
  combinedPerBoarder: number;
}

/**
 * Calculates the monthly fixed extra breakdown based on confirmed meal days and active boarders.
 * e.g., 28 meal days * ৳300/day = ৳8,400 ÷ 30 boarders = ৳280/boarder.
 * Manager fee is completely excluded from the pool and per-head cost.
 */
export function computeMonthlyFixedExtraSummary(input: {
  month: MonthKey;
  confirmedBazarDaysCount: number;
  rateCard: RateCardData | null;
  activeMemberCount: number;
}): MonthlyFixedExtraSummary {
  const { month, confirmedBazarDaysCount, rateCard, activeMemberCount } = input;
  const totalDaysInMonth = daysInMonth(month).length;
  const mealDaysRan = confirmedBazarDaysCount;
  const dailyRate = rateCard?.dailyExtraAmount ?? 0;
  const totalDailyExtra = mealDaysRan * dailyRate;
  const perBoarderCost =
    activeMemberCount > 0 ? roundTaka(totalDailyExtra / activeMemberCount) : 0;

  return {
    month,
    totalDaysInMonth,
    mealDaysRan,
    dailyRate,
    totalDailyExtra,
    boarderCount: activeMemberCount,
    perBoarderCost,
    managerDailyFee: 0,
    totalManagerFee: 0,
    perBoarderManagerFee: 0,
    combinedPerBoarder: perBoarderCost,
  };
}

// ---------------------------------------------------------------------------
// Whole-month computation
// ---------------------------------------------------------------------------

export interface MemberMonthCost {
  memberId: string;
  fullMealCount: number;
  halfMealCount: number;
  sehriCount: number;
  guestFullCount: number;
  guestHalfCount: number;
  mealAmount: number;
  khalaAmount: number;
  electricityAmount: number;
  wifiAmount: number;
  khalaElecWifiAmount: number;
  extraAmount: number;
  totalCost: number;
}

export interface MonthComputation {
  month: MonthKey;
  from: DateKey;
  to: DateKey;
  cutoff: DateKey;
  activeMemberIds: string[];
  perMember: Map<string, MemberMonthCost>;
  utilities: UtilityApportionment;
  khala: KhalaApportionment;
  extraPool: ExtraPool;
  totals: {
    fullMealCount: number;
    halfMealCount: number;
    guestFullCount: number;
    guestHalfCount: number;
    sehriCount: number;
    mealAmount: number;
    khalaAmount: number;
    electricityAmount: number;
    wifiAmount: number;
    extraAmount: number;
    totalCost: number;
  };
}

/**
 * The confirmation gate.
 *
 * A member's meal status is sticky — it carries forward until somebody changes
 * it — so charging every day up to `today` meant the balance grew a day's meals
 * the moment midnight passed, with no confirmation anywhere. Passing a gate says
 * that from `startsOn` onward a day only costs money once its bazar has been
 * confirmed.
 *
 * `startsOn` is not cosmetic: the gate never reaches backwards. Days before it
 * are charged exactly as they always were, so turning this on cannot silently
 * refund a month of meals the members have already been billed for.
 */
export interface MealChargeGate {
  /** Inclusive first day the gate applies to. */
  startsOn: DateKey;
  /** Every day whose bazar has been confirmed. */
  confirmedDays: ReadonlySet<DateKey>;
}

/**
 * Whether a day may charge members for meals and guest meals.
 *
 * Before the gate starts, always yes. From `startsOn` on, only a confirmed day.
 * A day with no bazar record costs nobody anything, permanently — that is what
 * makes an empty hostel, or a day simply not confirmed, free rather than
 * silently billed later.
 */
export function dayIsChargeable(day: DateKey, gate: MealChargeGate): boolean {
  return compare(day, gate.startsOn) < 0 || gate.confirmedDays.has(day);
}

/**
 * Builds the gate from the mess's own configuration, or null when the gate is
 * off. One place decides whether gating applies at all, so every screen prices
 * the balance the same way and cannot disagree with another.
 */
export function mealChargeGate(
  settings: { mealChargeGateStarts: DateKey | null },
  confirmedDays: Iterable<DateKey>,
): MealChargeGate | null {
  const startsOn = settings.mealChargeGateStarts;
  if (!startsOn) return null;
  return { startsOn, confirmedDays: new Set(confirmedDays) };
}

/**
 * The most recent day the bazar has been confirmed for, never looking past
 * today. Null when nothing has ever been confirmed.
 */
export function latestConfirmedDay(
  confirmedDays: Iterable<DateKey>,
  today: DateKey = todayKey(),
): DateKey | null {
  let latest: DateKey | null = null;
  for (const day of confirmedDays) {
    if (compare(day, today) > 0) continue;
    if (latest === null || compare(day, latest) > 0) latest = day;
  }
  return latest;
}

/**
 * The days in a window that *would* charge members but are not being charged,
 * because the gate is on and their bazar was never confirmed.
 *
 * This is the mess's early-warning list. A skipped day is free by design — an
 * empty hostel should cost nobody anything — but it is also money the manager
 * may not realise they are giving away, so the app shows it rather than letting
 * it disappear silently into a month-end bill that can never be reopened.
 *
 * Activity is read from the resolved status timeline rather than from the change
 * rows, because status is sticky: a member left on FULL has an implicit meal on
 * every day since, with nothing recorded on it.
 */
export function unconfirmedChargeableDays(input: {
  gate: MealChargeGate | null;
  members: MemberData[];
  changes: StatusChangeData[];
  guestMeals: GuestMealData[];
  from: DateKey;
  to: DateKey;
  today?: DateKey;
}): DateKey[] {
  const { gate, members, changes, guestMeals, from, to } = input;
  const today = input.today ?? todayKey();
  // With the gate off nothing is being skipped, so there is nothing to warn about.
  if (!gate) return [];

  const end = compare(to, today) < 0 ? to : today;
  if (compare(from, end) > 0) return [];

  const active = members.filter((member) =>
    isMemberActiveInRange(member, from, end, today),
  );
  const timeline = resolveStatusTimeline(
    changes,
    active.map((member) => member.id),
    from,
    end,
  );
  // A day only counts as having guests if the row says there were some. A stored
  // zero records "deliberately none" so it can stop a carried-forward count, and
  // must not make the day look like it hosted somebody.
  const guestDays = new Set(
    guestMeals.filter((guest) => guest.count > 0).map((guest) => guest.date),
  );

  const skipped: DateKey[] = [];
  let cursor = from;
  let guard = 0;
  while (compare(cursor, end) <= 0) {
    if (++guard > 2000) break;
    if (!dayIsChargeable(cursor, gate)) {
      const someoneAte = active.some((member) => {
        const state = timeline.get(member.id)?.get(cursor);
        return state ? state.status !== "OFF" : false;
      });
      if (someoneAte || guestDays.has(cursor)) skipped.push(cursor);
    }
    cursor = addDays(cursor, 1);
  }
  return skipped;
}

export interface MonthComputationInput {
  month: MonthKey;
  /** Compute only up to this date; defaults to the end of the month. */
  cutoff?: DateKey;
  /**
   * Require a confirmed bazar before a day may charge for meals and guest
   * meals. Absent means no gate, which is the historical behaviour.
   */
  gate?: MealChargeGate | null;
  /**
   * Says "this is the month's bill" rather than "this is where the mess is
   * today". It no longer changes a single figure: the flat monthly charges are
   * charged in full either way (see the comment in `computeMonth`) and meals stop
   * at `today` in both cases, because a day that has not happened cannot be
   * billed. Kept so a caller can still be explicit about which it wants.
   */
  finalize?: boolean;
  members: MemberData[];
  rooms: RoomData[];
  changes: StatusChangeData[];
  guestMeals: GuestMealData[];
  extras: ExtraItemData[];
  bills: UtilityBillData[];
  /** Dated khala instalments actually paid. Absent means no khala was paid. */
  khalaPayments?: KhalaPaymentData[];
  rateCards: RateCardData[];
  ramadanMode?: boolean;
  /** See `resolveGuestTimeline`. Null leaves guests as a plain per-day figure. */
  stickyGuestMealsFrom?: DateKey | null;
  /** Multiples of the per-head utility share charged to a solo member. */
  soloElectricityMultiplier?: number;
  soloWifiMultiplier?: number;
  today?: DateKey;
}

/**
 * Computes every member's cost for one month. Running the same function with a
 * mid-month `cutoff` gives the month-to-date figures used by the live balance
 * dashboard, so both paths are guaranteed to agree.
 */
export function computeMonth(input: MonthComputationInput): MonthComputation {
  const {
    month,
    members,
    rooms,
    changes,
    guestMeals,
    extras,
    bills,
    khalaPayments = [],
    rateCards,
    ramadanMode = false,
    stickyGuestMealsFrom = null,
    soloElectricityMultiplier = 2,
    soloWifiMultiplier = 1,
    today = todayKey(),
    gate = null,
  } = input;
  const stickyFrom = stickyGuestMealsFrom;

  const from = monthStart(month);
  const lastDay = monthEnd(month);
  // Never bill a day that has not happened yet: an in-progress month is
  // computed up to today, while a finished month runs to its last day.
  const requested =
    input.cutoff && compare(input.cutoff, lastDay) < 0 ? input.cutoff : lastDay;
  const cutoff = compare(requested, today) < 0 ? requested : today;

  const activeMembers = members.filter((member) =>
    isMemberActiveInRange(member, from, cutoff, today),
  );
  const activeMemberIds = activeMembers.map((member) => member.id);

  // The mess's rule: Khala, electricity and wifi are flat monthly charges, so
  // every member of the month pays the whole of them at the per-head average.
  // Nobody is pro-rated by days present — somebody who joins on the 20th, or
  // leaves on the 3rd, still carries a full month, exactly as on paper — and the
  // figures therefore do not move during the month, so a live balance and a
  // closed month can never disagree about them.
  //
  // Meals and guest meals are still counted day by day; only these three charges
  // are flat. So `finalize` no longer changes a single figure — it is kept only
  // so a caller can still say "this is the month's bill".
  const timeline = resolveStatusTimeline(
    changes,
    activeMemberIds,
    from,
    cutoff,
  );

  const perMember = new Map<string, MemberMonthCost>();
  for (const member of activeMembers) {
    perMember.set(member.id, {
      memberId: member.id,
      fullMealCount: 0,
      halfMealCount: 0,
      sehriCount: 0,
      guestFullCount: 0,
      guestHalfCount: 0,
      mealAmount: 0,
      khalaAmount: 0,
      electricityAmount: 0,
      wifiAmount: 0,
      khalaElecWifiAmount: 0,
      extraAmount: 0,
      totalCost: 0,
    });
  }

  // Guests are priced on the day they are hosted, and read through the resolver
  // so a count carried forward from an earlier day is charged on every day it
  // actually applies, not only on the day it was typed.
  const guestTimeline = resolveGuestTimeline({
    guestMeals,
    memberIds: activeMemberIds,
    from,
    to: cutoff,
    stickyFrom,
  });

  // Meal costs are priced day by day so a mid-month rate change is accurate.
  for (const day of daysInMonth(month)) {
    if (compare(day, cutoff) > 0) break;
    // Once the gate is on, an unconfirmed day charges nobody.
    if (gate && !dayIsChargeable(day, gate)) continue;
    const card = rateCardFor(rateCards, day);
    for (const member of activeMembers) {
      if (!isMemberActiveOn(member, day, today)) continue;
      const state = timeline.get(member.id)?.get(day);
      if (!state) continue;
      const row = perMember.get(member.id)!;
      if (state.status === "FULL") {
        row.fullMealCount += 1;
        row.mealAmount += card?.fullMealRate ?? 0;
      } else if (state.status === "HALF_DAY" || state.status === "HALF_NIGHT") {
        row.halfMealCount += 1;
        row.mealAmount += card?.halfMealRate ?? 0;
      }
      if (ramadanMode && state.sehri) {
        row.sehriCount += 1;
        row.mealAmount += card?.sehriRate ?? 0;
      }
    }

    // Guests are a separate pass, and deliberately so: a host who is marked OFF
    // can still have guests, so this must not sit behind the status check above.
    // It does inherit the day-level gate — this loop is only reached for a day
    // whose bazar was confirmed, so an unconfirmed day hosts nobody's guests.
    for (const member of activeMembers) {
      if (!isMemberActiveOn(member, day, today)) continue;
      const counts = guestTimeline.get(member.id)?.get(day) ?? NO_GUESTS;
      if (counts.full <= 0 && counts.half <= 0) continue;
      const row = perMember.get(member.id);
      if (!row) continue;
      if (counts.full > 0) {
        row.guestFullCount += counts.full;
        row.mealAmount += (card?.guestFullRate ?? 0) * counts.full;
      }
      if (counts.half > 0) {
        row.guestHalfCount += counts.half;
        row.mealAmount += (card?.guestHalfRate ?? 0) * counts.half;
      }
    }
  }

  const utilities = apportionUtilities({
    members,
    rooms,
    bills,
    from,
    to: cutoff,
    soloElectricityMultiplier,
    soloWifiMultiplier,
    today,
  });
  const extraPool = extraPoolForRange({
    extras,
    from,
    to: cutoff,
    activeMemberIds: activeMembers.map((member) => member.id),
  });

  // Khala is charged on what has actually been handed over, not on what the
  // rate card says the month will come to. Khala is collected in instalments, so
  // charging the full month on the 1st would put a debt on every member for money
  // the mess is still holding. The rate card supplies the split weights and the
  // ceiling, and nothing else.
  const monthCard = rateCardFor(rateCards, from);
  const khala = apportionKhala({
    members,
    rooms,
    payments: khalaPayments,
    from,
    to: cutoff,
    rateCard: monthCard,
    today,
  });

  for (const member of activeMembers) {
    const row = perMember.get(member.id)!;
    const utility = utilities.byMember.get(member.id) ?? {
      electricity: 0,
      wifi: 0,
      total: 0,
    };
    row.electricityAmount = utility.electricity;
    row.wifiAmount = utility.wifi;
    row.khalaAmount = khala.byMember.get(member.id) ?? 0;
    row.khalaElecWifiAmount = row.khalaAmount + utility.total;
    row.extraAmount = extraPool.shares.get(member.id) ?? 0;
    row.totalCost =
      row.mealAmount + row.khalaElecWifiAmount + row.extraAmount;
  }

  const rows = [...perMember.values()];
  const totals = {
    fullMealCount: sum(rows.map((r) => r.fullMealCount)),
    halfMealCount: sum(rows.map((r) => r.halfMealCount)),
    guestFullCount: sum(rows.map((r) => r.guestFullCount)),
    guestHalfCount: sum(rows.map((r) => r.guestHalfCount)),
    sehriCount: sum(rows.map((r) => r.sehriCount)),
    mealAmount: sum(rows.map((r) => r.mealAmount)),
    khalaAmount: sum(rows.map((r) => r.khalaAmount)),
    electricityAmount: sum(rows.map((r) => r.electricityAmount)),
    wifiAmount: sum(rows.map((r) => r.wifiAmount)),
    extraAmount: sum(rows.map((r) => r.extraAmount)),
    totalCost: sum(rows.map((r) => r.totalCost)),
  };

  return {
    month,
    from,
    to: lastDay,
    cutoff,
    activeMemberIds,
    perMember,
    utilities,
    khala,
    extraPool,
    totals,
  };
}

// ---------------------------------------------------------------------------
// Settlement + balances
// ---------------------------------------------------------------------------

export interface SettlementRow extends MemberMonthCost {
  memberId: string;
  memberName: string;
  roomNumber: string;
  openingBalance: number;
  newDeposits: number;
  /** Money taken back out of this member's balance during the month. */
  newDeductions: number;
  availableBalance: number;
  closingBalance: number;
}

export function buildSettlementRows(input: {
  computation: MonthComputation;
  members: MemberData[];
  rooms: RoomData[];
  deposits: DepositData[];
  /** Money taken out of a member's balance during the month. Absent means none. */
  deductions?: DeductionData[];
  openingBalances: Map<string, number>;
}): SettlementRow[] {
  const {
    computation,
    members,
    rooms,
    deposits,
    deductions = [],
    openingBalances,
  } = input;
  const memberById = new Map(members.map((m) => [m.id, m]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const { from, cutoff } = computation;

  return computation.activeMemberIds
    .map((memberId) => {
      const member = memberById.get(memberId)!;
      const cost = computation.perMember.get(memberId)!;
      const newDeposits = sum(
        deposits
          .filter(
            (deposit) =>
              deposit.memberId === memberId &&
              isSameOrAfter(deposit.date, from) &&
              isSameOrBefore(deposit.date, cutoff),
          )
          .map((deposit) => deposit.amount),
      );
      const openingBalance = openingBalances.get(memberId) ?? 0;
      const availableBalance = openingBalance + newDeposits;
      // What actually left the member's hand this month. Subtracted from the
      // closing balance rather than from `availableBalance`, so the "balance
      // after deposit" line on the ledger keeps meaning money they paid in.
      const newDeductions = sum(
        deductions
          .filter(
            (deduction) =>
              deduction.memberId === memberId &&
              isSameOrAfter(deduction.date, from) &&
              isSameOrBefore(deduction.date, cutoff),
          )
          .map((deduction) => deduction.amount),
      );
      return {
        ...cost,
        memberId,
        memberName: member.name,
        roomNumber: roomById.get(member.roomId)?.number ?? "-",
        openingBalance,
        newDeposits,
        newDeductions,
        availableBalance,
        closingBalance: availableBalance - cost.totalCost - newDeductions,
      };
    })
    .sort((a, b) =>
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }) ||
      a.memberName.localeCompare(b.memberName),
    );
}

export interface MemberRunningBalance {
  memberId: string;
  memberName: string;
  roomNumber: string;
  active: boolean;
  openingBalance: number;
  deposits: number;
  /** Money taken back out of this member's balance in the open period. */
  deductions: number;
  utilityCost: number;
  extraCost: number;
  cost: number;
  balance: number;
}

export interface RunningBalanceResult {
  periodStart: DateKey;
  periodEnd: DateKey;
  rows: MemberRunningBalance[];
  /** Khala paid against, and still owed on, each month of the open period. */
  khalaByMonth: Map<string, KhalaMonthStanding>;
  summary: {
    openingBalance: number;
    deposits: number;
    deductions: number;
    utilityCost: number;
    extraCost: number;
    cost: number;
    balance: number;
    membersInDeficit: number;
    totalDeficit: number;
    membersInCredit: number;
    totalCredit: number;
  };
}

/**
 * Live balance for every member over the currently open period (everything
 * after the last closed month), priced with the same month engine but cut off
 * at today.
 */
export function computeRunningBalances(input: {
  members: MemberData[];
  rooms: RoomData[];
  changes: StatusChangeData[];
  guestMeals: GuestMealData[];
  extras: ExtraItemData[];
  bills: UtilityBillData[];
  /** Dated khala instalments actually paid; absent means none were. */
  khalaPayments?: KhalaPaymentData[];
  rateCards: RateCardData[];
  deposits: DepositData[];
  /** Money taken out of balances. Absent means none was. */
  deductions?: DeductionData[];
  /** See `resolveGuestTimeline`. Null leaves guests as a plain per-day figure. */
  stickyGuestMealsFrom?: DateKey | null;
  settlements: SettlementData[];
  /** Manager-declared opening balances, used to seed the first open month. */
  openingBalances: OpeningBalanceData[];
  lastClosedMonth: MonthKey | null;
  ramadanMode?: boolean;
  soloElectricityMultiplier?: number;
  soloWifiMultiplier?: number;
  today?: DateKey;
  /**
   * Require a confirmed bazar before a day may charge for meals and guest
   * meals. Absent means no gate, which is the historical behaviour.
   */
  gate?: MealChargeGate | null;
}): RunningBalanceResult {
  const {
    members,
    rooms,
    changes,
    guestMeals,
    extras,
    bills,
    khalaPayments = [],
    rateCards,
    deposits,
    deductions = [],
    stickyGuestMealsFrom = null,
    settlements,
    openingBalances,
    lastClosedMonth,
    ramadanMode = false,
    soloElectricityMultiplier = 2,
    soloWifiMultiplier = 1,
    today = todayKey(),
    gate = null,
  } = input;

  // The open period starts the day after the last closed month. When nothing
  // has been closed yet, it starts at the earliest month with any activity, so
  // a manager who has never closed a month still sees the full picture.
  const periodStart = lastClosedMonth
    ? addDays(monthEnd(lastClosedMonth), 1)
    : monthStart(
        monthOf(
          earliestOf([
            ...changes.map((change) => change.date),
            ...guestMeals.map((guest) => guest.date),
            ...deposits.map((deposit) => deposit.date),
            ...extras.filter((item) => !item.voided).map((item) => item.date),
            today,
          ]) ?? today,
        ),
      );

  const periodEnd = today;

  // Opening balance for the open period, per member:
  //   1. carry-forward — the last closed month's closing balance, when one exists;
  //   2. otherwise (or when explicitly overridden) a manager-declared opening
  //      balance for the *first* month of the open period.
  //
  // A declared opening is only ever applied to the first open month. Applying
  // it to a later month would double-count, because the running figures below
  // already roll each month forward through its own deposits and cost.
  const firstOpenMonth = monthOf(periodStart);
  const openingByMember = new Map<string, number>();
  for (const settlement of settlements) {
    if (lastClosedMonth && settlement.month === lastClosedMonth) {
      openingByMember.set(settlement.memberId, settlement.closingBalance);
    }
  }
  for (const opening of openingBalances) {
    if (opening.month === firstOpenMonth) {
      openingByMember.set(opening.memberId, opening.amount);
    }
  }

  const costByMember = new Map<string, number>();
  const utilityCostByMember = new Map<string, number>();
  const extraCostByMember = new Map<string, number>();
  const khalaByMonth = new Map<string, KhalaMonthStanding>();
  if (compare(periodStart, periodEnd) <= 0) {
    const firstMonth = monthOf(periodStart);
    const lastMonth = monthOf(periodEnd);
    let monthCursor = firstMonth;
    let guard = 0;
    while (compare(monthCursor, lastMonth) <= 0) {
      const computation = computeMonth({
        month: monthCursor,
        cutoff: periodEnd,
        gate,
        members,
        rooms,
        changes,
        guestMeals,
        extras,
        bills,
        khalaPayments,
        rateCards,
        ramadanMode,
        stickyGuestMealsFrom,
        soloElectricityMultiplier,
        soloWifiMultiplier,
        today,
      });
      for (const [memberId, cost] of computation.perMember) {
        costByMember.set(
          memberId,
          (costByMember.get(memberId) ?? 0) + cost.totalCost,
        );
        utilityCostByMember.set(
          memberId,
          (utilityCostByMember.get(memberId) ?? 0) + cost.khalaElecWifiAmount,
        );
        extraCostByMember.set(
          memberId,
          (extraCostByMember.get(memberId) ?? 0) + cost.extraAmount,
        );
      }
      khalaByMonth.set(monthCursor, {
        month: monthCursor,
        paid: computation.khala.totalPaid,
        target: computation.khala.monthlyTarget,
        outstanding: computation.khala.outstanding,
        fullyPaid: computation.khala.fullyPaid,
        count: computation.khala.memberCount,
      });
      monthCursor = nextMonthKey(monthCursor);
      if (++guard > 120) break;
    }
  }

  const rows: MemberRunningBalance[] = members.map((member) => {
    const openingBalance = openingByMember.get(member.id) ?? 0;
    const memberDeposits = sum(
      deposits
        .filter(
          (deposit) =>
            deposit.memberId === member.id &&
            isSameOrAfter(deposit.date, periodStart) &&
            isSameOrBefore(deposit.date, periodEnd),
        )
        .map((deposit) => deposit.amount),
    );
    const memberDeductions = sum(
      deductions
        .filter(
          (deduction) =>
            deduction.memberId === member.id &&
            isSameOrAfter(deduction.date, periodStart) &&
            isSameOrBefore(deduction.date, periodEnd),
        )
        .map((deduction) => deduction.amount),
    );
    const utilityCost = utilityCostByMember.get(member.id) ?? 0;
    const extraCost = extraCostByMember.get(member.id) ?? 0;
    const cost = costByMember.get(member.id) ?? 0;
    return {
      memberId: member.id,
      memberName: member.name,
      roomNumber: rooms.find((r) => r.id === member.roomId)?.number ?? "-",
      active: member.active,
      openingBalance,
      deposits: memberDeposits,
      deductions: memberDeductions,
      utilityCost,
      extraCost,
      cost,
      balance: openingBalance + memberDeposits - cost - memberDeductions,
    };
  });

  rows.sort(
    (a, b) =>
      Number(a.active === b.active ? 0 : a.active ? -1 : 1) ||
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }) ||
      a.memberName.localeCompare(b.memberName),
  );

  const summary = {
    openingBalance: sum(rows.map((r) => r.openingBalance)),
    deposits: sum(rows.map((r) => r.deposits)),
    deductions: sum(rows.map((r) => r.deductions)),
    utilityCost: sum(rows.map((r) => r.utilityCost)),
    extraCost: sum(rows.map((r) => r.extraCost)),
    cost: sum(rows.map((r) => r.cost)),
    balance: sum(rows.map((r) => r.balance)),
    membersInDeficit: rows.filter((r) => r.balance < 0).length,
    totalDeficit: sum(rows.filter((r) => r.balance < 0).map((r) => -r.balance)),
    membersInCredit: rows.filter((r) => r.balance >= 0).length,
    totalCredit: sum(rows.filter((r) => r.balance >= 0).map((r) => r.balance)),
  };

  return { periodStart, periodEnd, rows, summary, khalaByMonth };
}

export interface KhalaMonthStanding {
  month: MonthKey;
  paid: number;
  target: number;
  outstanding: number;
  fullyPaid: boolean;
  count: number;
}

/** The smallest date key in a list, or null when the list is empty. */
function earliestOf(dates: DateKey[]): DateKey | null {
  let earliest: DateKey | null = null;
  for (const date of dates) {
    if (!earliest || compare(date, earliest) < 0) earliest = date;
  }
  return earliest;
}

function nextMonthKey(month: MonthKey): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m, 1));
  return date.toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const MEAL_STATUS_LABELS: Record<MealStatus, string> = {
  FULL: "Full Meal",
  HALF_DAY: "Half-Day (lunch only)",
  HALF_NIGHT: "Half-Night (dinner only)",
  OFF: "Off",
};

export const MEAL_STATUS_SHORT: Record<MealStatus, string> = {
  FULL: "Full",
  HALF_DAY: "Half-Day",
  HALF_NIGHT: "Half-Night",
  OFF: "Off",
};

export const EXTRA_CATEGORY_LABELS: Record<ExtraCategory, string> = {
  RECURRING_DAILY: "Recurring Daily",
  ONE_OFF: "One-off",
  MANAGER_FEE: "Manager Fee",
  FEAST: "Feast",
  OTHER: "Other",
};

export const UTILITY_TYPE_LABELS: Record<UtilityType, string> = {
  ELECTRICITY: "Electricity",
  WIFI: "Wifi",
  KHALA: "Khala",
};
