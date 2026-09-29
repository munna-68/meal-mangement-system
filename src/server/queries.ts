import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  accounts,
  bazarDuties,
  bazarDutyRooms,
  dailyBazarRecords,
  deposits,
  extraLineItems,
  guestMeals,
  mealStatusChanges,
  members,
  messSettings,
  monthCloses,
  monthlySettlements,
  openingBalances,
  rateCards,
  rooms,
  utilityBills,
} from "@/db/schema";
import type {
  DepositData,
  ExtraItemData,
  GuestMealData,
  MemberData,
  OpeningBalanceData,
  RateCardData,
  RegisterSnapshot,
  SettlementData,
  StatusChangeData,
  UtilityBillData,
} from "@/lib/calc";
import {
  FALLBACK_SETTINGS,
  type MessSettingsData,
} from "@/lib/defaults";
import {
  currentMonthKey,
  monthOf,
  monthStart,
  todayKey,
  type DateKey,
  type MonthKey,
} from "@/lib/dates";
import {
  closedMonthSet,
  historyLoss,
  type HistoryLoss,
} from "@/lib/locks";
import type { AccountRole } from "@/lib/session";

export interface MemberWithRoom extends MemberData {
  phone: string | null;
  bloodGroup: string | null;
  notes: string | null;
  roomNumber: string;
  roomCapacity: number;
}

export interface RoomRow {
  id: string;
  number: string;
  capacity: number;
  notes: string | null;
}

export interface RateCardRow extends RateCardData {
  label: string | null;
  createdAt: Date;
}

export interface ExtraRow extends ExtraItemData {
  label: string;
  isAuto: boolean;
  sourceKey: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getMessSettings(): Promise<MessSettingsData | null> {
  const rows = await db.select().from(messSettings).limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    hostelName: row.hostelName,
    address: row.address,
    ramadanMode: row.ramadanMode,
    soloElectricityMultiplier: row.soloElectricityMultiplier,
    soloWifiMultiplier: row.soloWifiMultiplier,
  };
}

export async function getSettingsOrDefaults(): Promise<MessSettingsData> {
  const settings = await getMessSettings();
  return settings ?? { ...FALLBACK_SETTINGS };
}

export async function isRamadanMode(): Promise<boolean> {
  const settings = await getMessSettings();
  return settings?.ramadanMode ?? false;
}

// ---------------------------------------------------------------------------
// Rooms and members
// ---------------------------------------------------------------------------

export async function getRooms(): Promise<RoomRow[]> {
  return db
    .select({
      id: rooms.id,
      number: rooms.number,
      capacity: rooms.capacity,
      notes: rooms.notes,
    })
    .from(rooms)
    .orderBy(asc(rooms.number));
}

export async function getMembersWithRooms(): Promise<MemberWithRoom[]> {
  const rows = await db
    .select({ member: members, room: rooms })
    .from(members)
    .innerJoin(rooms, eq(members.roomId, rooms.id))
    .orderBy(asc(members.name));

  return rows.map(({ member, room }) => ({
    id: member.id,
    name: member.name,
    roomId: member.roomId,
    active: member.active,
    joinDate: member.joinDate,
    leaveDate: member.leaveDate,
    phone: member.phone,
    bloodGroup: member.bloodGroup,
    notes: member.notes,
    roomNumber: room.number,
    roomCapacity: room.capacity,
  }));
}

export async function getActiveMembersWithRooms(): Promise<MemberWithRoom[]> {
  const all = await getMembersWithRooms();
  return all.filter((member) => member.active);
}

/** Member names by id, for readable audit lines. */
export async function getMemberNames(
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(inArray(members.id, unique));

  return new Map(rows.map((row) => [row.id, row.name]));
}

// ---------------------------------------------------------------------------
// Rate cards
// ---------------------------------------------------------------------------

export async function getRateCards(): Promise<RateCardRow[]> {
  const rows = await db
    .select()
    .from(rateCards)
    .orderBy(desc(rateCards.effectiveFrom));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    fullMealRate: row.fullMealRate,
    halfMealRate: row.halfMealRate,
    guestFullRate: row.guestFullRate,
    guestHalfRate: row.guestHalfRate,
    sehriRate: row.sehriRate,
    feastFlatCharge: row.feastFlatCharge,
    khalaNormalRate: row.khalaNormalRate,
    khalaSoloRate: row.khalaSoloRate,
    managerDailyFee: row.managerDailyFee,
    dailyExtraAmount: row.dailyExtraAmount,
    createdAt: row.createdAt,
  }));
}

export async function getCurrentRateCard(): Promise<RateCardRow | null> {
  const cards = await getRateCards();
  return cards[0] ?? null;
}

// ---------------------------------------------------------------------------
// Ledger collections (small enough for a hostel to load whole)
// ---------------------------------------------------------------------------

export async function getStatusChanges(): Promise<StatusChangeData[]> {
  const rows = await db
    .select({
      memberId: mealStatusChanges.memberId,
      date: mealStatusChanges.date,
      status: mealStatusChanges.status,
      sehri: mealStatusChanges.sehri,
    })
    .from(mealStatusChanges)
    .orderBy(asc(mealStatusChanges.date));
  return rows;
}

export async function getGuestMeals(): Promise<GuestMealData[]> {
  const rows = await db
    .select({
      memberId: guestMeals.memberId,
      date: guestMeals.date,
      type: guestMeals.type,
      count: guestMeals.count,
    })
    .from(guestMeals)
    .orderBy(asc(guestMeals.date));
  return rows;
}

export async function getExtras(): Promise<ExtraRow[]> {
  return db
    .select({
      id: extraLineItems.id,
      date: extraLineItems.date,
      label: extraLineItems.label,
      amount: extraLineItems.amount,
      category: extraLineItems.category,
      showInDailyBudget: extraLineItems.showInDailyBudget,
      voided: extraLineItems.voided,
      isAuto: extraLineItems.isAuto,
      sourceKey: extraLineItems.sourceKey,
      createdAt: extraLineItems.createdAt,
    })
    .from(extraLineItems)
    .orderBy(desc(extraLineItems.date), desc(extraLineItems.createdAt));
}

export async function getExtrasForMonth(month: MonthKey): Promise<ExtraRow[]> {
  const all = await getExtras();
  return all.filter((item) => monthOf(item.date) === month);
}

export async function getUtilityBills(): Promise<UtilityBillData[]> {
  return db
    .select({
      month: utilityBills.month,
      type: utilityBills.type,
      amount: utilityBills.amount,
    })
    .from(utilityBills)
    .orderBy(desc(utilityBills.month))
    .then((rows) => rows.map((r) => ({ ...r, month: monthOf(r.month) })));
}

export async function getDeposits(): Promise<
  (DepositData & { id: string; notes: string | null })[]
> {
  return db
    .select({
      id: deposits.id,
      memberId: deposits.memberId,
      date: deposits.date,
      amount: deposits.amount,
      notes: deposits.notes,
    })
    .from(deposits)
    .orderBy(desc(deposits.date));
}

export async function getSettlements(): Promise<SettlementData[]> {
  return db
    .select({
      memberId: monthlySettlements.memberId,
      month: monthlySettlements.month,
      openingBalance: monthlySettlements.openingBalance,
      closingBalance: monthlySettlements.closingBalance,
    })
    .from(monthlySettlements)
    .then((rows) => rows.map((r) => ({ ...r, month: monthOf(r.month) })));
}

/** Manager-declared opening balances, keyed by member and month. */
export async function getOpeningBalances(): Promise<
  (OpeningBalanceData & { notes: string | null })[]
> {
  return db
    .select({
      memberId: openingBalances.memberId,
      month: openingBalances.month,
      amount: openingBalances.amount,
      notes: openingBalances.notes,
    })
    .from(openingBalances)
    .then((rows) => rows.map((r) => ({ ...r, month: monthOf(r.month) })));
}

export async function getClosedMonths(): Promise<MonthKey[]> {
  const rows = await db
    .select({ month: monthCloses.month })
    .from(monthCloses)
    .orderBy(desc(monthCloses.month));
  return rows.map((row) => monthOf(row.month));
}

export async function getLastClosedMonth(): Promise<MonthKey | null> {
  const months = await getClosedMonths();
  return months[0] ?? null;
}

/** Closed months as a lookup set, for the write guards. */
export async function getClosedMonthSet(): Promise<Set<MonthKey>> {
  return closedMonthSet(await getClosedMonths());
}

export interface MonthCloseRow {
  month: MonthKey;
  notes: string | null;
  closedAt: Date;
  closedBy: string | null;
  registerSnapshot: RegisterSnapshot | null;
}

/**
 * The frozen record of a closed month, including the meal register as it stood
 * at close time. The closed-month screen reads the register from here rather
 * than recomputing it, so the screen and its PDFs cannot drift apart.
 */
export async function getMonthClose(
  month: MonthKey,
): Promise<MonthCloseRow | null> {
  const [row] = await db
    .select({
      month: monthCloses.month,
      notes: monthCloses.notes,
      closedAt: monthCloses.closedAt,
      closedBy: monthCloses.closedBy,
      registerSnapshot: monthCloses.registerSnapshot,
    })
    .from(monthCloses)
    .where(eq(monthCloses.month, monthStart(month)))
    .limit(1);

  if (!row) return null;
  return {
    month: monthOf(row.month),
    notes: row.notes,
    closedAt: row.closedAt,
    closedBy: row.closedBy,
    registerSnapshot: row.registerSnapshot ?? null,
  };
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface AccountRow {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  active: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  /** Whether the lockout is still in force. Resolved here, not during render. */
  locked: boolean;
}

const accountColumns = {
  id: accounts.id,
  username: accounts.username,
  displayName: accounts.displayName,
  role: accounts.role,
  active: accounts.active,
  failedAttempts: accounts.failedAttempts,
  lockedUntil: accounts.lockedUntil,
  lastLoginAt: accounts.lastLoginAt,
  createdAt: accounts.createdAt,
};

type AccountSelectRow = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
};

function toAccountRow(row: AccountSelectRow): AccountRow {
  return {
    ...row,
    role: row.role as AccountRole,
    locked:
      row.lockedUntil !== null && row.lockedUntil.getTime() > Date.now(),
  };
}

export async function getAccounts(): Promise<AccountRow[]> {
  const rows = await db
    .select(accountColumns)
    .from(accounts)
    .orderBy(asc(accounts.username));
  return rows.map(toAccountRow);
}

export async function getAccountById(id: string): Promise<AccountRow | null> {
  const [row] = await db
    .select(accountColumns)
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);
  return row ? toAccountRow(row) : null;
}

export async function countAccounts(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accounts);
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// What a member delete would destroy
// ---------------------------------------------------------------------------

export interface MemberHistoryLoss {
  statusChanges: HistoryLoss;
  guestMeals: HistoryLoss;
  deposits: HistoryLoss;
  /** Total records that sit in a month that has not been closed. */
  unclosedItems: number;
  /** Distinct unclosed months across all three record types, oldest first. */
  unclosedMonths: MonthKey[];
  hasUnclosedHistory: boolean;
}

function emptyLoss(): MemberHistoryLoss {
  const empty: HistoryLoss = { total: 0, unclosed: 0, unclosedMonths: [] };
  return {
    statusChanges: empty,
    guestMeals: empty,
    deposits: empty,
    unclosedItems: 0,
    unclosedMonths: [],
    hasUnclosedHistory: false,
  };
}

/**
 * For every member, how much of their history sits in months that have not been
 * closed yet. Deleting a member cascades to these rows, which would silently
 * rewrite those months, so the delete flow needs to know about them first.
 */
export async function getMemberHistoryLosses(): Promise<
  Map<string, MemberHistoryLoss>
> {
  const [closed, changes, guests, depositRows] = await Promise.all([
    getClosedMonthSet(),
    getStatusChanges(),
    getGuestMeals(),
    getDeposits(),
  ]);

  const byMember = new Map<string, MemberHistoryLoss>();
  const add = (
    memberId: string,
    kind: keyof Pick<
      MemberHistoryLoss,
      "statusChanges" | "guestMeals" | "deposits"
    >,
    dates: DateKey[],
  ) => {
    const entry = byMember.get(memberId) ?? emptyLoss();
    entry[kind] = historyLoss(dates, closed);
    byMember.set(memberId, entry);
  };

  const groupDates = (rows: { memberId: string; date: DateKey }[]) => {
    const grouped = new Map<string, DateKey[]>();
    for (const row of rows) {
      const list = grouped.get(row.memberId);
      if (list) list.push(row.date);
      else grouped.set(row.memberId, [row.date]);
    }
    return grouped;
  };

  for (const [memberId, dates] of groupDates(changes)) {
    add(memberId, "statusChanges", dates);
  }
  for (const [memberId, dates] of groupDates(guests)) {
    add(memberId, "guestMeals", dates);
  }
  for (const [memberId, dates] of groupDates(depositRows)) {
    add(memberId, "deposits", dates);
  }

  for (const entry of byMember.values()) {
    entry.unclosedItems =
      entry.statusChanges.unclosed +
      entry.guestMeals.unclosed +
      entry.deposits.unclosed;
    entry.unclosedMonths = [
      ...new Set([
        ...entry.statusChanges.unclosedMonths,
        ...entry.guestMeals.unclosedMonths,
        ...entry.deposits.unclosedMonths,
      ]),
    ].sort();
    entry.hasUnclosedHistory = entry.unclosedItems > 0;
  }

  return byMember;
}

/**
 * The earliest date any ledger activity happened, used to work out where the
 * open period begins when no month has been closed yet.
 */
export async function getEarliestActivityDate(): Promise<DateKey | null> {
  const [changes, guestRows, depositRows] = await Promise.all([
    db
      .select({ earliest: sql<string | null>`min(${mealStatusChanges.date})` })
      .from(mealStatusChanges),
    db
      .select({ earliest: sql<string | null>`min(${guestMeals.date})` })
      .from(guestMeals),
    db
      .select({ earliest: sql<string | null>`min(${deposits.date})` })
      .from(deposits),
  ]);

  const candidates = [
    changes[0]?.earliest,
    guestRows[0]?.earliest,
    depositRows[0]?.earliest,
  ].filter((value): value is DateKey => typeof value === "string" && value.length > 0);

  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, value) =>
    value < earliest ? value : earliest,
  );
}

export async function getSettlementRowsForMonth(month: MonthKey) {
  return db
    .select()
    .from(monthlySettlements)
    .where(eq(monthlySettlements.month, monthStart(month)))
    .orderBy(asc(monthlySettlements.roomNumber), asc(monthlySettlements.memberName));
}

export async function getMemberSettlements(memberId: string) {
  return db
    .select()
    .from(monthlySettlements)
    .where(eq(monthlySettlements.memberId, memberId))
    .orderBy(desc(monthlySettlements.month));
}

// ---------------------------------------------------------------------------
// Bazar
// ---------------------------------------------------------------------------

export interface BazarDutyRow {
  id: string;
  date: DateKey;
  khalaDidShopping: boolean;
  note: string | null;
  roomIds: string[];
  roomNumbers: string[];
}

export async function getBazarDuty(date: DateKey): Promise<BazarDutyRow | null> {
  const duties = await getBazarDutiesInRange(date, date);
  return duties[0] ?? null;
}

export async function getBazarDutiesInRange(
  from: DateKey,
  to: DateKey,
): Promise<BazarDutyRow[]> {
  const duties = await db
    .select()
    .from(bazarDuties)
    .where(and(gte(bazarDuties.date, from), lte(bazarDuties.date, to)))
    .orderBy(asc(bazarDuties.date));

  if (duties.length === 0) return [];
  const ids = duties.map((d) => d.id);

  const assignments = await db
    .select({ dutyId: bazarDutyRooms.bazarDutyId, room: rooms })
    .from(bazarDutyRooms)
    .innerJoin(rooms, eq(bazarDutyRooms.roomId, rooms.id))
    .where(inArray(bazarDutyRooms.bazarDutyId, ids));

  const byDuty = new Map<string, { ids: string[]; numbers: string[] }>();
  for (const assignment of assignments) {
    const entry = byDuty.get(assignment.dutyId) ?? { ids: [], numbers: [] };
    entry.ids.push(assignment.room.id);
    entry.numbers.push(assignment.room.number);
    byDuty.set(assignment.dutyId, entry);
  }

  return duties.map((duty) => ({
    id: duty.id,
    date: duty.date,
    khalaDidShopping: duty.khalaDidShopping,
    note: duty.note,
    roomIds: byDuty.get(duty.id)?.ids ?? [],
    roomNumbers: (byDuty.get(duty.id)?.numbers ?? []).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ),
  }));
}

export async function getBazarRecord(date: DateKey) {
  const rows = await db
    .select()
    .from(dailyBazarRecords)
    .where(eq(dailyBazarRecords.date, date))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Days with a confirmed bazar record. This is the mess's definition of a day
 * the bazar actually ran, which is what the recurring daily Extra and the
 * manager's fee are charged against.
 */
export async function getConfirmedBazarDates(
  from: DateKey,
  to: DateKey,
): Promise<Set<DateKey>> {
  const rows = await db
    .select({ date: dailyBazarRecords.date })
    .from(dailyBazarRecords)
    .where(
      and(gte(dailyBazarRecords.date, from), lte(dailyBazarRecords.date, to)),
    );
  return new Set(rows.map((row) => row.date));
}

/** Every confirmed bazar day, for whole-ledger activity checks. */
export async function getAllConfirmedBazarDates(): Promise<DateKey[]> {
  const rows = await db
    .select({ date: dailyBazarRecords.date })
    .from(dailyBazarRecords);
  return rows.map((row) => row.date);
}

// ---------------------------------------------------------------------------
// Aggregated snapshot used by every screen that computes money
// ---------------------------------------------------------------------------

export interface LedgerSnapshot {
  today: DateKey;
  currentMonth: MonthKey;
  settings: MessSettingsData;
  rateCards: RateCardRow[];
  members: MemberWithRoom[];
  rooms: RoomRow[];
  changes: StatusChangeData[];
  guestMeals: GuestMealData[];
  extras: ExtraRow[];
  bills: UtilityBillData[];
  deposits: (DepositData & { id: string; notes: string | null })[];
  settlements: SettlementData[];
  openingBalances: OpeningBalanceData[];
  lastClosedMonth: MonthKey | null;
}

export async function loadLedgerSnapshot(): Promise<LedgerSnapshot> {
  const [
    settings,
    rateCardsRows,
    memberRows,
    roomRows,
    changes,
    guests,
    extras,
    bills,
    depositRows,
    settlements,
    openingBalanceRows,
    lastClosedMonth,
  ] = await Promise.all([
    getSettingsOrDefaults(),
    getRateCards(),
    getMembersWithRooms(),
    getRooms(),
    getStatusChanges(),
    getGuestMeals(),
    getExtras(),
    getUtilityBills(),
    getDeposits(),
    getSettlements(),
    getOpeningBalances(),
    getLastClosedMonth(),
  ]);

  return {
    today: todayKey(),
    currentMonth: currentMonthKey(),
    settings,
    rateCards: rateCardsRows,
    members: memberRows,
    rooms: roomRows,
    changes,
    guestMeals: guests,
    extras,
    bills,
    deposits: depositRows,
    settlements,
    openingBalances: openingBalanceRows,
    lastClosedMonth,
  };
}
