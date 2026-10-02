/**
 * INDEPENDENT REFERENCE CALCULATOR
 * ================================
 *
 * Written from the owner's written specification only. It deliberately does NOT
 * import anything from `src/`. If this file and `src/lib/calc.ts` agree, the two
 * were derived from the same rule; where they disagree, one of them is wrong
 * and the difference is a finding.
 *
 * All money is held as `bigint` taka. Nothing is ever rounded until the very
 * last step, and every split uses the largest-remainder method so the parts sum
 * back to the whole exactly. The app, by contrast, rounds per member.
 *
 * Rules implemented (from the brief):
 *  - Meal status is sticky: a change dated D applies from D until the next change.
 *    Days before a member's first change are OFF.
 *  - FULL costs fullMealRate; HALF_DAY and HALF_NIGHT both cost halfMealRate; OFF costs 0.
 *  - Guests cost guestFullRate / guestHalfRate, and there is a 5 taka deduction
 *    per guest meal. `guestDeductionApplies` records which reading is in force,
 *    because the spec and the app disagree (see report).
 *  - Bazar budget = meals + extras flagged for the day − manager fee − manual deduction.
 *  - Extras pool = every non-voided, non-manager-fee line item dated in the month,
 *    split evenly across the members active in the month.
 *  - Utility pool = electricity + wifi + khala, apportioned by room capacity with
 *    a solo multiple for somebody alone in a multi-bed room.
 *  - Total cost = meals (incl. guests) + utility share + extras share.
 *  - Balance = opening + deposits − total cost − deductions.
 *  - Confirmation gate: from a given day on, a day charges for meals and guest
 *    meals only if its bazar was confirmed. Days before it always charge.
 */

export type DateKey = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

export type MealStatus = "FULL" | "HALF_DAY" | "HALF_NIGHT" | "OFF";
export type GuestType = "GUEST_FULL" | "GUEST_HALF";

export interface RefRateCard {
  id: string;
  effectiveFrom: DateKey;
  effectiveTo: DateKey | null;
  full: bigint;
  half: bigint;
  guestFull: bigint;
  guestHalf: bigint;
  sehri: bigint;
  khalaNormal: bigint;
  khalaSolo: bigint;
  managerDailyFee: bigint;
  dailyExtra: bigint;
}

export interface RefRoom {
  id: string;
  number: string;
  capacity: number;
  solo: boolean;
}

export interface RefMember {
  id: string;
  name: string;
  roomId: string;
  active: boolean;
  joinDate: DateKey;
  leaveDate: DateKey | null;
}

export interface RefStatusChange {
  memberId: string;
  date: DateKey;
  status: MealStatus;
}

export interface RefGuest {
  memberId: string;
  date: DateKey;
  type: GuestType;
  count: number;
}

export interface RefExtra {
  id: string;
  date: DateKey;
  amount: number;
  category: string;
  showInDailyBudget: boolean;
  voided: boolean;
  sourceKey?: string | null;
}

export interface RefBill {
  month: MonthKey;
  type: "ELECTRICITY" | "WIFI" | "KHALA";
  amount: number;
}

export interface RefDeposit {
  memberId: string;
  date: DateKey;
  amount: number;
}

// ---------------------------------------------------------------------------
// Dates — plain UTC arithmetic on the string keys, no Date objects for calendar
// work, so nothing can shift a day.
// ---------------------------------------------------------------------------

export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function addDays(key: DateKey, n: number): DateKey {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const dt = new Date(t);
  return `${String(dt.getUTCFullYear()).padStart(4, "0")}-${String(
    dt.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export function daysInMonth(month: MonthKey): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const monthStart = (m: MonthKey): DateKey => `${m}-01`;
export function monthEnd(month: MonthKey): DateKey {
  const [y, mm] = month.split("-").map(Number);
  return `${monthStart(month).slice(0, 7)}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, "0")}`;
}
export function monthOf(d: DateKey): MonthKey {
  return d.slice(0, 7);
}
export function eachDay(month: MonthKey): DateKey[] {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}
export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${String(dt.getUTCFullYear()).padStart(4, "0")}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function daysBetweenInclusive(from: DateKey, to: DateKey): number {
  if (cmp(from, to) > 0) return 0;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

// ---------------------------------------------------------------------------
// Largest-remainder (Hare-Niemeyer) split of an integer total by integer weights.
// Exact: the parts always sum back to `total`.
// ---------------------------------------------------------------------------

export function largestRemainder(total: bigint, weights: number[]): bigint[] {
  const n = weights.length;
  if (n === 0) return [];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (total === BigInt(0) || totalWeight <= 0) return weights.map(() => BigInt(0));

  const W = BigInt(totalWeight);
  const base: bigint[] = [];
  const rem: bigint[] = [];
  for (const w of weights) {
    const num = total * BigInt(w);
    const q = num / W;
    base.push(q);
    rem.push(num - q * W); // always in [0, W)
  }
  const used = base.reduce((a, b) => a + b, BigInt(0));
  let left = total - used; // 0 <= left < n

  // Hand the leftover taka to the largest remainders; ties by index for determinism.
  const order = rem
    .map((r, idx) => ({ idx, r }))
    .sort((a, b) => (a.r === b.r ? a.idx - b.idx : a.r > b.r ? -1 : 1));
  const out = [...base];
  for (const { idx } of order) {
    if (left <= BigInt(0)) break;
    out[idx] += BigInt(1);
    left -= BigInt(1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rate card resolution
// ---------------------------------------------------------------------------

export function cardFor(cards: RefRateCard[], date: DateKey): RefRateCard | null {
  if (cards.length === 0) return null;
  const sorted = [...cards].sort((a, b) => cmp(a.effectiveFrom, b.effectiveFrom));
  let chosen: RefRateCard | null = null;
  for (const c of sorted) {
    if (cmp(c.effectiveFrom, date) <= 0) {
      if (c.effectiveTo && cmp(c.effectiveTo, date) < 0) continue;
      if (!chosen || cmp(c.effectiveFrom, chosen.effectiveFrom) >= 0) chosen = c;
    }
  }
  return chosen ?? sorted[0];
}

// ---------------------------------------------------------------------------
// Membership window
// ---------------------------------------------------------------------------

export function activeRange(
  m: RefMember,
  today: DateKey,
): { from: DateKey; to: DateKey | null } {
  const to = m.leaveDate ?? (m.active ? null : today);
  return { from: m.joinDate, to };
}

export function isActiveOn(m: RefMember, date: DateKey, today: DateKey): boolean {
  const r = activeRange(m, today);
  if (cmp(date, r.from) < 0) return false;
  if (r.to && cmp(date, r.to) > 0) return false;
  return true;
}

export function isActiveInRange(
  m: RefMember,
  from: DateKey,
  to: DateKey,
  today: DateKey,
): boolean {
  const r = activeRange(m, today);
  if (cmp(r.from, to) > 0) return false;
  if (r.to && cmp(r.to, from) < 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Sticky status
// ---------------------------------------------------------------------------

export function statusOn(
  changes: RefStatusChange[],
  memberId: string,
  date: DateKey,
): MealStatus {
  let cur: MealStatus = "OFF";
  let best: DateKey | null = null;
  for (const c of changes) {
    if (c.memberId !== memberId) continue;
    if (cmp(c.date, date) > 0) continue;
    if (best === null || cmp(c.date, best) >= 0) {
      best = c.date;
      cur = c.status;
    }
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Per-member month cost
// ---------------------------------------------------------------------------

export interface RefOptions {
  today: DateKey;
  /** Days up to which a live (unclosed) month accrues. */
  cutoff?: DateKey;
  /** Charge the flat monthly charges in full (a month being billed / closed). */
  finalize?: boolean;
  ramadan?: boolean;
  soloElectricityMultiplier?: number;
  soloWifiMultiplier?: number;
  /**
   * Whether the 5-taka-per-guest-meal deduction is part of what the MEMBER is
   * charged. The brief says the deduction is "per calculation"; the app applies
   * it to the bazar cash only. Both readings are supported so the difference can
   * be measured instead of argued about.
   */
  guestDeductionApplies?: boolean;
  /**
   * The confirmation gate. From `startsOn` onward a day charges nothing unless
   * its bazar is in `confirmedDays`; before it, every day charges as always.
   * Derived from the same owner instruction as the rest of this file, and
   * written out longhand rather than shared with the app on purpose.
   */
  gate?: { startsOn: DateKey; confirmedDays: ReadonlySet<DateKey> } | null;
}

/** Whether a day may charge for meals and guest meals under the gate. */
export function refDayIsChargeable(
  day: DateKey,
  gate: { startsOn: DateKey; confirmedDays: ReadonlySet<DateKey> } | null | undefined,
): boolean {
  if (!gate) return true;
  return cmp(day, gate.startsOn) < 0 || gate.confirmedDays.has(day);
}

export interface RefMemberCost {
  memberId: string;
  fullDays: number;
  halfDays: number;
  guestFull: number;
  guestHalf: number;
  mealCost: bigint;
  khala: bigint;
  electricity: bigint;
  wifi: bigint;
  utility: bigint;
  extras: bigint;
  totalCost: bigint;
}

export interface RefMonth {
  month: MonthKey;
  cutoff: DateKey;
  activeIds: string[];
  perMember: Map<string, RefMemberCost>;
  extrasPoolTotal: bigint;
  extrasPoolPerMember: bigint;
  electricityPool: bigint;
  wifiPool: bigint;
  khalaPool: bigint;
  utilityPoolTotal: bigint;
  utilityPoolCharged: bigint;
  mealCostTotal: bigint;
  totalCost: bigint;
  soloCount: number;
}

function managerFeeExcluded(e: RefExtra): boolean {
  return (
    e.category === "MANAGER_FEE" ||
    (typeof e.sourceKey === "string" && e.sourceKey.startsWith("auto:manager-fee:"))
  );
}

export function refComputeMonth(
  input: {
    month: MonthKey;
    members: RefMember[];
    rooms: RefRoom[];
    changes: RefStatusChange[];
    guests: RefGuest[];
    extras: RefExtra[];
    bills: RefBill[];
    cards: RefRateCard[];
  },
  opts: RefOptions,
): RefMonth {
  const today = opts.today;
  const soloElec = opts.soloElectricityMultiplier ?? 2;
  const soloWifi = opts.soloWifiMultiplier ?? 1;
  const guestDeduction = opts.guestDeductionApplies ?? true;
  const from = monthStart(input.month);
  const last = monthEnd(input.month);
  const requested = opts.cutoff && cmp(opts.cutoff, last) < 0 ? opts.cutoff : last;
  const cutoff = cmp(requested, today) < 0 ? requested : today;
  const monthComplete = !!opts.finalize || cmp(last, cutoff) <= 0;

  const active = input.members.filter((m) => isActiveInRange(m, from, cutoff, today));
  const activeIds = active.map((m) => m.id);

  // --- occupancy + solo detection
  const occupants = new Map<string, number>();
  for (const m of input.members) {
    if (!isActiveInRange(m, from, cutoff, today)) continue;
    occupants.set(m.roomId, (occupants.get(m.roomId) ?? 0) + 1);
  }
  const roomById = new Map(input.rooms.map((r) => [r.id, r]));
  const isSolo = (m: RefMember) => {
    const r = roomById.get(m.roomId);
    if (!r) return false;
    if (r.capacity < 2) return false;
    return (occupants.get(m.roomId) ?? 0) <= 1;
  };
  const soloFlags = active.map(isSolo);
  const soloCount = soloFlags.filter(Boolean).length;

  // --- accrual fraction for the flat monthly charges
  const fractionFor = (m: RefMember): bigint => {
    if (monthComplete) return BigInt(1000000); // fixed point 1.0
    const r = activeRange(m, today);
    const ws = cmp(r.from, from) > 0 ? r.from : from;
    const we = r.to && cmp(r.to, cutoff) < 0 ? r.to : cutoff;
    if (cmp(ws, we) > 0) return BigInt(0);
    const days = BigInt(daysBetweenInclusive(ws, we));
    return (days * BigInt(1000000)) / BigInt(daysInMonth(input.month));
  };

  // --- meals, day by day, at that day's rate card
  const per = new Map<string, RefMemberCost>();
  for (const m of active) {
    per.set(m.id, {
      memberId: m.id,
      fullDays: 0,
      halfDays: 0,
      guestFull: 0,
      guestHalf: 0,
      mealCost: BigInt(0),
      khala: BigInt(0),
      electricity: BigInt(0),
      wifi: BigInt(0),
      utility: BigInt(0),
      extras: BigInt(0),
      totalCost: BigInt(0),
    });
  }

  let mealCostTotal = BigInt(0);
  for (const day of eachDay(input.month)) {
    if (cmp(day, cutoff) > 0) break;
    if (!refDayIsChargeable(day, opts.gate)) continue;
    const card = cardFor(input.cards, day);
    if (!card) continue;
    for (const m of active) {
      if (!isActiveOn(m, day, today)) continue;
      const row = per.get(m.id)!;
      const st = statusOn(input.changes, m.id, day);
      if (st === "FULL") {
        row.fullDays += 1;
        row.mealCost += card.full;
      } else if (st === "HALF_DAY" || st === "HALF_NIGHT") {
        row.halfDays += 1;
        row.mealCost += card.half;
      }
    }
  }
  for (const g of input.guests) {
    if (cmp(g.date, from) < 0) continue;
    if (cmp(g.date, cutoff) > 0) continue;
    if (!refDayIsChargeable(g.date, opts.gate)) continue;
    const row = per.get(g.memberId);
    if (!row) continue; // guest attached to somebody not active in the window
    const card = cardFor(input.cards, g.date);
    if (!card) continue;
    if (g.type === "GUEST_FULL") {
      row.guestFull += g.count;
      row.mealCost += card.guestFull * BigInt(g.count);
    } else {
      row.guestHalf += g.count;
      row.mealCost += card.guestHalf * BigInt(g.count);
    }
    if (guestDeduction) row.mealCost -= BigInt(5) * BigInt(g.count);
  }
  for (const row of per.values()) mealCostTotal += row.mealCost;

  // --- extras pool (whole month, date-bounded)
  const extrasPoolTotal = input.extras
    .filter(
      (e) =>
        !e.voided &&
        !managerFeeExcluded(e) &&
        cmp(e.date, from) >= 0 &&
        cmp(e.date, cutoff) <= 0,
    )
    .reduce((t, e) => t + BigInt(e.amount), BigInt(0));
  const extrasShares =
    active.length > 0
      ? largestRemainder(extrasPoolTotal, active.map(() => 1))
      : [];
  const extrasPoolPerMember =
    active.length > 0 ? extrasPoolTotal / BigInt(active.length) : BigInt(0);

  // --- electricity and wifi, weighted by room capacity with the solo multiple
  const elecPool = input.bills
    .filter((b) => b.month === input.month && b.type === "ELECTRICITY")
    .reduce((t, b) => t + BigInt(b.amount), BigInt(0));
  const wifiPool = input.bills
    .filter((b) => b.month === input.month && b.type === "WIFI")
    .reduce((t, b) => t + BigInt(b.amount), BigInt(0));
  const khalaBill = input.bills.find(
    (b) => b.month === input.month && b.type === "KHALA",
  );
  const khalaPool = khalaBill ? BigInt(khalaBill.amount) : BigInt(0);

  const elecWeights = soloFlags.map((s) => (s ? soloElec : 1));
  const wifiWeights = soloFlags.map((s) => (s ? soloWifi : 1));
  const elecShares = largestRemainder(elecPool, elecWeights);
  const wifiShares = largestRemainder(wifiPool, wifiWeights);

  const monthCard = cardFor(input.cards, from);
  const khalaWeights = active.map((m) => {
    const rate = monthCard ? (isSolo(m) ? monthCard.khalaSolo : monthCard.khalaNormal) : BigInt(0);
    return Number(rate);
  });
  let khalaShares: bigint[];
  if (khalaBill && khalaBill.amount > 0) {
    khalaShares = largestRemainder(khalaPool, khalaWeights);
  } else if (khalaWeights.some((w) => w > 0)) {
    khalaShares = largestRemainder(
      khalaWeights.reduce((a, b) => a + BigInt(b), BigInt(0)),
      khalaWeights,
    );
  } else {
    khalaShares = active.map(() => BigInt(0));
  }
  // With no explicit khala bill the pool IS the sum of the per-member rates, so
  // `khalaPool` for reporting is the computed total, not 0.
  const khalaPoolActual =
    khalaBill && khalaBill.amount > 0
      ? khalaPool
      : khalaShares.reduce((a, b) => a + b, BigInt(0));

  const scale = (v: bigint, f: bigint): bigint =>
    monthComplete ? v : (v * f) / BigInt(1000000);

  let utilityCharged = BigInt(0);
  active.forEach((m, i) => {
    const row = per.get(m.id)!;
    const f = fractionFor(m);
    const elec = scale(elecShares[i], f);
    const wifi = scale(wifiShares[i], f);
    const kh = scale(khalaShares[i], f);
    row.electricity = elec;
    row.wifi = wifi;
    row.khala = kh;
    row.utility = kh + elec + wifi;
    row.extras = extrasShares[i] ?? BigInt(0);
    row.totalCost = row.mealCost + row.utility + row.extras;
    utilityCharged += row.utility;
  });

  let totalCost = BigInt(0);
  for (const row of per.values()) totalCost += row.totalCost;

  return {
    month: input.month,
    cutoff,
    activeIds,
    perMember: per,
    extrasPoolTotal,
    extrasPoolPerMember,
    electricityPool: elecPool,
    wifiPool: wifiPool,
    khalaPool: khalaPoolActual,
    utilityPoolTotal: elecPool + wifiPool + khalaPoolActual,
    utilityPoolCharged: utilityCharged,
    mealCostTotal,
    totalCost,
    soloCount,
  };
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

export interface RefSettlementRow {
  memberId: string;
  opening: bigint;
  deposits: bigint;
  deductions: bigint;
  cost: bigint;
  balance: bigint;
}

export function refSettlement(
  month: RefMonth,
  input: {
    members: RefMember[];
    deposits: RefDeposit[];
    /** Money taken back out. Same shape as a deposit, subtracted. */
    deductions?: RefDeposit[];
    openingByMember: Map<string, bigint>;
  },
  today: DateKey,
): RefSettlementRow[] {
  const from = monthStart(month.month);
  return month.activeIds.map((id) => {
    const cost = month.perMember.get(id)!.totalCost;
    const sumInRange = (rows: RefDeposit[]) =>
      rows
        .filter(
          (d) =>
            d.memberId === id && cmp(d.date, from) >= 0 && cmp(d.date, month.cutoff) <= 0,
        )
        .reduce((t, d) => t + BigInt(d.amount), BigInt(0));
    const deposits = sumInRange(input.deposits);
    const deductions = sumInRange(input.deductions ?? []);
    const opening = input.openingByMember.get(id) ?? BigInt(0);
    return {
      memberId: id,
      opening,
      deposits,
      deductions,
      cost,
      balance: opening + deposits - cost - deductions,
    };
  });
}

// ---------------------------------------------------------------------------
// Daily bazar budget
// ---------------------------------------------------------------------------

export interface RefDayBudget {
  full: number;
  half: number;
  guestFull: number;
  guestHalf: number;
  mealsSubtotal: bigint;
  extrasInBudget: bigint;
  managerFee: bigint;
  deduction: bigint;
  totalBudget: bigint;
}

export function refDayBudget(
  input: {
    date: DateKey;
    members: RefMember[];
    changes: RefStatusChange[];
    guests: RefGuest[];
    extras: RefExtra[];
    card: RefRateCard | null;
    deduction?: bigint;
  },
  today: DateKey,
): RefDayBudget {
  const active = input.members.filter((m) => isActiveOn(m, input.date, today));
  const activeIds = new Set(active.map((m) => m.id));
  let full = 0;
  let half = 0;
  for (const m of active) {
    const st = statusOn(input.changes, m.id, input.date);
    if (st === "FULL") full += 1;
    else if (st === "HALF_DAY" || st === "HALF_NIGHT") half += 1;
  }
  let guestFull = 0;
  let guestHalf = 0;
  for (const g of input.guests) {
    if (g.date !== input.date) continue;
    if (!activeIds.has(g.memberId)) continue;
    if (g.type === "GUEST_FULL") guestFull += g.count;
    else guestHalf += g.count;
  }
  const card = input.card;
  const guestDeduction = BigInt(guestFull + guestHalf) * BigInt(5);
  const mealsSubtotal = card
    ? BigInt(full) * card.full +
      BigInt(half) * card.half +
      BigInt(guestFull) * card.guestFull +
      BigInt(guestHalf) * card.guestHalf -
      guestDeduction
    : BigInt(0);
  const extrasInBudget = input.extras
    .filter(
      (e) =>
        e.date === input.date &&
        e.showInDailyBudget &&
        !e.voided &&
        !managerFeeExcluded(e),
    )
    .reduce((t, e) => t + BigInt(e.amount), BigInt(0));
  const hasActivity =
    full + half + guestFull + guestHalf > 0 || extrasInBudget > BigInt(0);
  const managerFee = card && hasActivity ? card.managerDailyFee : BigInt(0);
  const deduction = input.deduction ?? BigInt(0);
  return {
    full,
    half,
    guestFull,
    guestHalf,
    mealsSubtotal,
    extrasInBudget,
    managerFee,
    deduction,
    totalBudget: mealsSubtotal + extrasInBudget - managerFee - deduction,
  };
}
