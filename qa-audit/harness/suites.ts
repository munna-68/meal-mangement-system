/**
 * PHASE 4 — deterministic suites A to H and K against the app's engine.
 *
 * Every expected number here is written out by hand in the comment above it, so
 * a failure is a disagreement with the specification, not with another test.
 */
import {
  apportionUtilities,
  buildSettlementRows,
  computeDayTotals,
  computeMonth,
  computeRunningBalances,
  extraPoolForRange,
  isSoloInSharedRoom,
  khalaAmountFor,
  mealRegisterForMonth,
  occupancyForRange,
  rateCardFor,
  resolveStatusTimeline,
  roomBreakdownForDay,
  statusOnDate,
  type DepositData,
  type ExtraItemData,
  type GuestMealData,
  type MemberData,
  type RateCardData,
  type RoomData,
  type StatusChangeData,
  type UtilityBillData,
} from "../../src/lib/calc";
import { addDays, daysInMonth, monthEnd, monthStart } from "../../src/lib/dates";
import { formatTaka, formatTakaBengali, formatTakaPlain, roundTaka } from "../../src/lib/money";
import { refComputeMonth, largestRemainder, type RefRoom } from "../ref/reference";

let passed = 0;
const failures: string[] = [];
let suite = "";

function sec(title: string) {
  suite = title;
  console.log(`\n=== ${title} ===`);
}
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
  const e = JSON.stringify(expected, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
  if (a === e) passed += 1;
  else failures.push(`[${suite}] ${name}\n    expected: ${e}\n    actual:   ${a}`);
}
function note(text: string) {
  console.log(`    — ${text}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CARD: RateCardData = {
  id: "rc1",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  fullMealRate: 60,
  halfMealRate: 35,
  guestFullRate: 75,
  guestHalfRate: 40,
  sehriRate: 70,
  feastFlatCharge: 200,
  khalaNormalRate: 300,
  khalaSoloRate: 400,
  managerDailyFee: 30,
  dailyExtraAmount: 300,
};

const ROOMS: RoomData[] = [
  { id: "A", number: "101", capacity: 2 },
  { id: "B", number: "102", capacity: 2 },
  { id: "C", number: "205", capacity: 1 },
];

function m(id: string, roomId: string, o: Partial<MemberData> = {}): MemberData {
  return {
    id,
    name: id.toUpperCase(),
    roomId,
    active: true,
    joinDate: "2026-01-01",
    leaveDate: null,
    ...o,
  };
}

const M1 = m("m1", "A");
const M2 = m("m2", "A");
const M3 = m("m3", "B"); // alone in a 2-bed room -> solo
const M4 = m("m4", "C"); // 1-bed -> never solo
const MEMBERS = [M1, M2, M3, M4];

const FULL_ALL: StatusChangeData[] = MEMBERS.map((x) => ({
  memberId: x.id,
  date: "2026-01-01",
  status: "FULL" as const,
  sehri: false,
}));

const base = {
  members: MEMBERS,
  rooms: ROOMS,
  changes: FULL_ALL,
  guestMeals: [] as GuestMealData[],
  extras: [] as ExtraItemData[],
  bills: [] as UtilityBillData[],
  rateCards: [CARD],
};

// ===========================================================================
sec("A1 — sticky status: every transition, and what precedes the first record");
// ===========================================================================
{
  const changes: StatusChangeData[] = [
    { memberId: "x", date: "2026-03-10", status: "FULL", sehri: false },
    { memberId: "x", date: "2026-03-20", status: "OFF", sehri: false },
    { memberId: "x", date: "2026-03-25", status: "HALF_DAY", sehri: false },
    { memberId: "x", date: "2026-03-28", status: "HALF_NIGHT", sehri: false },
    { memberId: "x", date: "2026-03-30", status: "FULL", sehri: false },
  ];
  const tl = resolveStatusTimeline(changes, ["x"], "2026-03-08", "2026-03-31").get("x")!;
  check("day before the first change is OFF", tl.get("2026-03-09")?.status, "OFF");
  check("FULL applies from its own date", tl.get("2026-03-10")?.status, "FULL");
  check("FULL carries 9 days forward", tl.get("2026-03-19")?.status, "FULL");
  check("OFF applies", tl.get("2026-03-20")?.status, "OFF");
  check("HALF_DAY applies", tl.get("2026-03-25")?.status, "HALF_DAY");
  check("HALF_NIGHT applies", tl.get("2026-03-28")?.status, "HALF_NIGHT");
  check("back to FULL", tl.get("2026-03-30")?.status, "FULL");
  check(
    "every transition is one of the four documented values",
    [...new Set(changes.map((c) => c.status))].sort(),
    ["FULL", "HALF_DAY", "HALF_NIGHT", "OFF"],
  );
  note("HALF_DAY and HALF_NIGHT both price at the single `half` rate — there is no separate night rate.");
}

// ===========================================================================
sec("A2 — a backdated edit ripples forward and into the next month");
// ===========================================================================
{
  // m1 is FULL all March; on 1 April we backdate a change to 20 March = OFF.
  const changes: StatusChangeData[] = [
    ...FULL_ALL,
    { memberId: "m1", date: "2026-03-20", status: "OFF", sehri: false },
  ];
  const march = computeMonth({
    ...base,
    month: "2026-03",
    changes,
    today: "2026-04-30",
    finalize: true,
  });
  const april = computeMonth({
    ...base,
    month: "2026-04",
    changes,
    today: "2026-04-30",
    finalize: true,
  });
  // 1-19 March FULL (19 days) then OFF for 20-31 March (12 days)
  check("March: 19 full days", march.perMember.get("m1")!.fullMealCount, 19);
  check("March: 19 x 60 = 1140", march.perMember.get("m1")!.mealAmount, 1140);
  // April: still OFF, because nothing changed it back
  check("April: 0 full days (ripple carried across the month boundary)", april.perMember.get("m1")!.fullMealCount, 0);
  check("April: 0 meal cost", april.perMember.get("m1")!.mealAmount, 0);
  note("Backdating one day silently re-prices every later day AND the whole of next month until the next change.");
}

// ===========================================================================
sec("A3 — month lengths: 28, 29, 30 and 31 days");
// ===========================================================================
{
  const cases: Array<[string, number]> = [
    ["2026-02", 28],
    ["2028-02", 29],
    ["2026-04", 30],
    ["2026-01", 31],
  ];
  for (const [month, days] of cases) {
    const comp = computeMonth({
      ...base,
      month,
      today: monthEnd(month),
      finalize: true,
    });
    check(`${month} has ${days} days`, daysInMonth(month).length, days);
    check(`${month}: member is FULL for all ${days} days`, comp.perMember.get("m1")!.fullMealCount, days);
    check(`${month}: ${days} x 60`, comp.perMember.get("m1")!.mealAmount, days * 60);
    const reg = mealRegisterForMonth({ ...base, month, today: monthEnd(month) });
    check(`${month}: register has one column per day`, reg.days.length, days);
  }
  note("A leap February bills 29 days, a normal February 28 — no off-by-one.");
}

// ===========================================================================
sec("A4 — register vs settlement, and the missing guest columns");
// ===========================================================================
{
  const changes: StatusChangeData[] = [
    { memberId: "m1", date: "2026-03-01", status: "FULL", sehri: false },
    { memberId: "m2", date: "2026-03-01", status: "HALF_DAY", sehri: false },
    { memberId: "m3", date: "2026-03-01", status: "HALF_NIGHT", sehri: false },
  ];
  const guests: GuestMealData[] = [
    { memberId: "m1", date: "2026-03-05", type: "GUEST_FULL", count: 2 },
    { memberId: "m2", date: "2026-03-06", type: "GUEST_HALF", count: 3 },
  ];
  const comp = computeMonth({ ...base, month: "2026-03", changes, guestMeals: guests, today: "2026-03-31", finalize: true });
  const reg = mealRegisterForMonth({ ...base, month: "2026-03", changes, today: "2026-03-31" });
  const byId = (id: string) => reg.rows.find((r) => r.memberId === id)!;
  check("m1 register full", byId("m1").fullCount, comp.perMember.get("m1")!.fullMealCount);
  check("m2 register half", byId("m2").halfCount, comp.perMember.get("m2")!.halfMealCount);
  check("m3 register half", byId("m3").halfCount, comp.perMember.get("m3")!.halfMealCount);
  check("register carries NO guest information", Object.keys(byId("m1")).sort(), [
    "cells",
    "fullCount",
    "halfCount",
    "memberId",
    "name",
    "roomNumber",
  ]);
  check("guest meals are charged to the host", comp.totals.guestFullCount, 2);
  note("The register PDF has no guest column and no money column: guest meals are invisible in the register and only visible in the ledger.");
}

// ===========================================================================
sec("B — guest meals and the 5 taka deduction");
// ===========================================================================
{
  // The owner's own worked example: 4 full, 3 half, 1 full guest, 4 half guests.
  const card: RateCardData = { ...CARD, guestFullRate: 80, guestHalfRate: 45 };
  const changes: StatusChangeData[] = [
    { memberId: "m1", date: "2026-09-01", status: "FULL", sehri: false },
    { memberId: "m2", date: "2026-09-01", status: "FULL", sehri: false },
    { memberId: "m3", date: "2026-09-01", status: "FULL", sehri: false },
    { memberId: "m4", date: "2026-09-01", status: "FULL", sehri: false },
    { memberId: "m1", date: "2026-09-01", status: "OFF", sehri: false },
  ];
  const guests: GuestMealData[] = [
    { memberId: "m4", date: "2026-09-30", type: "GUEST_FULL", count: 1 },
    { memberId: "m4", date: "2026-09-30", type: "GUEST_HALF", count: 4 },
  ];
  const day = computeDayTotals({
    date: "2026-09-30",
    members: MEMBERS,
    changes: [
      { memberId: "m1", date: "2026-09-01", status: "FULL", sehri: false },
      { memberId: "m2", date: "2026-09-01", status: "FULL", sehri: false },
      { memberId: "m3", date: "2026-09-01", status: "FULL", sehri: false },
      { memberId: "m4", date: "2026-09-01", status: "FULL", sehri: false },
      { memberId: "m5", date: "2026-09-01", status: "OFF", sehri: false },
    ],
    guestMeals: guests,
    extras: [],
    rateCard: card,
    today: "2026-09-30",
  });
  void changes;
  check("4 full meals", day.fullCount, 4);
  check("guest full count", day.guestFullCount, 1);
  check("guest half count", day.guestHalfCount, 4);
  // 4x60 = 240 full, 1x80 = 80 guest full, 4x45 = 180 guest half, minus 5x5 = 25
  check("guest deduction is 5 taka per guest meal", day.guestDeductionAmount, 25);
  check("meal cost today = 240 + 105? no: 240 + 80 + 180 - 25 = 475 with no half", day.mealsSubtotal, 240 + 80 + 180 - 25);

  const guests2: GuestMealData[] = [
    { memberId: "m1", date: "2026-09-30", type: "GUEST_FULL", count: 1 },
    { memberId: "m1", date: "2026-09-30", type: "GUEST_HALF", count: 4 },
  ];
  // 4 FULL + 3 HALF + guests attached to m1 — the owner's exact worked example.
  const seven = [
    m("h1", "A"),
    m("h2", "A"),
    m("h3", "B"),
    m("h4", "B"),
    m("h5", "C"),
    m("h6", "C"),
    m("h7", "C"),
  ];
  const day2 = computeDayTotals({
    date: "2026-09-30",
    members: seven,
    changes: [
      { memberId: "h1", date: "2026-09-01", status: "FULL", sehri: false },
      { memberId: "h2", date: "2026-09-01", status: "FULL", sehri: false },
      { memberId: "h3", date: "2026-09-01", status: "FULL", sehri: false },
      { memberId: "h4", date: "2026-09-01", status: "FULL", sehri: false },
      { memberId: "h5", date: "2026-09-01", status: "HALF_DAY", sehri: false },
      { memberId: "h6", date: "2026-09-01", status: "HALF_NIGHT", sehri: false },
      { memberId: "h7", date: "2026-09-01", status: "HALF_NIGHT", sehri: false },
    ],
    guestMeals: guests2.map((g) => ({ ...g, memberId: "h1" })),
    extras: [],
    rateCard: card,
    today: "2026-09-30",
  });
  // 4 full x60 = 240; 3 half x35 = 105; guest 1x80 + 4x45 = 260; less 5x5 = 25
  check("full count", day2.fullCount, 4);
  check("half count (half-day + half-night)", day2.halfCount, 3);
  check("the owner's 580 figure", day2.mealsSubtotal, 580);

  // What the MONTH charges the host for the same guests
  const monthChanges: StatusChangeData[] = [
    { memberId: "h1", date: "2026-09-30", status: "FULL", sehri: false },
    { memberId: "h2", date: "2026-09-30", status: "FULL", sehri: false },
    { memberId: "h3", date: "2026-09-30", status: "FULL", sehri: false },
    { memberId: "h4", date: "2026-09-30", status: "FULL", sehri: false },
    { memberId: "h5", date: "2026-09-30", status: "HALF_DAY", sehri: false },
    { memberId: "h6", date: "2026-09-30", status: "HALF_NIGHT", sehri: false },
    { memberId: "h7", date: "2026-09-30", status: "HALF_NIGHT", sehri: false },
  ];
  const monthComp = computeMonth({
    ...base,
    members: seven,
    month: "2026-09",
    changes: monthChanges,
    guestMeals: guests2.map((g) => ({ ...g, memberId: "h1" })),
    rateCards: [card],
    today: "2026-09-30",
    finalize: true,
  });
  check(
    "the month charges the host 260 for guests, with NO 5 taka deduction",
    monthComp.perMember.get("h1")!.mealAmount - 60,
    260,
  );
  check("day budget deducted 25", day2.mealsSubtotal, 580);
  check("month charges the host 60 + 260 = 320 for the same day", monthComp.perMember.get("h1")!.mealAmount, 320);
  check(
    "for the SAME guests the member is charged 25 more than the bazar was given",
    monthComp.perMember.get("h1")!.mealAmount - 60 - (day2.guestFullAmount + day2.guestHalfAmount - day2.guestDeductionAmount),
    25,
  );
  check("and the month total is 25 higher than the day's budgeted meals", monthComp.totals.mealAmount - day2.mealsSubtotal, 25);
  note(
    "MISMATCH: the bazar pays 5 taka less per guest meal than the member is billed. Over a month the mess hands out 5 taka per guest meal that nobody pays back.",
  );
}

// ===========================================================================
sec("C — rate cards: mid-month change, and which days it touches");
// ===========================================================================
{
  const cards: RateCardData[] = [
    { ...CARD, id: "old", effectiveFrom: "2026-03-01", fullMealRate: 50 },
    { ...CARD, id: "new", effectiveFrom: "2026-03-16", fullMealRate: 70 },
  ];
  check("day before the change", rateCardFor(cards, "2026-03-15")?.id, "old");
  check("the change day itself", rateCardFor(cards, "2026-03-16")?.id, "new");
  const comp = computeMonth({
    ...base,
    month: "2026-03",
    rateCards: cards,
    today: "2026-03-31",
    finalize: true,
  });
  // 15 days at 50 + 16 days at 70
  check("15 x 50 + 16 x 70 = 1870", comp.perMember.get("m1")!.mealAmount, 15 * 50 + 16 * 70);
  check("full days still 31", comp.perMember.get("m1")!.fullMealCount, 31);
  note("A mid-month rate change re-prices the days AFTER it only — already-billed days keep their rate.");

  // Backdating the change to the 1st re-prices the whole month
  const backdated: RateCardData[] = [
    { ...CARD, id: "old", effectiveFrom: "2026-03-01", fullMealRate: 50, effectiveTo: "2026-03-10" },
    { ...CARD, id: "new", effectiveFrom: "2026-03-11", fullMealRate: 70 },
  ];
  const comp2 = computeMonth({
    ...base,
    month: "2026-03",
    rateCards: backdated,
    today: "2026-03-31",
    finalize: true,
  });
  check("10 x 50 + 21 x 70 = 1970", comp2.perMember.get("m1")!.mealAmount, 10 * 50 + 21 * 70);
  note("Editing the effectiveFrom of a card re-prices every day it now covers, including days already charged in an OPEN month.");
}

// ===========================================================================
sec("D — bazar budget and the manager fee");
// ===========================================================================
{
  // 4 full meals = 240, no extras, manager fee 30
  const day = computeDayTotals({
    date: "2026-09-30",
    members: MEMBERS,
    changes: FULL_ALL.map((c) => ({ ...c, date: "2026-09-30" })),
    guestMeals: [],
    extras: [],
    rateCard: CARD,
    today: "2026-09-30",
  });
  check("4 x 60 = 240", day.mealsSubtotal, 240);
  check("manager fee is 30", day.managerFeeAmount, 30);
  check("budget = 240 - 30 = 210, i.e. the bazar person gets 210 for a 240 bazar", day.totalBudget, 210);

  // No activity at all: no manager fee
  const idle = computeDayTotals({
    date: "2026-09-30",
    members: MEMBERS,
    changes: [],
    guestMeals: [],
    extras: [],
    rateCard: CARD,
    today: "2026-09-30",
  });
  check("an idle day charges no manager fee", idle.managerFeeAmount, 0);
  check("an idle day budgets zero", idle.totalBudget, 0);

  // A day where the manager fee is bigger than the food: budget goes negative
  const tiny = computeDayTotals({
    date: "2026-09-30",
    members: MEMBERS,
    changes: [{ memberId: "m4", date: "2026-09-30", status: "HALF_DAY", sehri: false }],
    guestMeals: [],
    extras: [],
    rateCard: { ...CARD, halfMealRate: 5 },
    today: "2026-09-30",
  });
  check("a budget below the manager fee goes NEGATIVE", tiny.totalBudget, 5 - 30);
  note("A day cheaper than 30 taka hands the shopper a NEGATIVE budget. Nothing in the code prevents or explains it.");

  // The manager fee is not in either pool
  const withFee: (ExtraItemData & { sourceKey?: string | null })[] = [
    { id: "r", date: "2026-09-30", label: "Daily recurring Extra", amount: 300, category: "RECURRING_DAILY", showInDailyBudget: true, voided: false, sourceKey: "auto:daily-extra:2026-09-30" },
    { id: "f", date: "2026-09-30", label: "Manager's daily fee", amount: 30, category: "MANAGER_FEE", showInDailyBudget: true, voided: false, sourceKey: "auto:manager-fee:2026-09-30" },
  ];
  const pool = extraPoolForRange({ extras: withFee, from: "2026-09-01", to: "2026-09-30", activeMemberIds: Array.from({ length: 4 }, (_, i) => `qa${i + 1}`) });
  check("the extras pool excludes the manager fee", pool.total, 300);
  const dayWithFee = computeDayTotals({
    date: "2026-09-30",
    members: MEMBERS,
    changes: FULL_ALL.map((c) => ({ ...c, date: "2026-09-30" })),
    guestMeals: [],
    extras: withFee,
    rateCard: CARD,
    today: "2026-09-30",
  });
  check("the day's budget also excludes the manager fee from the extras", dayWithFee.extraAmount, 300);
  check("the manager fee is still deducted from the cash", dayWithFee.totalBudget, 240 + 300 - 30);
  const comp = computeMonth({
    ...base,
    month: "2026-09",
    changes: FULL_ALL.map((c) => ({ ...c, date: "2026-09-30" })),
    extras: withFee,
    today: "2026-09-30",
    finalize: true,
  });
  check("no member is charged the manager fee anywhere: 4 members x 75 = 300", comp.totals.extraAmount, 300);
  check("meals carry no manager fee: 4 full x 60 = 240", comp.totals.mealAmount, 240);
  check("the extras pool itself is only the 300 daily extra", comp.extraPool.total, 300);
  note("Manager fee: correctly absent from both pools and from every member charge. Verified.");
}

// ===========================================================================
sec("E — extras pool rounding (the owner's own awkward numbers)");
// ===========================================================================
{
  const twelve = Array.from({ length: 12 }, (_, i) => m(`e${i + 1}`, "A"));
  const one: ExtraItemData = {
    id: "x",
    date: "2026-09-10",
    label: "odd",
    amount: 6301,
    category: "ONE_OFF",
    showInDailyBudget: false,
    voided: false,
  };
  const p1 = extraPoolForRange({ extras: [one], from: "2026-09-01", to: "2026-09-30", activeMemberIds: Array.from({ length: 12 }, (_, i) => `qa${i + 1}`) });
  check("pool total is exactly 6,301", p1.total, 6301);
  check("app per-head = round(6301/12) = 525", p1.perMember, 525);
  check("12 x 525 = 6,300 — one taka DISAPPEARS", 12 * p1.perMember, 6300);
  const fair = largestRemainder(BigInt(6301), twelve.map(() => 1));
  check("largest-remainder would give 6,301 back exactly", fair.reduce((a, b) => a + b, BigInt(0)).toString(), "6301");
  check("largest-remainder hands out 525 x 11 and 526 x 1", fair.map(Number).sort((a, b) => a - b).slice(0, 1), [525]);

  const oneTaka: ExtraItemData = { ...one, id: "y", amount: 1 };
  const p2 = extraPoolForRange({ extras: [oneTaka], from: "2026-09-01", to: "2026-09-30", activeMemberIds: Array.from({ length: 12 }, (_, i) => `qa${i + 1}`) });
  check("a 1 taka extra rounds to 0 per head", p2.perMember, 0);
  check("12 x 0 = 0 — the whole taka DISAPPEARS", 12 * p2.perMember, 0);

  // 7 members, pool 100 → 100/7 = 14.28…, round = 14, 7x14 = 98
  const p3 = extraPoolForRange({
    extras: [{ ...one, id: "z", amount: 100 }],
    from: "2026-09-01",
    to: "2026-09-30",
    activeMemberIds: Array.from({ length: 7 }, (_, i) => `qa${i + 1}`),
  });
  check("7 members, 100 taka pool, app per head", p3.perMember, 14);
  check("7 x 14 = 98 — two taka DISAPPEAR", 7 * p3.perMember, 98);

  // And the other direction: money CREATED
  const p4 = extraPoolForRange({
    extras: [{ ...one, id: "w", amount: 5 }],
    from: "2026-09-01",
    to: "2026-09-30",
    activeMemberIds: Array.from({ length: 8 }, (_, i) => `qa${i + 1}`),
  });
  check("5/8 rounds to 1", p4.perMember, 1);
  check("8 x 1 = 8 — three taka are CREATED out of a 5 taka pool", 8 * p4.perMember, 8);
  note(
    "The extras pool is the ONLY split in the app that rounds per member instead of distributing the remainder. It both loses and invents taka.",
  );
}

// ===========================================================================
sec("F — utility pool: room capacity, solo rooms, khala bill");
// ===========================================================================
{
  const bills: UtilityBillData[] = [
    { month: "2026-09", type: "ELECTRICITY", amount: 12_000 },
    { month: "2026-09", type: "WIFI", amount: 1_200 },
  ];
  const ap = apportionUtilities({ ...base, bills, from: "2026-09-01", to: "2026-09-30", today: "2026-09-30" });
  // 4 members, m3 is solo -> weights 1,1,2,1 = 5
  check("solo count", ap.soloCount, 1);
  check("per-head electricity = 12000/5 = 2400", ap.perHeadElectricity, 2400);
  check("shared member pays 2400", ap.byMember.get("m1")!.electricity, 2400);
  check("solo member pays 4800", ap.byMember.get("m3")!.electricity, 4800);
  check("1-bed room is not solo, pays 2400", ap.byMember.get("m4")!.electricity, 2400);
  check(
    "shares add back to the bill exactly",
    [...ap.byMember.values()].reduce((t, s) => t + s.electricity, 0),
    12_000,
  );

  // Khala with no bill: from the rate card
  const comp = computeMonth({ ...base, month: "2026-09", bills, today: "2026-09-30", finalize: true });
  check("khala from the rate card: shared 300, solo 400", [
    comp.perMember.get("m1")!.khalaAmount,
    comp.perMember.get("m3")!.khalaAmount,
  ], [300, 400]);
  check("khala pool = 300+300+400+300 = 1300", comp.totals.khalaAmount, 1300);

  // Khala WITH a bill of 4,000 distributed by those same weights
  const withKhala: UtilityBillData[] = [...bills, { month: "2026-09", type: "KHALA", amount: 4_000 }];
  const comp2 = computeMonth({
    ...base,
    month: "2026-09",
    bills: withKhala,
    today: "2026-09-30",
    finalize: true,
  });
  check("the khala bill of 4,000 is fully distributed", comp2.totals.khalaAmount, 4000);
  check("shared member: 4000 x 300/1300 = 923", comp2.perMember.get("m1")!.khalaAmount, 923);
  check("solo member: 4000 x 400/1300 = 1231", comp2.perMember.get("m3")!.khalaAmount, 1231);
  check("923 x 3 + 1231 = 4000 exactly", 923 * 3 + 1231, 4000);
  note("With an explicit khala bill, the SOLO RATE STOPS BEING the solo rate — it becomes purely a proportional weight. A 1,000 vs 1,333 split becomes 1,034 vs 1,035.");

  // Empty month
  const none = computeMonth({ ...base, month: "2026-09", today: "2026-09-30", finalize: true });
  check(
    "no bills means no electricity or wifi (khala still comes from the rate card)",
    [none.totals.electricityAmount, none.totals.wifiAmount, none.totals.khalaAmount],
    [0, 0, 1300],
  );
}

// ===========================================================================
sec("F2 — a member who joins or leaves mid-month");
// ===========================================================================
{
  // The owner's own bill shape: electricity 6,00,000 and wifi 15,000 for a
  // 30-day month, five members, nobody alone in a multi-bed room, so an even
  // 1,20,000 electricity head and a 3,000 wifi head.
  const bills: UtilityBillData[] = [
    { month: "2026-09", type: "ELECTRICITY", amount: 600_000 },
    { month: "2026-09", type: "WIFI", amount: 15_000 },
  ];
  const rooms: RoomData[] = [
    { id: "A", number: "101", capacity: 2 },
    { id: "B", number: "102", capacity: 2 },
    { id: "C", number: "205", capacity: 1 },
  ];
  const four = [m("a1", "A"), m("a2", "A"), m("b1", "B"), m("b2", "B")];
  const late = m("late", "C", { joinDate: "2026-09-05" }); // present 11 of 30 days
  const members = [...four, late];
  const changes: StatusChangeData[] = [
    ...four.map((x) => ({ memberId: x.id, date: "2026-09-01", status: "FULL" as const, sehri: false })),
    { memberId: "late", date: "2026-09-05", status: "FULL", sehri: false },
  ];
  const today = "2026-09-15";

  const live = computeMonth({ members, rooms, changes, guestMeals: [], extras: [], bills, rateCards: [CARD], month: "2026-09", today, finalize: false });
  const close = computeMonth({ members, rooms, changes, guestMeals: [], extras: [], bills, rateCards: [CARD], month: "2026-09", today, finalize: true });

  // Even split: 600,000 / 5 = 120,000 electricity and 15,000 / 5 = 3,000 wifi.
  check("a full-month member is charged 1,20,000 electricity", close.perMember.get("a1")!.electricityAmount, 120_000);
  check("and 3,000 wifi", close.perMember.get("a1")!.wifiAmount, 3_000);
  check("and 300 khala", close.perMember.get("a1")!.khalaAmount, 300);

  check(
    "JOINER: 11 of 30 days, but the CLOSE figure charges a FULL 1,20,000",
    close.perMember.get("late")!.electricityAmount,
    120_000,
  );
  check(
    "JOINER: the LIVE figure for the same member on the same day is 11/30",
    live.perMember.get("late")!.electricityAmount,
    Math.round((120_000 * 11) / 30),
  );
  check(
    "JOINER: the two pages disagree by 76,000 taka for the same member today",
    close.perMember.get("late")!.electricityAmount - live.perMember.get("late")!.electricityAmount,
    76_000,
  );
  check(
    "JOINER: meals are prorated correctly (11 days), only the flat charges are not",
    [close.perMember.get("late")!.fullMealCount, close.perMember.get("late")!.mealAmount],
    [11, 11 * 60],
  );
  check(
    "JOINER: khala is also charged in full at close",
    close.perMember.get("late")!.khalaAmount,
    300,
  );
  check(
    "JOINER: wifi is also charged in full at close",
    close.perMember.get("late")!.wifiAmount,
    3_000,
  );
  check(
    "JOINER: total overcharge at close, versus a fair 11/30 share",
    close.perMember.get("late")!.khalaElecWifiAmount - Math.round((123_300 * 11) / 30),
    123_300 - Math.round((123_300 * 11) / 30),
  );
  note(
    "CRITICAL: closing a month charges somebody who was there 11 of 30 days a FULL month of khala + electricity + wifi — here 123,300 taka instead of about 45,210. The live Balances page shows the smaller number, the Settlement page shows the bigger one, and closing freezes the bigger one.",
  );

  // A member who leaves early
  const early = m("early", "A", { leaveDate: "2026-09-03" });
  const members2 = [...four, early];
  const changes2: StatusChangeData[] = [
    ...four.map((x) => ({ memberId: x.id, date: "2026-09-01", status: "FULL" as const, sehri: false })),
    { memberId: "early", date: "2026-09-01", status: "FULL", sehri: false },
  ];
  const close2 = computeMonth({ members: members2, rooms, changes: changes2, guestMeals: [], extras: [], bills, rateCards: [CARD], month: "2026-09", today: "2026-09-30", finalize: true });
  const live2 = computeMonth({ members: members2, rooms, changes: changes2, guestMeals: [], extras: [], bills, rateCards: [CARD], month: "2026-09", today: "2026-09-15", finalize: false });
  check(
    "LEAVING: present 3 days, but a month closed on the 30th charges a full 1,20,000",
    close2.perMember.get("early")!.electricityAmount,
    120_000,
  );
  check(
    "LEAVING: the live view on the 15th charges 3/30",
    live2.perMember.get("early")!.electricityAmount,
    Math.round((120_000 * 3) / 30),
  );
  note(
    "CRITICAL: the same overcharge runs the other way for somebody who LEFT early — they are billed for the whole month they were only in it for three days.",
  );

  // Extras pool is never pro-rated, live or closed
  const extras: ExtraItemData[] = [
    { id: "x", date: "2026-09-10", label: "Fridge", amount: 6_000, category: "ONE_OFF", showInDailyBudget: false, voided: false },
  ];
  const live3 = computeMonth({ members, rooms, changes, guestMeals: [], extras, bills, rateCards: [CARD], month: "2026-09", today, finalize: false });
  check(
    "JOINER: the extras pool is a FULL share even in the live view",
    live3.perMember.get("late")!.extraAmount,
    live3.perMember.get("a1")!.extraAmount,
  );
  note("The extras pool has no accrual at all: everybody in the month pays the same full share, however briefly they were there.");
}

// ===========================================================================
sec("G — deposits and balances");
// ===========================================================================
{
  const comp = computeMonth({ ...base, month: "2026-09", today: "2026-09-30", finalize: true });
  const deposits: DepositData[] = [
    { memberId: "m1", date: "2026-09-05", amount: 5_000 },
    { memberId: "m1", date: "2026-09-25", amount: 1_000 },
    { memberId: "m2", date: "2026-09-10", amount: 0 },
    { memberId: "m2", date: "2026-09-11", amount: 2_500 },
    { memberId: "m3", date: "2026-09-11", amount: 2_500 },
    { memberId: "m3", date: "2026-09-11", amount: 2_500 },
  ];
  const rows = buildSettlementRows({
    computation: comp,
    members: MEMBERS,
    rooms: ROOMS,
    deposits,
    openingBalances: new Map(),
  });
  const g = (id: string) => rows.find((r) => r.memberId === id)!;
  check("deposits inside the month are summed", g("m1").newDeposits, 6_000);
  check("a zero deposit contributes nothing", g("m2").newDeposits, 2_500);
  check("two identical deposits are BOTH counted (there is no de-duplication)", g("m3").newDeposits, 5_000);
  check("balance = opening + deposits - cost", g("m1").closingBalance, 0 + 6_000 - g("m1").totalCost);
  check("a deposit larger than the cost gives a positive balance", g("m1").closingBalance > 0, true);

  // A deposit after the month end
  const future = buildSettlementRows({
    computation: comp,
    members: MEMBERS,
    rooms: ROOMS,
    deposits: [...deposits, { memberId: "m1", date: "2026-10-01", amount: 99_000 }],
    openingBalances: new Map(),
  });
  check("a deposit in the next month is not counted in this one", future.find((r) => r.memberId === "m1")!.newDeposits, 6_000);
  note("Deposits are append-only rows: submitting the same deposit twice records it twice. There is no idempotency key.");
}

// ===========================================================================
sec("H — changing a room or a capacity rewrites a month that is still open");
// ===========================================================================
{
  const bills: UtilityBillData[] = [
    { month: "2026-09", type: "ELECTRICITY", amount: 12_000 },
    { month: "2026-09", type: "WIFI", amount: 1_200 },
  ];
  const before = computeMonth({ ...base, month: "2026-09", bills, today: "2026-09-30", finalize: true });
  // m2 is moved out of room A (which held m1 and m2) into room B (which held m3)
  const after = computeMonth({
    ...base,
    members: [M1, m("m2", "B"), M3, M4],
    month: "2026-09",
    bills,
    today: "2026-09-30",
    finalize: true,
  });
  check("before: m3 alone in room B is solo and pays 4,800", before.perMember.get("m3")!.electricityAmount, 4800);
  check("after: room B is full, so m3 is no longer solo and pays 2,400", after.perMember.get("m3")!.electricityAmount, 2400);
  check("m2 does not pay more for moving into a full room", after.perMember.get("m2")!.electricityAmount, 2400);
  check(
    "BUT m1, left alone in room A, BECOMES solo and is charged more",
    [before.perMember.get("m1")!.electricityAmount, after.perMember.get("m1")!.electricityAmount],
    [2400, 4800],
  );
  check(
    "and m1's khala goes up too",
    [before.perMember.get("m1")!.khalaAmount, after.perMember.get("m1")!.khalaAmount],
    [300, 400],
  );
  note(
    "A room change made today silently re-prices the whole open month. The member who is LEFT ALONE in the double is the one who gets charged more, without anyone deciding that.",
  );

  // Changing a capacity 1 -> 2 turns a single into a shared room
  const capRooms: RoomData[] = [{ id: "A", number: "101", capacity: 1 }];
  const solo = m("s", "A");
  const cap1 = computeMonth({ ...base, members: [solo], rooms: capRooms, month: "2026-09", today: "2026-09-30", finalize: true });
  const cap2 = computeMonth({ ...base, members: [solo], rooms: [{ id: "A", number: "101", capacity: 2 }], month: "2026-09", today: "2026-09-30", finalize: true });
  check("capacity 1: not solo, khala 300", cap1.perMember.get("s")!.khalaAmount, 300);
  check("capacity 2 alone: solo, khala 400", cap2.perMember.get("s")!.khalaAmount, 400);
  note("Changing a room's capacity from 1 to 2 raises that occupant's khala for every month recomputed, open or not.");
}

// ===========================================================================
sec("I-preview — live view vs the month that will be closed");
// ===========================================================================
{
  const bills: UtilityBillData[] = [
    { month: "2026-09", type: "ELECTRICITY", amount: 31_000 },
    { month: "2026-09", type: "WIFI", amount: 3_100 },
  ];
  const today = "2026-09-10";
  const live = computeMonth({ ...base, month: "2026-09", bills, today, finalize: false });
  const close = computeMonth({ ...base, month: "2026-09", bills, today, finalize: true });
  check(
    "the live electricity is about a third of the close figure",
    [live.perMember.get("m1")!.electricityAmount, close.perMember.get("m1")!.electricityAmount],
    [2067, 6200],
  );
  check("meals are the same either way", live.perMember.get("m1")!.mealAmount, close.perMember.get("m1")!.mealAmount);
  check("but the flat charges are not", live.totals.electricityAmount < close.totals.electricityAmount, true);
  note("The Settlement page shows the CLOSE figures, the Balances page shows the LIVE figures. Mid-month they never agree, by design, and nothing on screen says so.");
}

// ===========================================================================
sec("K — dates, timezones and month boundaries");
// ===========================================================================
{
  check("addDays across a month end", addDays("2026-01-31", 1), "2026-02-01");
  check("addDays across a leap day", addDays("2028-02-28", 1), "2028-02-29");
  check("addDays past a leap day", addDays("2028-02-29", 1), "2028-03-01");
  check("addDays back over a year end", addDays("2026-01-01", -1), "2025-12-31");
  check("31-day month end", monthEnd("2026-01"), "2026-01-31");
  check("30-day month end", monthEnd("2026-04"), "2026-04-30");
  check("28-day month end", monthEnd("2026-02"), "2026-02-28");
  check("leap month end", monthEnd("2028-02"), "2028-02-29");

  // The last minute of a Dhaka day is 18:00 UTC. A deposit stamped then must
  // still land on the same day.
  const lastMinute = new Date("2026-09-30T18:00:00.000Z");
  check("23:59 Dhaka on 30 Sep is 18:00Z", lastMinute.toISOString(), "2026-09-30T18:00:00.000Z");
  const firstMinute = new Date("2026-09-30T18:00:01.000Z");
  check("00:00:01 Dhaka on 1 Oct is 18:00:01Z the same day", firstMinute.toISOString(), "2026-09-30T18:00:01.000Z");
  note(
    "Dates are stored as `date` columns read as plain strings and 'today' is resolved with Intl in Asia/Dhaka, so the day cannot shift by timezone. Recorded timestamps in the audit log are timestamptz and will render in Dhaka time.",
  );

  // A day beyond "today" is never billed
  const comp = computeMonth({ ...base, month: "2026-09", today: "2026-09-10", finalize: true });
  check("only 10 days are billed when today is the 10th", comp.perMember.get("m1")!.fullMealCount, 10);
  check("cutoff is clamped to today", comp.cutoff, "2026-09-10");
}

// ===========================================================================
sec("M/N — formatting: lakh grouping, Bengali numerals, negative values");
// ===========================================================================
{
  check("lakh grouping", formatTakaPlain(600_000), "6,00,000");
  check("lakh grouping, crore", formatTakaPlain(12_345_678), "1,23,45,678");
  check("zero", formatTakaPlain(0), "0");
  check("negative", formatTakaPlain(-1_500), "-1,500");
  check("currency symbol", formatTaka(1_000), "৳1,000");
  check("Bengali numerals with lakh grouping", formatTakaBengali(600_000), "৳৬,০০,০০০");
  check("Bengali negative", formatTakaBengali(-1_500), "-৳১,৫০০");
  check("Bengali crore", formatTakaBengali(12_345_678), "৳১,২৩,৪৫,৬৭৮");
  check("roundTaka rounds half away from zero-ish and never returns -0", [roundTaka(0.4), roundTaka(-0.4), roundTaka(2.5), roundTaka(-2.5)], [0, 0, 3, -2]);
  check("roundTaka on a half-taka split rounds .5 up", roundTaka(0.5), 1);
  note("Money is stored as Postgres `integer` throughout — no floats, no paise, no rounding at rest.");
}

// ===========================================================================
sec("E2 — reference calculator agrees with the app except on the extras split");
// ===========================================================================
{
  const twelve = Array.from({ length: 12 }, (_, i) => m(`r${i + 1}`, ["A", "B", "C"][i % 3]));
  const scenario = {
    month: "2026-09",
    members: twelve,
    rooms: ROOMS,
    changes: twelve.map((x, i) => ({ memberId: x.id, date: "2026-09-01", status: (["FULL", "HALF_DAY", "HALF_NIGHT", "OFF"] as const)[i % 4], sehri: false })),
    guestMeals: [{ memberId: "r1", date: "2026-09-10", type: "GUEST_FULL" as const, count: 3 }],
    extras: [{ id: "x", date: "2026-09-10", label: "odd", amount: 6301, category: "ONE_OFF" as const, showInDailyBudget: false, voided: false }],
    bills: [
      { month: "2026-09", type: "ELECTRICITY" as const, amount: 600_000 },
      { month: "2026-09", type: "WIFI" as const, amount: 15_000 },
    ],
    rateCards: [CARD],
  };
  const app = computeMonth({ ...scenario, today: "2026-09-30", finalize: true });
  const ref = refComputeMonth(
    {
      month: scenario.month,
      members: scenario.members,
      rooms: scenario.rooms as RefRoom[],
      changes: scenario.changes,
      guests: scenario.guestMeals,
      extras: scenario.extras,
      bills: scenario.bills,
      cards: [{ id: "c", effectiveFrom: "2026-01-01", effectiveTo: null, full: BigInt(60), half: BigInt(35), guestFull: BigInt(75), guestHalf: BigInt(40), sehri: BigInt(70), khalaNormal: BigInt(300), khalaSolo: BigInt(400), managerDailyFee: BigInt(30), dailyExtra: BigInt(300) }],
    },
    { today: "2026-09-30", cutoff: "2026-09-30", finalize: true, guestDeductionApplies: false },
  );
  check("meals agree exactly", app.totals.mealAmount, Number(ref.mealCostTotal));
  check("electricity total agrees", app.totals.electricityAmount, Number(ref.electricityPool));
  check("wifi total agrees", app.totals.wifiAmount, Number(ref.wifiPool));
  check(
    "utility total agrees",
    [...app.perMember.values()].reduce((t, r) => t + r.khalaElecWifiAmount, 0),
    Number(ref.utilityPoolCharged),
  );
  check("extras POOL total agrees", app.extraPool.total, Number(ref.extrasPoolTotal));
  const appShares = [...app.perMember.values()].reduce((t, r) => t + r.extraAmount, 0);
  const refShares = [...ref.perMember.values()].reduce((t, r) => t + r.extras, BigInt(0));
  // The one place the app and the reference disagree — documented, not hidden.
  check("extras SHARES differ by exactly the 1 taka the app loses", appShares, Number(refShares) - 1);
  check("total cost differs by the same 1 taka", app.totals.totalCost, Number(ref.totalCost) - 1);
  check(
    "and the two disagree on the day budget by exactly 5 per guest meal",
    (() => {
      const day = computeDayTotals({ date: "2026-09-10", members: scenario.members, changes: scenario.changes, guestMeals: scenario.guestMeals, extras: [], rateCard: CARD, today: "2026-09-30" });
      return day.guestDeductionAmount;
    })(),
    15,
  );
}

// ===========================================================================
console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  x ${f}`);
process.exit(failures.length > 0 ? 1 : 0);
