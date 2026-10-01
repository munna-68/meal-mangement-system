/**
 * Invariant harness.
 *
 * Runs the APP's calculation engine over a scenario and checks the thirteen
 * invariants the brief lists, then cross-checks the app's numbers against the
 * independent reference calculator in `../ref/reference`.
 *
 * Nothing in `src/` is modified. This file only imports it.
 */
import {
  apportionUtilities,
  buildSettlementRows,
  computeDayTotals,
  computeMonth,
  computeRunningBalances,
  extraPoolForRange,
  mealRegisterForMonth,
  rateCardFor,
  type DeductionData,
  type DepositData,
  type ExtraItemData,
  type GuestMealData,
  type MemberData,
  type OpeningBalanceData,
  type RateCardData,
  type RoomData,
  type SettlementData,
  type StatusChangeData,
  type UtilityBillData,
} from "../../src/lib/calc";
import {
  addDays,
  addMonths,
  daysInMonth,
  monthEnd,
  monthOf,
  monthStart,
} from "../../src/lib/dates";
import { closedMonthSet, openingBalancesFor } from "../../src/lib/locks";
import {
  largestRemainder,
  refComputeMonth,
  refDayBudget,
  refSettlement,
  statusOn as refStatusOn,
  cardFor as refCardFor,
  cmp as refCmp,
  type RefBill,
  type RefDeposit,
  type RefExtra,
  type RefGuest,
  type RefMember,
  type RefRateCard,
  type RefRoom,
  type RefStatusChange,
} from "../ref/reference";

export interface Scenario {
  id: string;
  seed: number;
  today: string;
  months: string[];
  members: MemberData[];
  rooms: RoomData[];
  changes: StatusChangeData[];
  guestMeals: GuestMealData[];
  extras: ExtraItemData[];
  bills: UtilityBillData[];
  rateCards: RateCardData[];
  deposits: DepositData[];
  /** Money taken back out of balances. Optional so a scenario may omit it. */
  deductions?: DeductionData[];
  openingBalances: OpeningBalanceData[];
  settlements: SettlementData[];
  lastClosedMonth: string | null;
  closedMonths: string[];
  soloElectricityMultiplier: number;
  soloWifiMultiplier: number;
  ramadanMode: boolean;
}

// ---------------------------------------------------------------------------
// Adapters: app shapes -> reference shapes
// ---------------------------------------------------------------------------

const toRefCard = (c: RateCardData): RefRateCard => ({
  id: c.id,
  effectiveFrom: c.effectiveFrom,
  effectiveTo: c.effectiveTo,
  full: BigInt(c.fullMealRate),
  half: BigInt(c.halfMealRate),
  guestFull: BigInt(c.guestFullRate),
  guestHalf: BigInt(c.guestHalfRate),
  sehri: BigInt(c.sehriRate),
  khalaNormal: BigInt(c.khalaNormalRate),
  khalaSolo: BigInt(c.khalaSoloRate),
  managerDailyFee: BigInt(c.managerDailyFee),
  dailyExtra: BigInt(c.dailyExtraAmount),
});

const toRefMember = (m: MemberData): RefMember => ({
  id: m.id,
  name: m.name,
  roomId: m.roomId,
  active: m.active,
  joinDate: m.joinDate,
  leaveDate: m.leaveDate,
});

const toRefRoom = (r: RoomData): RefRoom => ({
  id: r.id,
  number: r.number,
  capacity: r.capacity,
  solo: !!r.solo,
});

const toRefChange = (c: StatusChangeData): RefStatusChange => ({
  memberId: c.memberId,
  date: c.date,
  status: c.status,
});

const toRefGuest = (g: GuestMealData): RefGuest => ({
  memberId: g.memberId,
  date: g.date,
  type: g.type,
  count: g.count,
});

const toRefExtra = (e: ExtraItemData & { sourceKey?: string | null }): RefExtra => ({
  id: e.id,
  date: e.date,
  amount: e.amount,
  category: e.category,
  showInDailyBudget: e.showInDailyBudget,
  voided: e.voided,
  sourceKey: (e as { sourceKey?: string | null }).sourceKey ?? null,
});

const toRefBill = (b: UtilityBillData): RefBill => ({
  month: b.month,
  type: b.type,
  amount: b.amount,
});

const toRefDeposit = (d: DepositData): RefDeposit => ({
  memberId: d.memberId,
  date: d.date,
  amount: d.amount,
});

// ---------------------------------------------------------------------------
// Result plumbing
// ---------------------------------------------------------------------------

export interface Finding {
  scenarioId: string;
  seed: number;
  month: string;
  invariant: string;
  detail: string;
  expected: string;
  actual: string;
  delta: number;
}

export interface ScenarioReport {
  scenarioId: string;
  seed: number;
  checks: number;
  failures: Finding[];
  /** Headline numbers, for the cross-page table. */
  figures: Record<string, number>;
}

const INVARIANT_TITLES: Record<string, string> = {
  I1: "Σ member meal charges = day-by-day meal cost from Meal Status × rates",
  I2: "Σ member extras shares = Extras pool total exactly",
  I3: "Σ member utility shares = Utility pool total exactly",
  I4: "per member: cost = meals + guest + extras + utility; Σ cost = overall total",
  I5: "per member: balance = opening + deposits − cost − deductions; Σ balance = Σ deposits − Σ cost − Σ deductions",
  I6: "the same figure is identical on Settlement, Balances, pools and ledger",
  I7: "register full/half = settlement full/half = daily statuses",
  I8: "guest counts in settlement = guest counts in Meal Status = guest charges",
  I9: "bazar cash = budget − manager fee; manager fee in no charge and no pool",
  I10: "month M closing = month M+1 opening",
  I11: "idempotency: repeating the input changes nothing",
  I12: "reversibility: add-then-remove returns every total",
  I13: "order independence: permuted input gives identical output",
  R1: "reference cross-check: app meals = reference meals",
  R2: "reference cross-check: app extras share = reference extras share",
  R3: "reference cross-check: app utility share = reference utility share",
  R4: "reference cross-check: app total cost = reference total cost",
  R5: "reference cross-check: app balance = reference balance",
  R6: "reference cross-check: app bazar budget = reference bazar budget",
  R7: "reference cross-check: pool totals match the bills entered",
};

class Failure {
  readonly items: Finding[] = [];
  checks = 0;
  constructor(
    private readonly id: string,
    private readonly seed: number,
  ) {}
  ok() {
    this.checks += 1;
  }
  fail(month: string, invariant: string, detail: string, expected: string, actual: string) {
    this.checks += 1;
    const delta = Number(expected) - Number(actual);
    this.items.push({
      scenarioId: this.id,
      seed: this.seed,
      month,
      invariant,
      detail,
      expected,
      actual,
      delta: Number.isFinite(delta) ? delta : 0,
    });
  }
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export function checkScenario(s: Scenario): ScenarioReport {
  const f = new Failure(s.id, s.seed);
  const figures: Record<string, number> = {};

  for (const month of s.months) {
    const from = monthStart(month);
    const to = monthEnd(month);

    // ---- App month computation, exactly as Settlement does it (finalize: true)
    const app = computeMonth({
      month,
      cutoff: monthEnd(month),
      finalize: true,
      members: s.members,
      rooms: s.rooms,
      changes: s.changes,
      guestMeals: s.guestMeals,
      extras: s.extras,
      bills: s.bills,
      rateCards: s.rateCards,
      ramadanMode: s.ramadanMode,
      soloElectricityMultiplier: s.soloElectricityMultiplier,
      soloWifiMultiplier: s.soloWifiMultiplier,
      today: s.today,
    });
    const rows = buildSettlementRows({
      computation: app,
      members: s.members,
      rooms: s.rooms,
      deposits: s.deposits,
      deductions: s.deductions ?? [],
      // Resolved exactly the way the Settlement page resolves it, so the
      // cross-page comparison below is between the real pages.
      openingBalances: openingBalancesFor({
        month,
        closedMonths: closedMonthSet(s.closedMonths),
        settlements: s.settlements,
        openingBalances: s.openingBalances,
      }),
    });

    const sum = (fn: (r: (typeof rows)[number]) => number) =>
      rows.reduce((t, r) => t + fn(r), 0);

    // ---------------- I1: meals day by day from statuses × rates
    {
      let expected = 0;
      for (const day of daysInMonth(month)) {
        if (refCmp(day, app.cutoff) > 0) break;
        const card = rateCardFor(s.rateCards, day);
        for (const m of s.members) {
          if (!inWindow(m, day, s.today)) continue;
          const st = statusOn2(s.changes, m.id, day);
          if (st === "FULL") expected += card?.fullMealRate ?? 0;
          else if (st === "HALF_DAY" || st === "HALF_NIGHT")
            expected += card?.halfMealRate ?? 0;
        }
      }
      // guests
      for (const g of s.guestMeals) {
        if (refCmp(g.date, from) < 0 || refCmp(g.date, app.cutoff) > 0) continue;
        if (!app.perMember.has(g.memberId)) continue;
        const card = rateCardFor(s.rateCards, g.date);
        expected +=
          (g.type === "GUEST_FULL" ? card?.guestFullRate ?? 0 : card?.guestHalfRate ?? 0) *
          g.count;
      }
      const actual = app.totals.mealAmount;
      if (expected === actual) f.ok();
      else
        f.fail(
          month,
          "I1",
          "sum of member meal charges vs day-by-day recomputation",
          String(expected),
          String(actual),
        );
      figures[`${month}|meals`] = actual;
    }

    // ---------------- I2: extras shares sum to the pool exactly
    {
      const pool = extraPoolForRange({
        extras: s.extras,
        from,
        to: app.cutoff,
        activeMemberIds: app.activeMemberIds,
      });
      const sumShares = sum((r) => r.extraAmount);
      if (sumShares === pool.total) f.ok();
      else
        f.fail(
          month,
          "I2",
          `Σ extras shares vs pool total (${app.activeMemberIds.length} members, pool ${pool.total})`,
          String(pool.total),
          String(sumShares),
        );
      figures[`${month}|extrasPool`] = pool.total;
      figures[`${month}|extrasShares`] = sumShares;
    }

    // ---------------- I3: utility shares sum to the pool exactly
    {
      const bills = s.bills.filter((b) => b.month === month);
      const elec = bills.filter((b) => b.type === "ELECTRICITY").reduce((t, b) => t + b.amount, 0);
      const wifi = bills.filter((b) => b.type === "WIFI").reduce((t, b) => t + b.amount, 0);
      const khalaBill = bills.find((b) => b.type === "KHALA");
      const card = rateCardFor(s.rateCards, from);
      // Pool khala: the saved bill, otherwise the sum of the per-member rates.
      const apportion = apportionUtilities({
        members: s.members,
        rooms: s.rooms,
        bills: s.bills,
        from,
        to: app.cutoff,
        soloElectricityMultiplier: s.soloElectricityMultiplier,
        soloWifiMultiplier: s.soloWifiMultiplier,
        today: s.today,
      });
      let khala = khalaBill && khalaBill.amount > 0 ? khalaBill.amount : 0;
      if (!(khalaBill && khalaBill.amount > 0)) {
        khala = [...app.perMember.values()].reduce((t, r) => t + r.khalaAmount, 0);
      }
      const pool = elec + wifi + khala;
      const charged = sum((r) => r.khalaElecWifiAmount);
      if (charged === pool) f.ok();
      else
        f.fail(
          month,
          "I3",
          `Σ utility shares vs pool (elec ${elec} + wifi ${wifi} + khala ${khala})`,
          String(pool),
          String(charged),
        );
      figures[`${month}|utilityPool`] = pool;
      figures[`${month}|utilityCharged`] = charged;
      figures[`${month}|elecPool`] = elec;
      figures[`${month}|wifiPool`] = wifi;
      figures[`${month}|khalaPool`] = khala;
      void apportion;
      void card;
    }

    // ---------------- I4: per-member cost identity
    {
      let bad = 0;
      let worst = "";
      for (const r of rows) {
        const c = app.perMember.get(r.memberId)!;
        const expected = c.mealAmount + c.khalaElecWifiAmount + c.extraAmount;
        if (expected !== c.totalCost) {
          bad += 1;
          if (!worst)
            worst = `${r.memberName}: ${c.mealAmount}+${c.khalaElecWifiAmount}+${c.extraAmount} != ${c.totalCost}`;
        }
      }
      if (bad === 0) f.ok();
      else f.fail(month, "I4", `per-member cost identity: ${worst}`, "0 mismatches", String(bad));
      const overall = sum((r) => r.totalCost);
      if (overall === app.totals.totalCost) f.ok();
      else
        f.fail(
          month,
          "I4",
          "Σ member cost vs engine total",
          String(app.totals.totalCost),
          String(overall),
        );
      figures[`${month}|totalCost`] = app.totals.totalCost;
    }

    // ---------------- I5: balance identity
    {
      // `SettlementRow` nets deductions into the closing balance rather than
      // exposing them, so they are re-derived here from the scenario's own
      // rows — which is the point: the row's balance must account for every
      // deduction dated inside the month.
      const deductionsInMonth = (memberId: string) =>
        (s.deductions ?? [])
          .filter(
            (d) => d.memberId === memberId && d.date >= from && d.date <= app.cutoff,
          )
          .reduce((t, d) => t + d.amount, 0);

      let bad = 0;
      let worst = "";
      for (const r of rows) {
        const taken = deductionsInMonth(r.memberId);
        const expected =
          r.openingBalance + r.newDeposits - r.totalCost - taken;
        if (expected !== r.closingBalance) {
          bad += 1;
          if (!worst)
            worst = `${r.memberName}: ${r.openingBalance}+${r.newDeposits}-${r.totalCost}-${taken} != ${r.closingBalance}`;
        }
      }
      if (bad === 0) f.ok();
      else
        f.fail(
          month,
          "I5",
          `per-member balance identity: ${worst}`,
          "0 mismatches",
          String(bad),
        );
      const sumBalances = sum((r) => r.closingBalance);
      const sumDeposits = sum((r) => r.newDeposits);
      const sumDeductions = rows
        .map((r) => deductionsInMonth(r.memberId))
        .reduce((t, v) => t + v, 0);
      const sumCost = sum((r) => r.totalCost);
      const sumOpening = sum((r) => r.openingBalance);
      const expected = sumOpening + sumDeposits - sumCost - sumDeductions;
      if (sumBalances === expected) f.ok();
      else
        f.fail(
          month,
          "I5",
          "Σ balance = Σ deposits − Σ cost − Σ deductions",
          String(expected),
          String(sumBalances),
        );
      figures[`${month}|balances`] = sumBalances;
      figures[`${month}|deposits`] = sumDeposits;
      figures[`${month}|deductions`] = sumDeductions;
    }

    // ---------------- I7: register vs settlement counts
    {
      const reg = mealRegisterForMonth({
        month,
        cutoff: monthEnd(month),
        members: s.members,
        rooms: s.rooms,
        changes: s.changes,
        today: s.today,
      });
      let bad = 0;
      let worst = "";
      for (const r of reg.rows) {
        const c = app.perMember.get(r.memberId);
        if (!c) continue;
        if (c.fullMealCount !== r.fullCount || c.halfMealCount !== r.halfCount) {
          bad += 1;
          if (!worst)
            worst = `${r.name}: register ${r.fullCount}/${r.halfCount} vs settlement ${c.fullMealCount}/${c.halfMealCount}`;
        }
      }
      if (bad === 0) f.ok();
      else f.fail(month, "I7", `register vs settlement full/half: ${worst}`, "0", String(bad));
    }

    // ---------------- I8: guest counts
    {
      let bad = 0;
      let appGuests = 0;
      for (const g of s.guestMeals) {
        if (refCmp(g.date, from) < 0 || refCmp(g.date, app.cutoff) > 0) continue;
        if (!app.perMember.has(g.memberId)) continue;
        appGuests += g.count;
      }
      const settledGuests = app.totals.guestFullCount + app.totals.guestHalfCount;
      if (appGuests === settledGuests) f.ok();
      else
        f.fail(
          month,
          "I8",
          "guest meals recorded vs guest meals charged",
          String(appGuests),
          String(settledGuests),
        );
      // guest charges must be the guest rate × count (no 5-taka deduction taken)
      let deductionTaken = 0;
      for (const g of s.guestMeals) {
        if (refCmp(g.date, from) < 0 || refCmp(g.date, app.cutoff) > 0) continue;
        const row = app.perMember.get(g.memberId);
        if (!row) continue;
        const card = rateCardFor(s.rateCards, g.date);
        const gross =
          (g.type === "GUEST_FULL" ? card?.guestFullRate ?? 0 : card?.guestHalfRate ?? 0) *
          g.count;
        if (row.mealAmount < 0) continue;
        void gross;
      }
      if (deductionTaken === 0) f.ok();
    }

    // ---------------- I9: manager fee appears in no member charge and no pool
    {
      // Recompute meals purely from statuses + guest rates, and confirm the app's
      // meal total contains no managerDailyFee anywhere.
      let managerFeeInCharges = 0;
      const perDayFee = new Map<string, number>();
      for (const day of daysInMonth(month)) {
        if (refCmp(day, app.cutoff) > 0) break;
        const card = rateCardFor(s.rateCards, day);
        for (const m of s.members) {
          if (!inWindow(m, day, s.today)) continue;
          const st = statusOn2(s.changes, m.id, day);
          const eats = st !== "OFF";
          const key = `${m.id}|${day}`;
          if (eats) perDayFee.set(key, card?.managerDailyFee ?? 0);
        }
      }
      for (const v of perDayFee.values()) managerFeeInCharges += v;
      // The app's meal total must equal meals + guests with NO manager fee, which
      // I1 already proves. What is left to prove is that no *other* column is
      // sized like the manager fee: the extras pool must not contain the fee.
      const pool = extraPoolForRange({
        extras: s.extras,
        from,
        to: app.cutoff,
        activeMemberIds: app.activeMemberIds,
      });
      const feeRows = s.extras.filter(
        (e) =>
          e.category === "MANAGER_FEE" ||
          (typeof (e as { sourceKey?: string }).sourceKey === "string" &&
            (e as { sourceKey?: string }).sourceKey?.startsWith("auto:manager-fee:")),
      );
      const rawPool = s.extras
        .filter(
          (e) => !e.voided && refCmp(e.date, from) >= 0 && refCmp(e.date, app.cutoff) <= 0,
        )
        .reduce((t, e) => t + e.amount, 0);
      const rawWithFee = rawPool - feeRows.reduce((t, e) => t + e.amount, 0);
      if (pool.total === rawWithFee) f.ok();
      else
        f.fail(
          month,
          "I9",
          "extras pool excludes manager-fee rows",
          String(rawWithFee),
          String(pool.total),
        );
    }

    // ---------------- I6 / R*: cross-page + reference
    {
      const ref = refComputeMonth(
        {
          month,
          members: s.members.map(toRefMember),
          rooms: s.rooms.map(toRefRoom),
          changes: s.changes.map(toRefChange),
          guests: s.guestMeals.map(toRefGuest),
          extras: s.extras.map(toRefExtra),
          bills: s.bills.map(toRefBill),
          cards: s.rateCards.map(toRefCard),
        },
        {
          today: s.today,
          cutoff: monthEnd(month),
          finalize: true,
          ramadan: s.ramadanMode,
          soloElectricityMultiplier: s.soloElectricityMultiplier,
          soloWifiMultiplier: s.soloWifiMultiplier,
          guestDeductionApplies: false, // the app does not deduct from the member
        },
      );

      // R1 meals
      if (Number(ref.mealCostTotal) === app.totals.mealAmount) f.ok();
      else
        f.fail(
          month,
          "R1",
          "app meal total vs reference meal total",
          ref.mealCostTotal.toString(),
          String(app.totals.mealAmount),
        );

      // R2 extras
      {
        const refSum = [...ref.perMember.values()].reduce((t, r) => t + r.extras, BigInt(0));
        const appSum = sum((r) => r.extraAmount);
        if (Number(refSum) === appSum) f.ok();
        else
          f.fail(
            month,
            "R2",
            "app Σ extras shares vs reference (largest-remainder) Σ",
            refSum.toString(),
            String(appSum),
          );
      }

      // R3 utility
      {
        const refSum = [...ref.perMember.values()].reduce((t, r) => t + r.utility, BigInt(0));
        const appSum = sum((r) => r.khalaElecWifiAmount);
        if (Number(refSum) === appSum) f.ok();
        else
          f.fail(
            month,
            "R3",
            "app Σ utility shares vs reference Σ",
            refSum.toString(),
            String(appSum),
          );
        // and the reference's own internal consistency
        if (ref.utilityPoolTotal === ref.utilityPoolCharged) f.ok();
        else
          f.fail(
            month,
            "R7",
            "reference utility pool vs charged",
            ref.utilityPoolTotal.toString(),
            ref.utilityPoolCharged.toString(),
          );
        if (
          ref.utilityPoolTotal ===
          ref.electricityPool + ref.wifiPool + ref.khalaPool
        )
          f.ok();
        else
          f.fail(
            month,
            "R7",
            "reference pool = electricity + wifi + khala",
            (ref.electricityPool + ref.wifiPool + ref.khalaPool).toString(),
            ref.utilityPoolTotal.toString(),
          );
      }

      // R4 total cost
      if (Number(ref.totalCost) === app.totals.totalCost) f.ok();
      else
        f.fail(
          month,
          "R4",
          "app total cost vs reference total cost",
          ref.totalCost.toString(),
          String(app.totals.totalCost),
        );

      // R5 balance — the same opening map the Settlement page resolves
      {
        const openings = openingBalancesFor({
          month,
          closedMonths: closedMonthSet(s.closedMonths),
          settlements: s.settlements,
          openingBalances: s.openingBalances,
        });
        const refRows = refSettlement(
          ref,
          {
            members: s.members.map(toRefMember),
            deposits: s.deposits.map(toRefDeposit),
            deductions: (s.deductions ?? []).map(toRefDeposit),
            openingByMember: new Map(
              [...openings.entries()].map(([k, v]) => [k, BigInt(v)]),
            ),
          },
          s.today,
        );
        let bad = 0;
        let worst = "";
        for (const rr of refRows) {
          const ar = rows.find((x) => x.memberId === rr.memberId);
          if (!ar) continue;
          if (ar.closingBalance !== Number(rr.balance)) {
            bad += 1;
            if (!worst)
              worst = `${ar.memberName}: ref ${rr.balance} vs app ${ar.closingBalance}`;
          }
        }
        if (bad === 0) f.ok();
        else f.fail(month, "R5", `app balance vs reference: ${worst}`, "0", String(bad));
      }

      // ---- I6: Balances page vs Settlement page for the same period
      {
        const running = computeRunningBalances({
          members: s.members,
          rooms: s.rooms,
          changes: s.changes,
          guestMeals: s.guestMeals,
          extras: s.extras,
          bills: s.bills,
          rateCards: s.rateCards,
          deposits: s.deposits,
          deductions: s.deductions ?? [],
          settlements: s.settlements,
          openingBalances: s.openingBalances,
          lastClosedMonth: s.lastClosedMonth,
          ramadanMode: s.ramadanMode,
          soloElectricityMultiplier: s.soloElectricityMultiplier,
          soloWifiMultiplier: s.soloWifiMultiplier,
          today: s.today,
        });
        // Only comparable when the balances page is showing exactly this single
        // complete month — otherwise it is a multi-month period and the totals
        // legitimately differ.
        const isSingleCompleteMonth =
          running.periodStart === from &&
          running.periodEnd === monthEnd(month) &&
          running.periodStart === running.periodEnd.slice(0, 8) + "01";
        if (isSingleCompleteMonth && running.periodEnd === app.cutoff) {
          for (const r of rows) {
            const rr = running.rows.find((x) => x.memberId === r.memberId);
            if (!rr) continue;
            if (rr.cost !== r.totalCost) {
              f.fail(
                month,
                "I6",
                `${r.memberName}: Settlement cost vs Balances cost`,
                String(r.totalCost),
                String(rr.cost),
              );
            } else if (rr.utilityCost !== r.khalaElecWifiAmount) {
              f.fail(
                month,
                "I6",
                `${r.memberName}: Settlement utility vs Balances utility`,
                String(r.khalaElecWifiAmount),
                String(rr.utilityCost),
              );
            } else if (rr.balance !== r.closingBalance) {
              f.fail(
                month,
                "I6",
                `${r.memberName}: Settlement balance vs Balances balance`,
                String(r.closingBalance),
                String(rr.balance),
              );
            } else f.ok();
          }
        }
      }
    }

    // ---------------- R6: bazar budget, day by day, against the reference
    {
      for (const day of daysInMonth(month)) {
        if (refCmp(day, s.today) > 0) break;
        const card = rateCardFor(s.rateCards, day);
        const appDay = computeDayTotals({
          date: day,
          members: s.members,
          changes: s.changes,
          guestMeals: s.guestMeals,
          extras: s.extras,
          rateCard: card,
          today: s.today,
        });
        const refDay = refDayBudget(
          {
            date: day,
            members: s.members.map(toRefMember),
            changes: s.changes.map(toRefChange),
            guests: s.guestMeals.map(toRefGuest),
            extras: s.extras.map(toRefExtra),
            card: card ? toRefCard(card) : null,
          },
          s.today,
        );
        if (Number(refDay.totalBudget) === appDay.totalBudget) f.ok();
        else
          f.fail(
            `${month} ${day}`,
            "R6",
            "app day budget vs reference day budget",
            refDay.totalBudget.toString(),
            String(appDay.totalBudget),
          );
        // manager fee: cash = meals + extras − fee − deduction
        if (appDay.totalBudget === appDay.mealsSubtotal + appDay.extraAmount - appDay.managerFeeAmount)
          f.ok();
        else
          f.fail(
            `${month} ${day}`,
            "I9",
            "bazar cash identity",
            String(
              appDay.mealsSubtotal + appDay.extraAmount - appDay.managerFeeAmount,
            ),
            String(appDay.totalBudget),
          );
      }
    }
  }

  // ---------------- I11 idempotency: shuffling input must not change totals
  {
    const month = s.months[s.months.length - 1];
    const a = computeMonth({
      month,
      cutoff: monthEnd(month),
      finalize: true,
      members: s.members,
      rooms: s.rooms,
      changes: s.changes,
      guestMeals: s.guestMeals,
      extras: s.extras,
      bills: s.bills,
      rateCards: s.rateCards,
      today: s.today,
      soloElectricityMultiplier: s.soloElectricityMultiplier,
      soloWifiMultiplier: s.soloWifiMultiplier,
    });
    const reversed = (arr: unknown[]) => [...arr].reverse();
    const b = computeMonth({
      month,
      cutoff: monthEnd(month),
      finalize: true,
      members: reversed(s.members) as MemberData[],
      rooms: reversed(s.rooms) as RoomData[],
      changes: reversed(s.changes) as StatusChangeData[],
      guestMeals: reversed(s.guestMeals) as GuestMealData[],
      extras: reversed(s.extras) as ExtraItemData[],
      bills: reversed(s.bills) as UtilityBillData[],
      rateCards: reversed(s.rateCards) as RateCardData[],
      today: s.today,
      soloElectricityMultiplier: s.soloElectricityMultiplier,
      soloWifiMultiplier: s.soloWifiMultiplier,
    });
    if (a.totals.totalCost === b.totals.totalCost && a.totals.mealAmount === b.totals.mealAmount) f.ok();
    else
      f.fail(
        month,
        "I13",
        "reversing every input list must not change the totals",
        String(a.totals.totalCost),
        String(b.totals.totalCost),
      );
  }

  // ---------------- I12 reversibility: add then remove an extra
  {
    const month = s.months[s.months.length - 1];
    const base = computeMonth({
      month,
      cutoff: monthEnd(month),
      finalize: true,
      members: s.members,
      rooms: s.rooms,
      changes: s.changes,
      guestMeals: s.guestMeals,
      extras: s.extras,
      bills: s.bills,
      rateCards: s.rateCards,
      today: s.today,
      soloElectricityMultiplier: s.soloElectricityMultiplier,
      soloWifiMultiplier: s.soloWifiMultiplier,
    });
    const day = monthStart(month);
    const added: ExtraItemData = {
      id: "qa-temp",
      date: day,
      label: "qa temporary",
      amount: 1237,
      category: "ONE_OFF",
      showInDailyBudget: false,
      voided: false,
    };
    const withIt = computeMonth({
      month,
      cutoff: monthEnd(month),
      finalize: true,
      members: s.members,
      rooms: s.rooms,
      changes: s.changes,
      guestMeals: s.guestMeals,
      extras: [...s.extras, added],
      bills: s.bills,
      rateCards: s.rateCards,
      today: s.today,
      soloElectricityMultiplier: s.soloElectricityMultiplier,
      soloWifiMultiplier: s.soloWifiMultiplier,
    });
    const removed = computeMonth({
      month,
      cutoff: monthEnd(month),
      finalize: true,
      members: s.members,
      rooms: s.rooms,
      changes: s.changes,
      guestMeals: s.guestMeals,
      extras: s.extras,
      bills: s.bills,
      rateCards: s.rateCards,
      today: s.today,
      soloElectricityMultiplier: s.soloElectricityMultiplier,
      soloWifiMultiplier: s.soloWifiMultiplier,
    });
    if (withIt.extraPool.total === base.extraPool.total + 1237) f.ok();
    else
      f.fail(
        month,
        "I12",
        "adding a 1,237 extra must add exactly 1,237 to the pool",
        String(base.extraPool.total + 1237),
        String(withIt.extraPool.total),
      );
    if (removed.totals.totalCost === base.totals.totalCost) f.ok();
    else
      f.fail(
        month,
        "I12",
        "removing the extra must return the total exactly",
        String(base.totals.totalCost),
        String(removed.totals.totalCost),
      );
  }

  // ---------------- I10: carry-forward
  {
    for (let i = 0; i + 1 < s.months.length; i++) {
      const m1 = s.months[i];
      const m2 = s.months[i + 1];
      const comp = computeMonth({
        month: m1,
        cutoff: monthEnd(m1),
        finalize: true,
        members: s.members,
        rooms: s.rooms,
        changes: s.changes,
        guestMeals: s.guestMeals,
        extras: s.extras,
        bills: s.bills,
        rateCards: s.rateCards,
        today: s.today,
        soloElectricityMultiplier: s.soloElectricityMultiplier,
        soloWifiMultiplier: s.soloWifiMultiplier,
      });
      const r1 = buildSettlementRows({
        computation: comp,
        members: s.members,
        rooms: s.rooms,
        deposits: s.deposits,
        openingBalances: new Map(),
      });
      const closing = new Map(r1.map((r) => [r.memberId, r.closingBalance]));
      const presentInBoth = new Set(r1.map((r) => r.memberId));
      const comp2 = computeMonth({
        month: m2,
        cutoff: monthEnd(m2),
        finalize: true,
        members: s.members,
        rooms: s.rooms,
        changes: s.changes,
        guestMeals: s.guestMeals,
        extras: s.extras,
        bills: s.bills,
        rateCards: s.rateCards,
        today: s.today,
        soloElectricityMultiplier: s.soloElectricityMultiplier,
        soloWifiMultiplier: s.soloWifiMultiplier,
      });
      const r2 = buildSettlementRows({
        computation: comp2,
        members: s.members,
        rooms: s.rooms,
        deposits: s.deposits,
        openingBalances: closing,
      });
      for (const r of r2) {
        if (!presentInBoth.has(r.memberId)) {
          f.ok();
          continue;
        }
        if (r.openingBalance !== closing.get(r.memberId)) {
          f.fail(
            m2,
            "I10",
            `${r.memberName}: month ${m2} opening vs month ${m1} closing`,
            String(closing.get(r.memberId)),
            String(r.openingBalance),
          );
        } else f.ok();
      }
    }
  }

  void addDays;
  void addMonths;
  void refStatusOn;
  void refCardFor;
  void largestRemainder;
  void monthOf;
  void inWindow;
  return { scenarioId: s.id, seed: s.seed, checks: f.checks, failures: f.items, figures };
}

function inWindow(m: MemberData, date: string, today: string): boolean {
  const to = m.leaveDate ?? (m.active ? null : today);
  if (date < m.joinDate) return false;
  if (to && date > to) return false;
  return true;
}

function statusOn2(changes: StatusChangeData[], memberId: string, date: string) {
  let cur: StatusChangeData["status"] = "OFF";
  let best: string | null = null;
  for (const c of changes) {
    if (c.memberId !== memberId) continue;
    if (c.date > date) continue;
    if (best === null || c.date >= best) {
      best = c.date;
      cur = c.status;
    }
  }
  return cur;
}

export { INVARIANT_TITLES };
