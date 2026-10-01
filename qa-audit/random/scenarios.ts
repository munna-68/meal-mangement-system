/**
 * Randomised scenario generator.
 *
 * Every scenario is a pure function of its seed, so any failure can be
 * reproduced exactly by re-running with the same seed. Random money is drawn
 * from a deliberately nasty distribution: amounts that do not divide evenly,
 * zero, 1 taka, and crore-scale numbers.
 */
import type {
  DeductionData,
  DepositData,
  ExtraItemData,
  GuestMealData,
  MemberData,
  OpeningBalanceData,
  RateCardData,
  RoomData,
  StatusChangeData,
  UtilityBillData,
} from "../../src/lib/calc";
import type { Scenario } from "../harness/invariants";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private r: () => number;
  constructor(public seed: number) {
    this.r = mulberry32(seed);
  }
  next() {
    return this.r();
  }
  int(min: number, max: number) {
    return min + Math.floor(this.r() * (max - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
  chance(p: number) {
    return this.r() < p;
  }
  /** Nasty money: exact, indivisible, tiny, and crore-scale. */
  money(kind: "small" | "awkward" | "huge" = "awkward") {
    if (kind === "small") return this.int(0, 50);
    if (kind === "huge") return this.int(1, 50) * 1_000_000;
    const awkward = [1, 7, 11, 99, 101, 333, 6301, 1237, 999, 10_001];
    if (this.chance(0.5)) return this.pick(awkward);
    return this.int(0, 20_000);
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const monthKey = (y: number, m: number) => `${y}-${pad(m)}`;
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function makeScenario(seed: number, opts: { edge?: boolean } = {}): Scenario {
  const rng = new Rng(seed);
  const edge = !!opts.edge;

  // --- calendar: a random "today" in a random year/month
  const year = rng.int(2024, 2027);
  const monthCount = edge ? rng.int(1, 3) : rng.int(1, 4);
  const startMonthIndex = rng.int(1, 11);
  const todayMonthIndex = startMonthIndex + monthCount - 1;
  const months: string[] = [];
  for (let i = 0; i < monthCount; i += 1) {
    const idx = startMonthIndex + i;
    const y = year + Math.floor((idx - 1) / 12);
    const m = ((idx - 1) % 12) + 1;
    months.push(monthKey(y, m));
  }
  const lastMonth = months[months.length - 1];
  const [ty, tm] = lastMonth.split("-").map(Number);
  const todayDay = edge
    ? rng.pick([1, 2, daysIn(ty, tm), daysIn(ty, tm)])
    : rng.int(1, daysIn(ty, tm));
  const today = dayKey(ty, tm, todayDay);

  // --- rate cards: one, or two with a mid-month change
  const fullRate = rng.pick([40, 55, 60, 60, 65, 70]);
  const halfRate = rng.pick([25, 30, 35, 35, 40]);
  const guestFull = rng.pick([60, 75, 75, 80]);
  const guestHalf = rng.pick([35, 40, 40, 45]);
  const khalaNormal = rng.pick([200, 250, 300, 300]);
  const khalaSolo = khalaNormal + rng.pick([100, 100, 150, 200]);
  const dailyExtra = rng.pick([0, 200, 300, 300, 500]);
  const managerFee = rng.pick([0, 30, 30, 50]);

  const firstMonth = months[0];
  const card1: RateCardData = {
    id: "rc1",
    effectiveFrom: `${firstMonth}-01`,
    effectiveTo: null,
    fullMealRate: fullRate,
    halfMealRate: halfRate,
    guestFullRate: guestFull,
    guestHalfRate: guestHalf,
    sehriRate: 50,
    feastFlatCharge: 200,
    khalaNormalRate: khalaNormal,
    khalaSoloRate: khalaSolo,
    managerDailyFee: managerFee,
    dailyExtraAmount: dailyExtra,
  };
  const rateCards: RateCardData[] = [card1];
  if (rng.chance(0.35) && monthCount >= 1) {
    const bumpFrom = `${rng.pick(months)}-${pad(rng.int(2, 25))}`;
    if (bumpFrom > card1.effectiveFrom && bumpFrom <= today) {
      card1.effectiveTo = `${bumpFrom.slice(0, 8)}${pad(Number(bumpFrom.slice(8, 10)) - 1)}`;
      rateCards.push({
        ...card1,
        id: "rc2",
        effectiveFrom: bumpFrom,
        effectiveTo: null,
        fullMealRate: fullRate + rng.pick([0, 5, 10, -5]),
        halfMealRate: halfRate + rng.pick([0, 5, 5]),
        guestFullRate: guestFull,
        guestHalfRate: guestHalf,
        dailyExtraAmount: dailyExtra,
        managerDailyFee: managerFee,
      });
    }
  }

  // --- rooms
  const roomCount = edge ? rng.int(1, 2) : rng.int(1, 10);
  const rooms: RoomData[] = [];
  for (let i = 0; i < roomCount; i += 1) {
    const capacity = edge ? rng.pick([1, 2]) : rng.pick([1, 2, 2, 2, 3, 4]);
    rooms.push({
      id: `r${i + 1}`,
      number: `${100 + i + 1}`,
      capacity,
      solo: capacity >= 2 && rng.chance(0.25),
    });
  }

  // --- members
  const memberCount = edge ? rng.int(1, 3) : rng.int(1, 40);
  const members: MemberData[] = [];
  for (let i = 0; i < memberCount; i += 1) {
    const room = rng.pick(rooms);
    const joinMonth = rng.pick(months);
    const [jy, jm] = joinMonth.split("-").map(Number);
    const joinDay = rng.chance(edge ? 0.7 : 0.25)
      ? 1
      : rng.int(1, daysIn(jy, jm));
    const left = rng.chance(0.15);
    let leaveDate: string | null = null;
    if (left) {
      const lm = rng.pick(months);
      const [ly, lmm] = lm.split("-").map(Number);
      leaveDate = dayKey(ly, lmm, rng.int(1, daysIn(ly, lmm)));
      if (leaveDate < dayKey(jy, jm, joinDay)) leaveDate = null;
    }
    members.push({
      id: `m${i + 1}`,
      name: rng.chance(0.1)
        ? `${"Verylongmembername".repeat(3)}${i}`
        : `Member ${i + 1}`,
      roomId: room.id,
      active: !left,
      joinDate: dayKey(jy, jm, joinDay),
      leaveDate,
    });
  }

  // --- sticky statuses
  const changes: StatusChangeData[] = [];
  for (const m of members) {
    const changeCount = rng.chance(0.2) ? rng.int(1, 4) : 1;
    const usedDates = new Set<string>();
    for (let c = 0; c < changeCount; c += 1) {
      const month = rng.pick(months);
      const [cy, cm] = month.split("-").map(Number);
      const date = dayKey(cy, cm, rng.int(1, daysIn(cy, cm)));
      if (date < m.joinDate) continue;
      if (date > today) continue;
      if (usedDates.has(date)) continue;
      usedDates.add(date);
      changes.push({
        memberId: m.id,
        date,
        status: rng.pick(["FULL", "FULL", "HALF_DAY", "HALF_NIGHT", "OFF"]),
        sehri: false,
      });
    }
  }

  // --- guests
  const guestMeals: GuestMealData[] = [];
  const guestSlots = new Set<string>();
  const guestCount = edge ? rng.int(0, 3) : rng.int(0, 30);
  for (let i = 0; i < guestCount; i += 1) {
    const m = rng.pick(members);
    const month = rng.pick(months);
    const [gy, gm] = month.split("-").map(Number);
    const date = dayKey(gy, gm, rng.int(1, daysIn(gy, gm)));
    if (date < m.joinDate || date > today) continue;
    const type = rng.pick(["GUEST_FULL", "GUEST_HALF"] as const);
    const key = `${m.id}|${date}|${type}`;
    if (guestSlots.has(key)) continue;
    guestSlots.add(key);
    guestMeals.push({
      memberId: m.id,
      date,
      type,
      count: edge ? rng.pick([1, 2, 3]) : rng.int(1, 6),
    });
  }

  // --- confirmed bazar days produce the auto recurring extra
  const extras: (ExtraItemData & { sourceKey: string | null })[] = [];
  const confirmedBazarDays = new Set<string>();
  for (const month of months) {
    const [cy, cm] = month.split("-").map(Number);
    const n = daysIn(cy, cm);
    for (let d = 1; d <= n; d += 1) {
      const date = dayKey(cy, cm, d);
      if (date > today) continue;
      if (!rng.chance(0.55)) continue;
      confirmedBazarDays.add(date);
      if (dailyExtra > 0) {
        extras.push({
          id: `auto:${date}`,
          sourceKey: `auto:daily-extra:${date}`,
          date,
          label: "Daily recurring Extra",
          amount: dailyExtra,
          category: "RECURRING_DAILY",
          showInDailyBudget: true,
          voided: rng.chance(0.1),
        });
      }
    }
  }

  // --- manual extras
  const manualExtras = edge ? rng.int(0, 3) : rng.int(0, 8);
  for (let i = 0; i < manualExtras; i += 1) {
    const month = rng.pick(months);
    const [ey, em] = month.split("-").map(Number);
    const date = dayKey(ey, em, rng.int(1, daysIn(ey, em)));
    if (date > today) continue;
    extras.push({
      id: `man${i + 1}`,
      sourceKey: null,
      date,
      label: `Manual extra ${i + 1}`,
      amount: rng.money("huge"),
      category: rng.pick(["ONE_OFF", "FEAST", "OTHER"]),
      showInDailyBudget: rng.chance(0.4),
      voided: rng.chance(0.15),
    });
  }

  // --- utility bills (month key only, no date, per the spec)
  const bills: UtilityBillData[] = [];
  for (const month of months) {
    if (rng.chance(0.2)) continue; // a month with no bill at all
    bills.push({
      month,
      type: "ELECTRICITY",
      amount: rng.chance(0.15) ? 0 : rng.money(rng.chance(0.1) ? "huge" : "awkward"),
    });
    if (rng.chance(0.8))
      bills.push({ month, type: "WIFI", amount: rng.chance(0.2) ? 0 : rng.money("small") });
    if (rng.chance(0.35))
      bills.push({ month, type: "KHALA", amount: rng.money("awkward") });
  }

  // --- deposits
  const deposits: DepositData[] = [];
  const depositCount = edge ? rng.int(0, 4) : rng.int(0, 40);
  for (let i = 0; i < depositCount; i += 1) {
    const m = rng.pick(members);
    const month = rng.pick(months);
    const [dy, dm] = month.split("-").map(Number);
    const date = dayKey(dy, dm, rng.int(1, daysIn(dy, dm)));
    if (date > today) continue;
    deposits.push({ memberId: m.id, date, amount: rng.money() });
  }

  // --- deductions (money taken back out). Generated in a second, independent
  // pass so the invariants are checked against scenarios that actually contain
  // them, rather than passing trivially on an empty list.
  const deductions: DeductionData[] = [];
  const deductionCount = edge ? rng.int(0, 2) : rng.int(0, 8);
  for (let i = 0; i < deductionCount; i += 1) {
    const m = rng.pick(members);
    const month = rng.pick(months);
    const [dy, dm] = month.split("-").map(Number);
    const date = dayKey(dy, dm, rng.int(1, daysIn(dy, dm)));
    if (date > today) continue;
    deductions.push({ memberId: m.id, date, amount: rng.money("small") });
  }

  // --- opening balances
  const openingBalances: OpeningBalanceData[] = [];
  for (const m of members) {
    if (!rng.chance(0.25)) continue;
    openingBalances.push({
      memberId: m.id,
      month: firstMonth,
      amount: rng.chance(0.3) ? -rng.money("small") : rng.money("small"),
    });
  }

  return {
    id: `seed-${seed}${edge ? "-edge" : ""}`,
    seed,
    today,
    months,
    members,
    rooms,
    changes,
    guestMeals,
    extras,
    bills,
    rateCards,
    deposits,
    deductions,
    openingBalances,
    settlements: [],
    lastClosedMonth: null,
    closedMonths: [],
    soloElectricityMultiplier: rng.pick([1, 2, 2, 3]),
    soloWifiMultiplier: rng.pick([1, 1, 2]),
    ramadanMode: false,
  };
}
