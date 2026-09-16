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
export type UtilityType = "ELECTRICITY" | "WIFI";

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

export interface SettlementData {
  memberId: string;
  month: MonthKey;
  openingBalance: number;
  closingBalance: number;
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
  sehriAmount: number;
  mealsSubtotal: number;
  extraItems: ExtraItemData[];
  extraAmount: number;
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
  for (const guest of guestMeals) {
    if (guest.date !== date) continue;
    if (!activeIds.has(guest.memberId)) continue;
    if (guest.type === "GUEST_FULL") guestFullCount += guest.count;
    else guestHalfCount += guest.count;
  }

  const dailyExtras = extras.filter(
    (item) => item.date === date && item.showInDailyBudget && !item.voided,
  );
  const extraAmount = sum(dailyExtras.map((item) => item.amount));

  const fullAmount = rateCard ? fullCount * rateCard.fullMealRate : 0;
  const halfAmount = rateCard ? halfCount * rateCard.halfMealRate : 0;
  const guestFullAmount = rateCard ? guestFullCount * rateCard.guestFullRate : 0;
  const guestHalfAmount = rateCard ? guestHalfCount * rateCard.guestHalfRate : 0;
  const sehriAmount = rateCard && ramadanMode ? sehriCount * rateCard.sehriRate : 0;

  const mealsSubtotal =
    fullAmount + halfAmount + guestFullAmount + guestHalfAmount + sehriAmount;
  const totalBudget = mealsSubtotal + extraAmount - deductionAmount;

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
    sehriAmount,
    mealsSubtotal,
    extraItems: dailyExtras,
    extraAmount,
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

  for (const guest of guestMeals) {
    if (guest.date !== date) continue;
    const member = members.find((m) => m.id === guest.memberId);
    if (!member) continue;
    if (!isMemberActiveOn(member, date, today)) continue;
    const row = rows.get(member.roomId);
    if (!row) continue;
    if (guest.type === "GUEST_FULL") row.guestFullCount += guest.count;
    else row.guestHalfCount += guest.count;
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
}): { days: DateKey[]; cutoff: DateKey; rows: RegisterRow[] } {
  const { month, members, rooms, changes, today = todayKey() } = input;

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
      if (status === "FULL") fullCount += 1;
      else if (status === "HALF_DAY" || status === "HALF_NIGHT") halfCount += 1;
      return { day, status };
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
}): Map<string, MemberDayState> {
  const { date, members, changes, guestMeals, today = todayKey() } = input;
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
  for (const guest of guestMeals) {
    if (guest.date !== date) continue;
    const state = states.get(guest.memberId);
    if (!state) continue;
    if (guest.type === "GUEST_FULL") state.guestFullCount += guest.count;
    else state.guestHalfCount += guest.count;
  }
  return states;
}

// ---------------------------------------------------------------------------
// Month-level shared costs
// ---------------------------------------------------------------------------

export interface RoomOccupancy {
  roomId: string;
  capacity: number;
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
  perUnitRate: number;
  totalCapacity: number;
  totalElectricity: number;
  totalWifi: number;
  byMember: Map<string, UtilityShare>;
}

/**
 * Electricity and wifi are per-room fixed costs, so they are apportioned by
 * room capacity rather than headcount: each member pays the per-unit rate times
 * their room's capacity divided by the number of occupants. Someone alone in a
 * 2-capacity room therefore pays exactly double a member sharing one.
 */
export function apportionUtilities(input: {
  members: MemberData[];
  rooms: RoomData[];
  bills: UtilityBillData[];
  from: DateKey;
  to: DateKey;
  today?: DateKey;
}): UtilityApportionment {
  const { members, rooms, bills, from, to, today = todayKey() } = input;
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

  const totalCapacity = [...occupancy.values()]
    .filter((room) => room.hasActiveMember)
    .reduce((total, room) => total + room.capacity, 0);

  const perUnitRate =
    totalCapacity > 0 ? (totalElectricity + totalWifi) / totalCapacity : 0;
  const elecPerUnit = totalCapacity > 0 ? totalElectricity / totalCapacity : 0;
  const wifiPerUnit = totalCapacity > 0 ? totalWifi / totalCapacity : 0;

  const byMember = new Map<string, UtilityShare>();
  for (const member of members) {
    if (!isMemberActiveInRange(member, from, to, today)) continue;
    const room = occupancy.get(member.roomId);
    if (!room || room.occupants === 0) {
      byMember.set(member.id, { electricity: 0, wifi: 0, total: 0 });
      continue;
    }
    const weight = room.capacity / room.occupants;
    const electricity = roundTaka(elecPerUnit * weight);
    const wifi = roundTaka(wifiPerUnit * weight);
    byMember.set(member.id, {
      electricity,
      wifi,
      total: electricity + wifi,
    });
  }

  return {
    perUnitRate,
    totalCapacity,
    totalElectricity,
    totalWifi,
    byMember,
  };
}

/**
 * Khala is a flat rate per head: the normal rate when a room is at full
 * occupancy, the higher solo rate when a member is alone in a 2-capacity room,
 * and the normal rate in a 1-capacity room.
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
  const isSoloInSharedRoom = room.capacity >= 2 && room.occupants <= 1;
  return isSoloInSharedRoom ? rateCard.khalaSoloRate : rateCard.khalaNormalRate;
}

export interface ExtraPool {
  total: number;
  perMember: number;
  memberCount: number;
}

/**
 * Every extra line item dated in the window is pooled and split evenly across
 * the members active in that window, so the monthly ledger shows one identical
 * "Extra" figure for everyone.
 */
export function extraPoolForRange(input: {
  extras: ExtraItemData[];
  from: DateKey;
  to: DateKey;
  activeMemberCount: number;
}): ExtraPool {
  const { extras, from, to, activeMemberCount } = input;
  const total = sum(
    extras
      .filter(
        (item) =>
          !item.voided &&
          isSameOrAfter(item.date, from) &&
          isSameOrBefore(item.date, to),
      )
      .map((item) => item.amount),
  );
  const perMember =
    activeMemberCount > 0 ? roundTaka(total / activeMemberCount) : 0;
  return { total, perMember, memberCount: activeMemberCount };
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

export interface MonthComputationInput {
  month: MonthKey;
  /** Compute only up to this date; defaults to the end of the month. */
  cutoff?: DateKey;
  members: MemberData[];
  rooms: RoomData[];
  changes: StatusChangeData[];
  guestMeals: GuestMealData[];
  extras: ExtraItemData[];
  bills: UtilityBillData[];
  rateCards: RateCardData[];
  ramadanMode?: boolean;
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
    rateCards,
    ramadanMode = false,
    today = todayKey(),
  } = input;

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

  // Meal costs are priced day by day so a mid-month rate change is accurate.
  for (const day of daysInMonth(month)) {
    if (compare(day, cutoff) > 0) break;
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
  }

  for (const guest of guestMeals) {
    if (compare(guest.date, from) < 0) continue;
    if (compare(guest.date, cutoff) > 0) continue;
    const row = perMember.get(guest.memberId);
    if (!row) continue;
    const card = rateCardFor(rateCards, guest.date);
    if (guest.type === "GUEST_FULL") {
      row.guestFullCount += guest.count;
      row.mealAmount += (card?.guestFullRate ?? 0) * guest.count;
    } else {
      row.guestHalfCount += guest.count;
      row.mealAmount += (card?.guestHalfRate ?? 0) * guest.count;
    }
  }

  const occupancy = occupancyForRange({ members, rooms, from, to: cutoff, today });
  const utilities = apportionUtilities({
    members,
    rooms,
    bills,
    from,
    to: cutoff,
    today,
  });
  const extraPool = extraPoolForRange({
    extras,
    from,
    to: cutoff,
    activeMemberCount: activeMembers.length,
  });

  // Khala is a flat per-head amount for the month, not a daily charge, so it is
  // priced once from the card in force at the start of the month.
  const monthCard = rateCardFor(rateCards, from);
  const khalaByMember = new Map<string, number>();
  for (const member of activeMembers) {
    khalaByMember.set(
      member.id,
      khalaAmountFor({ member, occupancy, rateCard: monthCard }),
    );
  }

  for (const member of activeMembers) {
    const row = perMember.get(member.id)!;
    const utility = utilities.byMember.get(member.id) ?? {
      electricity: 0,
      wifi: 0,
      total: 0,
    };
    row.electricityAmount = utility.electricity;
    row.wifiAmount = utility.wifi;
    row.khalaAmount = khalaByMember.get(member.id) ?? 0;
    row.khalaElecWifiAmount = row.khalaAmount + utility.total;
    row.extraAmount = extraPool.perMember;
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
  availableBalance: number;
  closingBalance: number;
}

export function buildSettlementRows(input: {
  computation: MonthComputation;
  members: MemberData[];
  rooms: RoomData[];
  deposits: DepositData[];
  openingBalances: Map<string, number>;
}): SettlementRow[] {
  const { computation, members, rooms, deposits, openingBalances } = input;
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
      return {
        ...cost,
        memberId,
        memberName: member.name,
        roomNumber: roomById.get(member.roomId)?.number ?? "-",
        openingBalance,
        newDeposits,
        availableBalance,
        closingBalance: availableBalance - cost.totalCost,
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
  cost: number;
  balance: number;
}

export interface RunningBalanceResult {
  periodStart: DateKey;
  periodEnd: DateKey;
  rows: MemberRunningBalance[];
  summary: {
    openingBalance: number;
    deposits: number;
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
  rateCards: RateCardData[];
  deposits: DepositData[];
  settlements: SettlementData[];
  lastClosedMonth: MonthKey | null;
  ramadanMode?: boolean;
  today?: DateKey;
}): RunningBalanceResult {
  const {
    members,
    rooms,
    changes,
    guestMeals,
    extras,
    bills,
    rateCards,
    deposits,
    settlements,
    lastClosedMonth,
    ramadanMode = false,
    today = todayKey(),
  } = input;

  const openingBalances = new Map<string, number>();
  for (const settlement of settlements) {
    if (lastClosedMonth && settlement.month === lastClosedMonth) {
      openingBalances.set(settlement.memberId, settlement.closingBalance);
    }
  }

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

  const costByMember = new Map<string, number>();
  if (compare(periodStart, periodEnd) <= 0) {
    const firstMonth = monthOf(periodStart);
    const lastMonth = monthOf(periodEnd);
    let monthCursor = firstMonth;
    let guard = 0;
    while (compare(monthCursor, lastMonth) <= 0) {
      const computation = computeMonth({
        month: monthCursor,
        cutoff: periodEnd,
        members,
        rooms,
        changes,
        guestMeals,
        extras,
        bills,
        rateCards,
        ramadanMode,
        today,
      });
      for (const [memberId, cost] of computation.perMember) {
        costByMember.set(
          memberId,
          (costByMember.get(memberId) ?? 0) + cost.totalCost,
        );
      }
      monthCursor = nextMonthKey(monthCursor);
      if (++guard > 120) break;
    }
  }

  const rows: MemberRunningBalance[] = members.map((member) => {
    const openingBalance = openingBalances.get(member.id) ?? 0;
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
    const cost = costByMember.get(member.id) ?? 0;
    return {
      memberId: member.id,
      memberName: member.name,
      roomNumber: rooms.find((r) => r.id === member.roomId)?.number ?? "-",
      active: member.active,
      openingBalance,
      deposits: memberDeposits,
      cost,
      balance: openingBalance + memberDeposits - cost,
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
    cost: sum(rows.map((r) => r.cost)),
    balance: sum(rows.map((r) => r.balance)),
    membersInDeficit: rows.filter((r) => r.balance < 0).length,
    totalDeficit: sum(rows.filter((r) => r.balance < 0).map((r) => -r.balance)),
    membersInCredit: rows.filter((r) => r.balance >= 0).length,
    totalCredit: sum(rows.filter((r) => r.balance >= 0).map((r) => r.balance)),
  };

  return { periodStart, periodEnd, rows, summary };
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
};
