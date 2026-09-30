/**
 * Dumps one scenario in full, so a single failure can be read end to end.
 *
 *   npx tsx qa-audit/harness/inspect.ts <seed> [edge]
 */
import { makeScenario } from "../random/scenarios";
import {
  buildSettlementRows,
  computeMonth,
  computeRunningBalances,
  extraPoolForRange,
  apportionUtilities,
  mealRegisterForMonth,
} from "../../src/lib/calc";
import { monthEnd, monthStart, daysInMonth } from "../../src/lib/dates";

const seed = Number(process.argv[2] ?? 1);
const edge = process.argv[3] === "edge";
const s = makeScenario(seed, { edge });

console.log("scenario", s.id, "today", s.today, "months", s.months.join(","));
console.log("rooms", s.rooms.map((r) => `${r.number}/cap${r.capacity}${r.solo ? "/solo" : ""}`).join(" "));
console.log("members", s.members.map((m) => `${m.name}@${m.roomId}[${m.joinDate}..${m.leaveDate ?? "now"}${m.active ? "" : "/inactive"}]`).join(" "));
console.log("rateCards", JSON.stringify(s.rateCards.map((c) => ({ id: c.id, from: c.effectiveFrom, to: c.effectiveTo, full: c.fullMealRate, half: c.halfMealRate, gf: c.guestFullRate, gh: c.guestHalfRate, khala: c.khalaNormalRate, solo: c.khalaSoloRate, fee: c.managerDailyFee, extra: c.dailyExtraAmount }))));
console.log("bills", JSON.stringify(s.bills));
console.log("extras", JSON.stringify(s.extras.map((e) => [e.date, e.amount, e.category, e.voided, e.showInDailyBudget])));
console.log("guests", JSON.stringify(s.guestMeals));
console.log("deposits", JSON.stringify(s.deposits));
console.log("multipliers", s.soloElectricityMultiplier, s.soloWifiMultiplier);

for (const month of s.months) {
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
    soloElectricityMultiplier: s.soloElectricityMultiplier,
    soloWifiMultiplier: s.soloWifiMultiplier,
    today: s.today,
  });
  const rows = buildSettlementRows({
    computation: app,
    members: s.members,
    rooms: s.rooms,
    deposits: s.deposits,
    openingBalances: new Map(),
  });
  const pool = extraPoolForRange({
    extras: s.extras,
    from: monthStart(month),
    to: app.cutoff,
    activeMemberIds: app.activeMemberIds,
  });
  const ap = apportionUtilities({
    members: s.members,
    rooms: s.rooms,
    bills: s.bills,
    from: monthStart(month),
    to: app.cutoff,
    soloElectricityMultiplier: s.soloElectricityMultiplier,
    soloWifiMultiplier: s.soloWifiMultiplier,
    today: s.today,
  });
  const sum = (fn: (r: any) => number) => rows.reduce((t, r) => t + fn(r), 0);
  console.log(`\n=== ${month} (cutoff ${app.cutoff}, days ${daysInMonth(month)}) ===`);
  console.log("active", app.activeMemberIds.length, "solo", ap.soloCount);
  console.log("extrasPool", pool.total, "perMember", pool.perMember, "Σshares", sum((r) => r.extraAmount), "Δ", sum((r) => r.extraAmount) - pool.total);
  console.log("elecPool", ap.totalElectricity, "wifiPool", ap.totalWifi, "khalaPool", sum((r) => r.khalaAmount), "Σutility", sum((r) => r.khalaElecWifiAmount));
  console.log("meal", app.totals.mealAmount, "cost", app.totals.totalCost);
  console.table(rows.map((r: any) => ({
    room: r.roomNumber, name: r.memberName.slice(0, 22),
    f: r.fullMealCount, h: r.halfMealCount, gF: r.guestFullCount, gH: r.guestHalfCount,
    meal: r.mealAmount, kh: r.khalaAmount, el: r.electricityAmount, wf: r.wifiAmount,
    kw: r.khalaElecWifiAmount, ex: r.extraAmount, cost: r.totalCost,
    dep: r.newDeposits, close: r.closingBalance,
  })));
  const reg = mealRegisterForMonth({
    month, members: s.members, rooms: s.rooms, changes: s.changes, today: s.today, cutoff: monthEnd(month),
  });
  console.log("register rows", reg.rows.length, reg.rows.map((r) => `${r.name.slice(0, 12)}:${r.fullCount}/${r.halfCount}`).join(" "));
}

const running = computeRunningBalances({
  members: s.members,
  rooms: s.rooms,
  changes: s.changes,
  guestMeals: s.guestMeals,
  extras: s.extras,
  bills: s.bills,
  rateCards: s.rateCards,
  deposits: s.deposits,
  settlements: s.settlements,
  openingBalances: s.openingBalances,
  lastClosedMonth: s.lastClosedMonth,
  soloElectricityMultiplier: s.soloElectricityMultiplier,
  soloWifiMultiplier: s.soloWifiMultiplier,
  today: s.today,
});
console.log(`\n=== balances ${running.periodStart} → ${running.periodEnd} ===`);
console.table(running.rows.map((r: any) => ({
  room: r.roomNumber, name: r.memberName.slice(0, 22),
  open: r.openingBalance, dep: r.deposits, util: r.utilityCost, ex: r.extraCost, cost: r.cost, bal: r.balance,
})));
console.log("summary", running.summary);
