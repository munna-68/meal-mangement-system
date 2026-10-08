/**
 * Formula tests for the calculation engine. Run with `npm test`.
 *
 * These lock down the business rules from the spec — a wrong number here means
 * real money miscounted, so the expected values are written out by hand.
 */
import {
  apportionUtilities,
  buildSettlementRows,
  computeDayTotals,
  computeMonth,
  computeMonthlyFixedExtraSummary,
  computeRunningBalances,
  extraPoolForRange,
  resolveGuestTimeline,
  guestCountsOn,
  memberDayStates,
  isSoloInSharedRoom,
  khalaAmountFor,
  latestConfirmedDay,
  dayIsChargeable,
  mealChargeGate,
  apportionKhala,
  occupancyForRange,
  rateCardFor,
  resolveStatusTimeline,
  mealRegisterForMonth,
  roomBreakdownForDay,
  unconfirmedChargeableDays,
  type ExtraItemData,
  type MealChargeGate,
  type MemberData,
  type RateCardData,
  type RegisterSnapshot,
  type RoomData,
  type StatusChangeData,
  type GuestMealData,
  type UtilityBillData,
  type KhalaPaymentData,
  type DepositData,
  type DeductionData,
} from "../src/lib/calc";
import {
  autoExtraRowsFor,
  pendingAutoExtraRows,
} from "../src/lib/auto-extras";
import {
  closedMonthFor,
  closedMonthSet,
  historyLoss,
  isMonthClosed,
  laterClosedMonthsFor,
  monthsWithActivity,
  openingBalancesFor,
  requiredPrecedingClose,
} from "../src/lib/locks";
import {
  assertStrongPassword,
  isWeakPassword,
  passwordProblem,
} from "../src/lib/password-policy";
import { buildDutyUnits, orderUnitsFrom } from "../src/lib/roster";
import {
  parseRoomTypeValue,
  roomTypeLabel,
  roomTypeValue,
  ROOM_TYPES,
} from "../src/lib/room-type";
import {
  parseAmountCell,
  parseCsvImport,
  parseCsvRecords,
  parseDateCell,
  resolveMember,
} from "../src/lib/import-csv";
import { firstIssue, takaAmount } from "../src/lib/action-result";
import { isValidDateKey, isValidMonthKey } from "../src/lib/dates";

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed += 1;
  } else {
    failures.push(`${name}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RATE_CARD: RateCardData = {
  id: "rc1",
  effectiveFrom: "2025-01-01",
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

function member(
  id: string,
  roomId: string,
  overrides: Partial<MemberData> = {},
): MemberData {
  return {
    id,
    name: id.toUpperCase(),
    roomId,
    active: true,
    joinDate: "2025-03-01",
    leaveDate: null,
    ...overrides,
  };
}

const MEMBERS: MemberData[] = [
  member("m1", "A"),
  member("m2", "A"),
  member("m3", "B"), // alone in a 2-capacity room
  member("m4", "C"), // 1-capacity room
];

const FULL_FROM_MARCH_1: StatusChangeData[] = MEMBERS.map((m) => ({
  memberId: m.id,
  date: "2025-03-01",
  status: "FULL" as const,
  sehri: false,
}));

const BILLS: UtilityBillData[] = [
  { month: "2025-03", type: "ELECTRICITY", amount: 1000 },
  { month: "2025-03", type: "WIFI", amount: 500 },
];

/**
 * March's khala paid in full on the 10th: m1 300 + m2 300 + m3 400 (alone in a
 * 2-bed room) + m4 300 = 1300. Tests that assert khala charges pass this; tests
 * about the instalment mechanics pass their own figures.
 */
const MARCH_KHALA: KhalaPaymentData[] = [{ date: "2025-03-10", amount: 1300 }];

const MARCH_EXTRAS: ExtraItemData[] = [
  {
    id: "x1",
    date: "2025-03-05",
    label: "Meeting cost",
    amount: 1000,
    category: "ONE_OFF",
    showInDailyBudget: false,
    voided: false,
  },
  {
    id: "x2",
    date: "2025-03-10",
    label: "Daily extra",
    amount: 500,
    category: "RECURRING_DAILY",
    showInDailyBudget: true,
    voided: false,
  },
];

// ---------------------------------------------------------------------------
// Rate card resolution
// ---------------------------------------------------------------------------

section("Rate card resolution");
{
  const cards: RateCardData[] = [
    { ...RATE_CARD, id: "old", effectiveFrom: "2025-01-01", fullMealRate: 50 },
    { ...RATE_CARD, id: "new", effectiveFrom: "2025-03-01", fullMealRate: 60 },
  ];
  check("before any card falls back to earliest", rateCardFor(cards, "2024-12-01")?.id, "old");
  check("day before change uses old card", rateCardFor(cards, "2025-02-28")?.fullMealRate, 50);
  check("change day uses new card", rateCardFor(cards, "2025-03-01")?.fullMealRate, 60);
  check("after change uses new card", rateCardFor(cards, "2025-06-15")?.fullMealRate, 60);
}

// ---------------------------------------------------------------------------
// Sticky status
// ---------------------------------------------------------------------------

section("Sticky meal status");
{
  const changes: StatusChangeData[] = [
    { memberId: "m1", date: "2025-03-05", status: "FULL", sehri: false },
    { memberId: "m1", date: "2025-03-10", status: "OFF", sehri: false },
  ];
  const timeline = resolveStatusTimeline(
    changes,
    ["m1"],
    "2025-03-01",
    "2025-03-12",
  );
  const perDay = timeline.get("m1")!;
  check("before first change is OFF", perDay.get("2025-03-04")?.status, "OFF");
  check("change day applies", perDay.get("2025-03-05")?.status, "FULL");
  check("status carries forward", perDay.get("2025-03-09")?.status, "FULL");
  check("next change applies", perDay.get("2025-03-10")?.status, "OFF");
  check("carries forward after change", perDay.get("2025-03-12")?.status, "OFF");
  check(
    "out-of-order entry still resolves (change dated earlier)",
    resolveStatusTimeline(
      [
        { memberId: "m1", date: "2025-03-08", status: "HALF_DAY", sehri: false },
        ...changes,
      ],
      ["m1"],
      "2025-03-08",
      "2025-03-09",
    )
      .get("m1")!
      .get("2025-03-08")?.status,
    "HALF_DAY",
  );
}

// ---------------------------------------------------------------------------
// Daily budget
// ---------------------------------------------------------------------------

section("Daily budget");
{
  const changes: StatusChangeData[] = [
    { memberId: "m1", date: "2025-03-01", status: "FULL", sehri: false },
    { memberId: "m2", date: "2025-03-01", status: "HALF_DAY", sehri: false },
    { memberId: "m3", date: "2025-03-01", status: "HALF_NIGHT", sehri: false },
    { memberId: "m4", date: "2025-03-01", status: "OFF", sehri: false },
  ];
  const guests: GuestMealData[] = [
    { memberId: "m4", date: "2025-03-05", type: "GUEST_FULL", count: 2 },
  ];
  const extras: ExtraItemData[] = [
    {
      id: "e1",
      date: "2025-03-05",
      label: "Daily Extra",
      amount: 300,
      category: "RECURRING_DAILY",
      showInDailyBudget: true,
      voided: false,
    },
    {
      id: "e2",
      date: "2025-03-05",
      label: "Manager Fee",
      amount: 30,
      category: "MANAGER_FEE",
      showInDailyBudget: true,
      voided: false,
    },
    {
      id: "e3",
      date: "2025-03-05",
      label: "Month-only item",
      amount: 500,
      category: "ONE_OFF",
      showInDailyBudget: false,
      voided: false,
    },
  ];

  const totals = computeDayTotals({
    date: "2025-03-05",
    members: MEMBERS,
    changes,
    guestMeals: guests,
    extras,
    rateCard: RATE_CARD,
    deductionAmount: 20,
    today: "2025-03-31",
  });

  check("full count", totals.fullCount, 1);
  check("half count (both half flavours)", totals.halfCount, 2);
  check("full amount 1x60", totals.fullAmount, 60);
  check("half amount 2x35", totals.halfAmount, 70);
  check("guest full count", totals.guestFullCount, 2);
  check("guest full amount 2x75", totals.guestFullAmount, 150);
  check("guest half amount", totals.guestHalfAmount, 0);
  check("guest deduction 2x5", totals.guestDeductionAmount, 10);
  check("only budget-flagged extras count (excluding manager fee)", totals.extraAmount, 300);
  check("manager fee held back from bazar cash", totals.managerFeeAmount, 30);
  check(
    "guest meal does not change host status (m4 still OFF)",
    totals.fullCount,
    1,
  );
  check("total = meals(270) + extra(300) - managerFee(30) - deduction(20)", totals.totalBudget, 520);

  const workedGuests: GuestMealData[] = [
    { memberId: "m1", date: "2025-03-05", type: "GUEST_FULL", count: 2 },
    { memberId: "m1", date: "2025-03-05", type: "GUEST_HALF", count: 1 },
  ];
  const workedTotals = computeDayTotals({
    date: "2025-03-05",
    members: MEMBERS,
    changes: [],
    guestMeals: workedGuests,
    extras: [],
    rateCard: RATE_CARD,
    deductionAmount: 0,
    today: "2025-03-31",
  });
  check("worked guest full count", workedTotals.guestFullCount, 2);
  check("worked guest half count", workedTotals.guestHalfCount, 1);
  check("worked guest full amount (2x75)", workedTotals.guestFullAmount, 150);
  check("worked guest half amount (1x40)", workedTotals.guestHalfAmount, 40);
  check("worked guest deduction ((2+1)x5)", workedTotals.guestDeductionAmount, 15);
  check("worked meals subtotal (150+40-15)", workedTotals.mealsSubtotal, 175);
  check("worked total budget (meals 175 - managerFee 30)", workedTotals.totalBudget, 145);

  // A day that costs less than the manager's fee must not produce a negative
  // budget: the fee is capped at what the day actually cost.
  const cheapDay = computeDayTotals({
    date: "2025-03-06",
    members: MEMBERS,
    changes: [{ memberId: "m1", date: "2025-03-06", status: "HALF_DAY", sehri: false }],
    guestMeals: [],
    extras: [],
    rateCard: { ...RATE_CARD, halfMealRate: 60, managerDailyFee: 30 },
    today: "2025-03-31",
  });
  check("an ordinary day carries the manager's full fee", cheapDay.managerFeeAmount, 30);
  check("an ordinary day's budget is meals - fee", cheapDay.totalBudget, 30);

  const poorerDay = computeDayTotals({
    date: "2025-03-06",
    members: MEMBERS,
    changes: [{ memberId: "m1", date: "2025-03-06", status: "HALF_DAY", sehri: false }],
    guestMeals: [],
    extras: [],
    rateCard: { ...RATE_CARD, halfMealRate: 5, managerDailyFee: 30 },
    today: "2025-03-31",
  });
  check("the fee is capped at the day's cost", poorerDay.managerFeeAmount, 5);
  check("the budget never goes negative", poorerDay.totalBudget, 0);

  const voidedExtras = extras.map((e) =>
    e.id === "e1" ? { ...e, voided: true } : e,
  );
  check(
    "voided extra is excluded and manager fee is excluded from extras",
    computeDayTotals({
      date: "2025-03-05",
      members: MEMBERS,
      changes,
      guestMeals: guests,
      extras: voidedExtras,
      rateCard: RATE_CARD,
      today: "2025-03-31",
    }).extraAmount,
    0,
  );

  check(
    "inactive member does not accrue",
    computeDayTotals({
      date: "2025-03-05",
      members: [member("m1", "A", { active: false, leaveDate: "2025-03-02" })],
      changes,
      guestMeals: [],
      extras: [],
      rateCard: RATE_CARD,
      today: "2025-03-31",
    }).fullCount,
    0,
  );

  check(
    "member joining later does not accrue before join date",
    computeDayTotals({
      date: "2025-03-05",
      members: [member("m1", "A", { joinDate: "2025-03-10" })],
      changes,
      guestMeals: [],
      extras: [],
      rateCard: RATE_CARD,
      today: "2025-03-31",
    }).fullCount,
    0,
  );
}

// ---------------------------------------------------------------------------
// Electricity + wifi apportionment
// ---------------------------------------------------------------------------

section("Electricity + wifi apportionment (even per head, solo multiples)");
{
  // Bills: electricity 1000, wifi 500. Four active members.
  //   m1, m2 share a 2-bed room, m3 is alone in a 2-bed room, m4 is in a 1-bed room.
  const apportionment = apportionUtilities({
    members: MEMBERS,
    rooms: ROOMS,
    bills: BILLS,
    from: "2025-03-01",
    to: "2025-03-31",
    today: "2025-03-31",
  });

  check("member count is the divisor", apportionment.memberCount, 4);
  check("per-head electricity = 1000/5 weight", apportionment.perHeadElectricity, 200);
  check("per-head wifi = 500/4", apportionment.perHeadWifi, 125);
  check("exactly one solo member", apportionment.soloCount, 1);

  check("sharing a 2-bed room pays the base share", apportionment.byMember.get("m1"), {
    electricity: 200,
    wifi: 125,
    total: 325,
  });
  check("roommate pays the same base share", apportionment.byMember.get("m2"), {
    electricity: 200,
    wifi: 125,
    total: 325,
  });
  check(
    "alone in a 2-bed room: electricity doubled, wifi NOT doubled",
    apportionment.byMember.get("m3"),
    { electricity: 400, wifi: 125, total: 525 },
  );
  check("a 1-bed room pays the base share", apportionment.byMember.get("m4"), {
    electricity: 200,
    wifi: 125,
    total: 325,
  });

  // Apportionment sums to the bill total exactly (no overcharging).
  const collected = [...apportionment.byMember.values()].reduce(
    (t, s) => t + s.total,
    0,
  );
  const billTotal =
    apportionment.totalElectricity + apportionment.totalWifi;
  check("collected equals bill total", collected, billTotal);

  // The multiples are configurable, because the mess does not always treat both
  // bills the same way.
  const wifiDoubled = apportionUtilities({
    members: MEMBERS,
    rooms: ROOMS,
    bills: BILLS,
    from: "2025-03-01",
    to: "2025-03-31",
    soloElectricityMultiplier: 2,
    soloWifiMultiplier: 2,
    today: "2025-03-31",
  });
  check("wifi can be doubled too", wifiDoubled.byMember.get("m3"), {
    electricity: 400,
    wifi: 200,
    total: 600,
  });

  const noPremium = apportionUtilities({
    members: MEMBERS,
    rooms: ROOMS,
    bills: BILLS,
    from: "2025-03-01",
    to: "2025-03-31",
    soloElectricityMultiplier: 1,
    soloWifiMultiplier: 1,
    today: "2025-03-31",
  });
  check("setting both to 1 charges everyone the same", noPremium.byMember.get("m3"), {
    electricity: 250,
    wifi: 125,
    total: 375,
  });
  const evenCollected = [...noPremium.byMember.values()].reduce(
    (t, s) => t + s.total,
    0,
  );
  check("with no premium the shares add up to the bill", evenCollected, billTotal);
}

// ---------------------------------------------------------------------------
// Khala
// ---------------------------------------------------------------------------

section("Khala fee");
{
  const occupancy = occupancyForRange({
    members: MEMBERS,
    rooms: ROOMS,
    from: "2025-03-01",
    to: "2025-03-31",
    today: "2025-03-31",
  });
  check(
    "sharing a room pays the normal rate",
    khalaAmountFor({ member: MEMBERS[0], occupancy, rateCard: RATE_CARD }),
    300,
  );
  check(
    "alone in a 2-cap room pays the flat solo rate (not double)",
    khalaAmountFor({ member: MEMBERS[2], occupancy, rateCard: RATE_CARD }),
    400,
  );
  check(
    "1-cap room always pays the normal rate",
    khalaAmountFor({ member: MEMBERS[3], occupancy, rateCard: RATE_CARD }),
    300,
  );

  // `khalaAmountFor` is the rate card's intent: it sets the ceiling and the split
  // weights. What a member is actually charged is the share of khala that has
  // genuinely been paid, apportioned on those weights.
  const base = {
    members: MEMBERS,
    rooms: ROOMS,
    from: "2025-03-01" as const,
    to: "2025-03-31" as const,
    rateCard: RATE_CARD,
    today: "2025-03-31" as const,
  };

  const nothingPaid = apportionKhala({ ...base, payments: [] });
  check("a month with no payments charges no khala at all", nothingPaid.totalPaid, 0);
  check(
    "no payments means nobody carries khala",
    [...nothingPaid.byMember.values()].every((amount) => amount === 0),
    true,
  );
  check("the target is still the rate card's 1300", nothingPaid.monthlyTarget, 1300);
  check("all 1300 is outstanding", nothingPaid.outstanding, 1300);
  check("a month with nothing paid is not fully paid", nothingPaid.fullyPaid, false);

  const fullyPaid = apportionKhala({ ...base, payments: MARCH_KHALA });
  check("a fully paid month charges the full 1300", fullyPaid.totalPaid, 1300);
  check("nothing outstanding once paid in full", fullyPaid.outstanding, 0);
  check("a fully paid month is marked paid", fullyPaid.fullyPaid, true);
  check("shared member carries the normal rate", fullyPaid.byMember.get("m1"), 300);
  check("solo member carries the solo rate", fullyPaid.byMember.get("m3"), 400);
  check(
    "shares add back up to the amount paid exactly",
    [...fullyPaid.byMember.values()].reduce((a, b) => a + b, 0),
    1300,
  );

  // The whole point: khala arrives in pieces, and nobody is charged for the piece
  // that has not been handed over yet.
  const partial = apportionKhala({
    ...base,
    payments: [
      { date: "2025-03-05", amount: 500 },
      { date: "2025-03-20", amount: 300 },
    ],
  });
  check("two instalments sum to what was paid", partial.totalPaid, 800);
  check("the unpaid remainder is outstanding", partial.outstanding, 500);
  check("still not fully paid mid-month", partial.fullyPaid, false);
  // 800 paid of a 1300 target: a shared member carries 300/1300 of it, a solo
  // member 400/1300 — the same proportions the rate card sets, of the smaller sum.
  check(
    "a shared member carries their proportion of what was paid",
    partial.byMember.get("m1"),
    185,
  );
  check(
    "a solo member carries the solo proportion of what was paid",
    partial.byMember.get("m3"),
    246,
  );
  check(
    "a partly paid month apportions exactly what was paid",
    [...partial.byMember.values()].reduce((a, b) => a + b, 0),
    800,
  );

  // Instalments landing in different months belong to different months, so last
  // month's khala never leaks into this month's cost.
  const marchOnly = apportionKhala({
    ...base,
    payments: [
      ...MARCH_KHALA,
      { date: "2025-04-02", amount: 9999 },
    ],
  });
  check("a payment dated next month is ignored", marchOnly.totalPaid, 1300);

  // Overpayment is refused at the action layer, but the apportionment still has
  // to behave: nothing outstanding, and the whole amount shared out.
  const overpaid = apportionKhala({ ...base, payments: [{ date: "2025-03-05", amount: 2000 }] });
  check("overpaying never leaves a negative outstanding", overpaid.outstanding, 0);
  check("overpaid counts as fully paid", overpaid.fullyPaid, true);
  check(
    "an overpaid month still shares out exactly what was paid",
    [...overpaid.byMember.values()].reduce((a, b) => a + b, 0),
    2000,
  );

  // No rate card means no ceiling, so nothing can be charged and nothing logged.
  const noCard = apportionKhala({ ...base, rateCard: null, payments: MARCH_KHALA });
  check("no rate card means no khala target", noCard.monthlyTarget, 0);
  check(
    "no rate card means nobody carries khala",
    [...noCard.byMember.values()].every((amount) => amount === 0),
    true,
  );
}

// ---------------------------------------------------------------------------
// Extra pool
// ---------------------------------------------------------------------------

section("Extra pool");
{
  const pool = extraPoolForRange({
    extras: MARCH_EXTRAS,
    from: "2025-03-01",
    to: "2025-03-31",
    activeMemberIds: ["m1", "m2", "m3", "m4"],
  });
  check("pool sums every item regardless of daily-budget flag", pool.total, 1500);
  check("split evenly across members", pool.perMember, 375);

  const withVoided = extraPoolForRange({
    extras: [...MARCH_EXTRAS, {
      id: "x3",
      date: "2025-03-12",
      label: "Voided",
      amount: 9999,
      category: "OTHER",
      showInDailyBudget: false,
      voided: true,
    }],
    from: "2025-03-01",
    to: "2025-03-31",
    activeMemberIds: ["m1", "m2", "m3", "m4"],
  });
  check("voided items are excluded from the pool", withVoided.total, 1500);

  // The remainder is handed out, not rounded away: the shares always add back up
  // to the pool, whatever the pool and however many members there are.
  const awkward = extraPoolForRange({
    extras: [
      {
        id: "odd",
        date: "2025-03-10",
        label: "awkward",
        amount: 6301,
        category: "ONE_OFF",
        showInDailyBudget: false,
        voided: false,
      },
    ],
    from: "2025-03-01",
    to: "2025-03-31",
    activeMemberIds: Array.from({ length: 12 }, (_, i) => `e${i + 1}`),
  });
  check("an awkward pool is still the exact total", awkward.total, 6301);
  check(
    "the shares add back up to the pool to the taka",
    [...awkward.shares.values()].reduce((a, b) => a + b, 0),
    6301,
  );
  check(
    "shares differ by at most one taka",
    Math.max(...awkward.shares.values()) - Math.min(...awkward.shares.values()),
    1,
  );
  check("11 members carry 525 and one carries 526", [...awkward.shares.values()].sort((a, b) => a - b).slice(-1), [526]);

  const tiny = extraPoolForRange({
    extras: [{ ...MARCH_EXTRAS[0], id: "t", amount: 1 }],
    from: "2025-03-01",
    to: "2025-03-31",
    activeMemberIds: Array.from({ length: 12 }, (_, i) => `e${i + 1}`),
  });
  check(
    "a single taka is given to one member rather than lost",
    [...tiny.shares.values()].reduce((a, b) => a + b, 0),
    1,
  );

  const eightWay = extraPoolForRange({
    extras: [{ ...MARCH_EXTRAS[0], id: "f", amount: 5 }],
    from: "2025-03-01",
    to: "2025-03-31",
    activeMemberIds: Array.from({ length: 8 }, (_, i) => `e${i + 1}`),
  });
  check(
    "a 5 taka pool over 8 members is not inflated to 8",
    [...eightWay.shares.values()].reduce((a, b) => a + b, 0),
    5,
  );

  const nobody = extraPoolForRange({
    extras: MARCH_EXTRAS,
    from: "2025-03-01",
    to: "2025-03-31",
    activeMemberIds: [],
  });
  check("a month with nobody in it charges nobody", nobody.memberCount, 0);
  check("…and the pool total is still reported", nobody.total, 1500);

  // Fixed daily extra summary (user spec: 28 days @ ৳300 = ৳8,400 ÷ 30 members = ৳280/head)
  const fixedSummary = computeMonthlyFixedExtraSummary({
    month: "2026-09",
    confirmedBazarDaysCount: 28,
    rateCard: { ...RATE_CARD, dailyExtraAmount: 300, managerDailyFee: 0 },
    activeMemberCount: 30,
  });
  check("fixed extra summary reports correct total days in month", fixedSummary.totalDaysInMonth, 30);
  check("fixed extra summary reports 28 meal days ran", fixedSummary.mealDaysRan, 28);
  check("fixed extra summary reports 300 daily rate", fixedSummary.dailyRate, 300);
  check("fixed extra summary total is 28 * 300 = 8400", fixedSummary.totalDailyExtra, 8400);
  check("fixed extra summary boarder count is 30", fixedSummary.boarderCount, 30);
  check("fixed extra summary cost per head is 8400 / 30 = 280", fixedSummary.perBoarderCost, 280);

  // Manager fee is excluded from per-boarder cost
  const withManagerFee = computeMonthlyFixedExtraSummary({
    month: "2026-09",
    confirmedBazarDaysCount: 28,
    rateCard: { ...RATE_CARD, dailyExtraAmount: 300, managerDailyFee: 30 },
    activeMemberCount: 30,
  });
  check("fixed extra summary manager fee total is 0 (not charged to boarders)", withManagerFee.totalManagerFee, 0);
  check("fixed extra summary per boarder manager fee is 0", withManagerFee.perBoarderManagerFee, 0);
  check("fixed extra summary combined per boarder is only daily extra = 280", withManagerFee.combinedPerBoarder, 280);

  // Edge cases: 0 boarders and 0 meal days
  const zeroBoarders = computeMonthlyFixedExtraSummary({
    month: "2026-09",
    confirmedBazarDaysCount: 28,
    rateCard: { ...RATE_CARD, dailyExtraAmount: 300, managerDailyFee: 30 },
    activeMemberCount: 0,
  });
  check("fixed extra summary safely handles 0 boarders", zeroBoarders.perBoarderCost, 0);

  const zeroDays = computeMonthlyFixedExtraSummary({
    month: "2026-09",
    confirmedBazarDaysCount: 0,
    rateCard: { ...RATE_CARD, dailyExtraAmount: 300, managerDailyFee: 30 },
    activeMemberCount: 30,
  });
  check("fixed extra summary safely handles 0 meal days", zeroDays.totalDailyExtra, 0);
  check("fixed extra summary safely handles 0 meal days per head", zeroDays.perBoarderCost, 0);
}

// ---------------------------------------------------------------------------
// Whole month
// ---------------------------------------------------------------------------

section("Monthly computation");
{
  const computation = computeMonth({
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: MARCH_EXTRAS,
    bills: BILLS,
    khalaPayments: MARCH_KHALA,
    rateCards: [RATE_CARD],
    today: "2025-03-31",
  });

  const m1 = computation.perMember.get("m1")!;
  const m3 = computation.perMember.get("m3")!;

  check("31 full meals counted", m1.fullMealCount, 31);
  check("meal amount = 31 x 60", m1.mealAmount, 1860);
  check("khala is flat for the month, not per day", m1.khalaAmount, 300);
  check("khala + wifi + electricity = 300 + 325", m1.khalaElecWifiAmount, 625);
  check("extra is the same for everyone", m1.extraAmount, 375);
  check("total cost m1 = 1860+625+375", m1.totalCost, 2860);
  check("solo member pays 400 khala + 525 utilities", m3.khalaElecWifiAmount, 925);
  check("total cost m3 = 1860+925+375", m3.totalCost, 3160);
  check("everyone gets an identical extra", [
    ...computation.perMember.values(),
  ].every((r) => r.extraAmount === 375), true);
  check("4 active members", computation.activeMemberIds.length, 4);
}

// ---------------------------------------------------------------------------
// Taking money out
// ---------------------------------------------------------------------------

section("Taking money out (deductions)");
{
  const computation = computeMonth({
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: MARCH_EXTRAS,
    bills: BILLS,
    khalaPayments: MARCH_KHALA,
    rateCards: [RATE_CARD],
    today: "2025-03-31",
  });

  const deposits: DepositData[] = [
    { memberId: "m1", date: "2025-03-02", amount: 5000 },
  ];

  const settle = (deductions: DeductionData[], opening = new Map<string, number>()) =>
    buildSettlementRows({
      computation,
      members: MEMBERS,
      rooms: ROOMS,
      deposits,
      deductions,
      openingBalances: opening,
    });

  // The headline case: a member holding 1,000 has 100 taken out and is left 900.
  {
    const rows = settle([], new Map([["m1", 1000]]));
    const before = rows.find((r) => r.memberId === "m1")!;
    check("before: m1 is 1,000 + 5,000 − 2,860", before.closingBalance, 3140);

    const after = settle(
      [{ memberId: "m1", date: "2025-03-20", amount: 100 }],
      new Map([["m1", 1000]]),
    ).find((r) => r.memberId === "m1")!;
    check("taking out 100 leaves 900 of the 1,000 opening", after.openingBalance + after.newDeposits - after.totalCost - 100, after.closingBalance);
    check("balance = opening + deposits − cost − deductions", after.closingBalance, 1000 + 5000 - 2860 - 100);
    check("the deduction did not touch the deposits column", after.newDeposits, 5000);
    check("the deduction did not touch the cost column", after.totalCost, before.totalCost);
  }

  // An isolated 1,000 balance with nothing owed: 1,000 − 100 = 900 exactly.
  // A zeroed rate card is what makes the cost zero, so the balance in hand is
  // precisely the opening figure and nothing else muddies it.
  {
    const FREE: RateCardData = {
      ...RATE_CARD,
      fullMealRate: 0,
      halfMealRate: 0,
      guestFullRate: 0,
      guestHalfRate: 0,
      sehriRate: 0,
      feastFlatCharge: 0,
      khalaNormalRate: 0,
      khalaSoloRate: 0,
      managerDailyFee: 0,
      dailyExtraAmount: 0,
    };
    const free = computeMonth({
      month: "2025-03",
      members: MEMBERS,
      rooms: ROOMS,
      changes: FULL_FROM_MARCH_1,
      guestMeals: [],
      extras: [],
      bills: [],
      khalaPayments: [],
      rateCards: [FREE],
      today: "2025-03-31",
    });
    const held = buildSettlementRows({
      computation: free,
      members: MEMBERS,
      rooms: ROOMS,
      deposits: [],
      deductions: [{ memberId: "m1", date: "2025-03-20", amount: 100 }],
      openingBalances: new Map([["m1", 1000]]),
    }).find((r) => r.memberId === "m1")!;
    check("the member really is owed nothing first", held.totalCost, 0);
    check("1,000 in hand, 100 taken out, is exactly 900", held.closingBalance, 900);
  }

  // Taking out the whole balance lands on exactly zero, not below it.
  {
    const rows = settle(
      [{ memberId: "m1", date: "2025-03-20", amount: 3140 }],
      new Map([["m1", 1000]]),
    );
    check("taking out the whole balance lands on zero, not below", rows.find((r) => r.memberId === "m1")!.closingBalance, 0);
  }

  // Omitting the input entirely must match passing an empty list, so every
  // caller written before deductions existed keeps its old behaviour.
  check(
    "omitting deductions matches passing an empty list",
    settle([]),
    buildSettlementRows({
      computation,
      members: MEMBERS,
      rooms: ROOMS,
      deposits,
      openingBalances: new Map(),
    }),
  );

  // Dated rows accumulate; they are not last-write-wins.
  {
    const rows = settle([
      { memberId: "m1", date: "2025-03-10", amount: 300 },
      { memberId: "m1", date: "2025-03-11", amount: 700 },
    ]);
    check("two deductions on consecutive days both count", 5000 - 2860 - 1000, rows.find((r) => r.memberId === "m1")!.closingBalance);
  }

  // A member's deduction must not touch anybody else.
  {
    const withM1 = settle([{ memberId: "m1", date: "2025-03-20", amount: 500 }]);
    const plain = settle([]);
    check("m1 is 500 lower", plain.find((r) => r.memberId === "m1")!.closingBalance - withM1.find((r) => r.memberId === "m1")!.closingBalance, 500);
    check("m2 is untouched", withM1.find((r) => r.memberId === "m2")!.closingBalance, plain.find((r) => r.memberId === "m2")!.closingBalance);
  }

  // Dated outside the month it must not appear at all.
  {
    const rows = settle([
      { memberId: "m1", date: "2025-04-01", amount: 5000 },
      { memberId: "m1", date: "2025-02-28", amount: 5000 },
    ]);
    check("a deduction outside the month is excluded", rows.find((r) => r.memberId === "m1")!.closingBalance, 5000 - 2860);
  }

  // Carrying a post-deduction closing balance forward is what the next month
  // opens on, so the reduction must not be quietly undone.
  {
    const withDeduction = settle([{ memberId: "m1", date: "2025-03-20", amount: 600 }]);
    const carried = buildSettlementRows({
      computation,
      members: MEMBERS,
      rooms: ROOMS,
      deposits: [],
      deductions: [],
      openingBalances: new Map(withDeduction.map((r) => [r.memberId, r.closingBalance])),
    });
    check("the next month opens on the post-deduction balance", carried.find((r) => r.memberId === "m1")!.openingBalance, 5000 - 2860 - 600);
  }

  // The running balance used by the Balances page must agree.
  {
    const result = computeRunningBalances({
      members: MEMBERS,
      rooms: ROOMS,
      changes: FULL_FROM_MARCH_1,
      guestMeals: [],
      extras: MARCH_EXTRAS,
      bills: BILLS,
      khalaPayments: MARCH_KHALA,
      rateCards: [RATE_CARD],
      deposits,
      deductions: [{ memberId: "m1", date: "2025-03-20", amount: 250 }],
      settlements: [],
      openingBalances: [],
      lastClosedMonth: null,
      today: "2025-03-31",
    });
    const m1 = result.rows.find((r) => r.memberId === "m1")!;
    check("running balance subtracts the deduction", m1.balance, 5000 - 2860 - 250);
    check("running balance reports the deduction figure", m1.deductions, 250);
    check("summary deductions total the rows", result.summary.deductions, 250);
    check(
      "summary balance = deposits − cost − deductions",
      result.summary.balance,
      result.summary.deposits - result.summary.cost - result.summary.deductions,
    );
  }

  // Two deductions in a row must compound, not replace each other: 1,000 − 100
  // = 900, then a further 100 leaves 800.
  {
    const first = settle([{ memberId: "m1", date: "2025-03-20", amount: 100 }]);
    const second = settle([
      { memberId: "m1", date: "2025-03-20", amount: 100 },
      { memberId: "m1", date: "2025-03-21", amount: 100 },
    ]);
    check(
      "a second 100 comes off the already-reduced balance",
      first.find((r) => r.memberId === "m1")!.closingBalance - second.find((r) => r.memberId === "m1")!.closingBalance,
      100,
    );
  }
}

// ---------------------------------------------------------------------------
// Settlement + carry-forward
// ---------------------------------------------------------------------------

section("Settlement rows and balance carry-forward");
{
  const computation = computeMonth({
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: MARCH_EXTRAS,
    bills: BILLS,
    khalaPayments: MARCH_KHALA,
    rateCards: [RATE_CARD],
    today: "2025-03-31",
  });

  const deposits: DepositData[] = [
    { memberId: "m1", date: "2025-03-02", amount: 5000 },
    { memberId: "m3", date: "2025-03-02", amount: 1000 },
    { memberId: "m3", date: "2025-04-01", amount: 900 },
  ];

  const rows = buildSettlementRows({
    computation,
    members: MEMBERS,
    rooms: ROOMS,
    deposits,
    openingBalances: new Map(),
  });

  const m1 = rows.find((r) => r.memberId === "m1")!;
  const m3 = rows.find((r) => r.memberId === "m3")!;
  const m2 = rows.find((r) => r.memberId === "m2")!;

  check("m1 opening balance is 0", m1.openingBalance, 0);
  check("m1 new deposits", m1.newDeposits, 5000);
  check("m1 closing = 5000 - 2860", m1.closingBalance, 2140);
  check("deposit after the month is excluded", m3.newDeposits, 1000);
  check("m3 closing = 1000 - 3160 (negative)", m3.closingBalance, -2160);
  check("m2 closing = 0 - 2860", m2.closingBalance, -2860);

  const nextMonth = buildSettlementRows({
    computation,
    members: MEMBERS,
    rooms: ROOMS,
    deposits,
    openingBalances: new Map(rows.map((r) => [r.memberId, r.closingBalance])),
  });
  check(
    "closing balance becomes next month's opening",
    nextMonth.find((r) => r.memberId === "m1")!.openingBalance,
    2140,
  );
}

// ---------------------------------------------------------------------------
// Running balance
// ---------------------------------------------------------------------------

section("Running balance (month-to-date)");
{
  const deposits: DepositData[] = [
    { memberId: "m1", date: "2025-03-02", amount: 5000 },
  ];

  const result = computeRunningBalances({
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: MARCH_EXTRAS,
    bills: BILLS,
    khalaPayments: MARCH_KHALA,
    rateCards: [RATE_CARD],
    deposits,
    settlements: [],
    openingBalances: [],
    lastClosedMonth: null,
    today: "2025-03-20",
  });

  const m1 = result.rows.find((r) => r.memberId === "m1")!;
  const m2 = result.rows.find((r) => r.memberId === "m2")!;

  check("period starts at the open month", result.periodStart, "2025-03-01");
  // Meals accrue per day, the flat monthly charges do not.
  //   20 x 60 = 1200
  //   Khala 300, Elec 200 + wifi 125, Extra pool 375 (1500 ÷ 4)
  check("20 full meals to date", m1.cost, 1200 + 300 + 325 + 375);
  check("balance = 5000 - 2200", m1.balance, 5000 - (1200 + 300 + 325 + 375));
  check("member with no deposit is in deficit", m2.balance, -(1200 + 300 + 325 + 375));
  check("deficit count", result.summary.membersInDeficit, 3);
  // m3 is alone in a 2-bed room: Khala 400, electricity 400 (double weight),
  // wifi 125.
  const m3 = result.rows.find((r) => r.memberId === "m3")!;
  check("solo member's month-to-date cost", m3.cost, 1200 + 400 + 525 + 375);
  check(
    "mess-wide balance = 5000 - 2200 - 2200 - 2500 - 2200",
    result.summary.balance,
    5000 - 2200 - 2200 - 2500 - 2200,
  );
}

// ---------------------------------------------------------------------------
// Carry-forward across a closed month
// ---------------------------------------------------------------------------

section("Running balance after a closed month");
{
  const result = computeRunningBalances({
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: [],
    bills: [],
    khalaPayments: [{ date: "2025-04-02", amount: 1300 }],
    rateCards: [RATE_CARD],
    deposits: [],
    settlements: [
      { memberId: "m1", month: "2025-03", openingBalance: 0, closingBalance: 2165 },
      { memberId: "m2", month: "2025-03", openingBalance: 0, closingBalance: -2835 },
      { memberId: "m3", month: "2025-03", openingBalance: 0, closingBalance: -2235 },
      { memberId: "m4", month: "2025-03", openingBalance: 0, closingBalance: -2835 },
    ],
    openingBalances: [],
    lastClosedMonth: "2025-03",
    today: "2025-04-05",
  });

  const m1 = result.rows.find((r) => r.memberId === "m1")!;
  check("period resumes after the closed month", result.periodStart, "2025-04-01");
  check("opening balance comes from the closed month", m1.openingBalance, 2165);
  // Meal costs accrue day by day (5 x 60). Khala is the whole month's 300,
  // because the flat monthly charges are never pro-rated.
  check("5 April days at 60, plus the full month of Khala", m1.cost, 5 * 60 + 300);
  check("balance = 2165 - 600", m1.balance, 1565);
}

// ---------------------------------------------------------------------------
// Future days are never billed
// ---------------------------------------------------------------------------

section("In-progress month stops at today");
{
  const midMonth = computeMonth({
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: MARCH_EXTRAS,
    bills: BILLS,
    khalaPayments: MARCH_KHALA,
    rateCards: [RATE_CARD],
    today: "2025-03-20",
  });
  const m1 = midMonth.perMember.get("m1")!;
  check("only 20 of March's 31 days are billed", m1.fullMealCount, 20);
  check("meal amount stops at today", m1.mealAmount, 20 * 60);
  check("cutoff is clamped to today", midMonth.cutoff, "2025-03-20");

  const finished = computeMonth({
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: MARCH_EXTRAS,
    bills: BILLS,
    khalaPayments: MARCH_KHALA,
    rateCards: [RATE_CARD],
    today: "2025-04-15",
  });
  check(
    "a finished month still bills all 31 days",
    finished.perMember.get("m1")!.fullMealCount,
    31,
  );

  const depositLater = buildSettlementRows({
    computation: midMonth,
    members: MEMBERS,
    rooms: ROOMS,
    deposits: [{ memberId: "m1", date: "2025-03-25", amount: 900 }],
    openingBalances: new Map(),
  });
  check(
    "deposits dated after today are not counted yet",
    depositLater.find((r) => r.memberId === "m1")!.newDeposits,
    0,
  );
}

// ---------------------------------------------------------------------------
// রাত / দুপুর columns on the paper slip
// ---------------------------------------------------------------------------

section("Night and noon meal-times (paper slip columns)");
{
  // The paper form tracks the two meal-times separately: রাত (night) and
  // দুপুর (noon). A Full member eats both; each Half flavour eats exactly one.
  const totals = computeDayTotals({
    date: "2025-03-05",
    members: MEMBERS,
    changes: [
      { memberId: "m1", date: "2025-03-01", status: "FULL", sehri: false },
      { memberId: "m2", date: "2025-03-01", status: "HALF_DAY", sehri: false },
      { memberId: "m3", date: "2025-03-01", status: "HALF_NIGHT", sehri: false },
      { memberId: "m4", date: "2025-03-01", status: "OFF", sehri: false },
    ],
    guestMeals: [],
    extras: [],
    rateCard: RATE_CARD,
  });

  check("night = full + half-night", totals.nightCount, 2);
  check("noon = full + half-day", totals.noonCount, 2);
  check("the two columns add back to full + half", totals.nightCount + totals.noonCount, 4);
  check("an off member eats neither meal", totals.nightCount > totals.fullCount, true);

  const rooms = roomBreakdownForDay({
    date: "2025-03-05",
    members: MEMBERS,
    rooms: ROOMS,
    changes: [
      { memberId: "m1", date: "2025-03-01", status: "FULL", sehri: false },
      { memberId: "m2", date: "2025-03-01", status: "HALF_DAY", sehri: false },
      { memberId: "m3", date: "2025-03-01", status: "HALF_NIGHT", sehri: false },
      { memberId: "m4", date: "2025-03-01", status: "OFF", sehri: false },
    ],
    guestMeals: [{ memberId: "m1", date: "2025-03-05", type: "GUEST_FULL", count: 2 }],
  });

  const roomA = rooms.find((r) => r.roomNumber === "101")!;
  check("room A night (m1 full)", roomA.nightCount, 1);
  check("room A noon (m1 full + m2 half-day)", roomA.noonCount, 2);
  check("room A guest count", roomA.guestCount, 2);

  const roomB = rooms.find((r) => r.roomNumber === "102")!;
  check("room B night (m3 half-night)", roomB.nightCount, 1);
  check("room B noon", roomB.noonCount, 0);

  const roomC = rooms.find((r) => r.roomNumber === "205")!;
  check("room C is off all day", roomC.nightCount + roomC.noonCount, 0);
}

// ---------------------------------------------------------------------------
// Monthly meal register (F / D / N codes)
// ---------------------------------------------------------------------------

section("Monthly meal register");
{
  const changes: StatusChangeData[] = [
    { memberId: "m1", date: "2025-03-01", status: "FULL", sehri: false },
    { memberId: "m2", date: "2025-03-01", status: "HALF_DAY", sehri: false },
    { memberId: "m3", date: "2025-03-01", status: "HALF_NIGHT", sehri: false },
    // m4 never gets a status, and m5 joins mid-month.
  ];
  const members = [
    ...MEMBERS,
    member("m5", "B", { joinDate: "2025-03-10" }),
  ];

  const register = mealRegisterForMonth({
    month: "2025-03",
    members,
    rooms: ROOMS,
    changes,
    today: "2025-03-31",
  });

  check("one column per day of the month", register.days.length, 31);
  check("one row per member active that month", register.rows.length, 5);

  const byId = (id: string) => register.rows.find((r) => r.memberId === id)!;

  // m1 is FULL all month: 31 full days, both codes counted.
  check("m1 full days", byId("m1").fullCount, 31);
  check("m1 half days", byId("m1").halfCount, 0);
  // m2 is HALF_DAY (D) and m3 is HALF_NIGHT (N) — both land in the half column.
  check("m2 half days (D)", byId("m2").halfCount, 31);
  check("m3 half days (N)", byId("m3").halfCount, 31);
  // m4 defaulted to OFF all month.
  check("m4 full days", byId("m4").fullCount, 0);
  check("m4 half days", byId("m4").halfCount, 0);
  // m5 joined on the 10th, so the first nine days are blank, not "off".
  const m5 = byId("m5");
  check("m5 blank before joining", m5.cells.slice(0, 9).every((c) => c.status === null), true);
  check("m5 counted from the join date", m5.cells[9].status, "OFF");
  check("m5 total days present", m5.cells.filter((c) => c.status !== null).length, 22);

  check(
    "rows are ordered by room number",
    register.rows.map((r) => r.roomNumber),
    ["101", "101", "102", "102", "205"],
  );

  // The whole point of the register is to cross-check the money. Its per-member
  // ফুল / হাফ totals must equal the settlement ledger's counts exactly.
  const computation = computeMonth({
    month: "2025-03",
    members,
    rooms: ROOMS,
    changes,
    guestMeals: [],
    extras: [],
    bills: [],
    rateCards: [RATE_CARD],
    today: "2025-03-31",
  });
  const mismatches = register.rows.filter((row) => {
    const cost = computation.perMember.get(row.memberId);
    if (!cost) return false;
    return (
      cost.fullMealCount !== row.fullCount || cost.halfMealCount !== row.halfCount
    );
  });
  check("register totals agree with the ledger", mismatches.length, 0);

  // A day that has not happened yet must never be coded.
  const midMonth = mealRegisterForMonth({
    month: "2025-03",
    members,
    rooms: ROOMS,
    changes,
    today: "2025-03-20",
  });
  check("days after today are not coded", midMonth.rows[0].cells.slice(20).every((c) => c.status === null), true);
  check("totals stop at today", byId("m1").fullCount > midMonth.rows.find((r) => r.memberId === "m1")!.fullCount, true);
}

// ---------------------------------------------------------------------------
// Register vs the charge gate
// ---------------------------------------------------------------------------

section("Register excludes days the gate cannot bill");
{
  const members = [member("m1", "A", { joinDate: "2025-03-10" })];
  const changes: StatusChangeData[] = [
    { memberId: "m1", date: "2025-03-10", status: "FULL", sehri: false },
  ];
  const confirmed = new Set([
    "2025-03-10", "2025-03-11", "2025-03-12", "2025-03-13", "2025-03-14",
  ]);
  // The gate starts on the 12th, so the 10th and 11th are billed regardless —
  // before the start date every past day is charged as it always was.
  const gate = mealChargeGate({ mealChargeGateStarts: "2025-03-12" }, confirmed);
  const args = {
    month: "2025-03" as const,
    members,
    rooms: ROOMS,
    changes,
    today: "2025-03-15" as const,
    rateCards: [RATE_CARD],
    guestMeals: [],
    extras: [],
    bills: [],
  };

  const gated = mealRegisterForMonth({ ...args, gate });
  const g = gated.rows[0];

  // Six days elapsed (10th to 15th), but only 10th-14th are billable.
  // Cells are indexed by day of the month, so the 15th is index 14.
  // The status is deliberately still known — the meal happened — but the sheet
  // renders an unbilled day as blank, and the flag is what it keys off.
  check("unconfirmed days are left out of the totals", g.fullCount, 5);
  check("the unbilled day's status is still known", g.cells[14].status, "FULL");
  check("the unbilled day is flagged so the sheet can blank it", g.cells[14].billable, false);
  check("the days before the gate are still counted", g.cells[9].billable, true);
  check("a confirmed day is counted", g.cells[13].billable, true);

  // The point of the whole change: the register must agree with the money.
  const computation = computeMonth({ ...args, gate });
  const cost = computation.perMember.get("m1")!;
  check("register full count equals the billed full count", g.fullCount, cost.fullMealCount);

  // With no gate the register is untouched, which is what every existing closed
  // month and any mess that has not turned the gate on depends on.
  const ungated = mealRegisterForMonth({ ...args });
  check("without a gate every elapsed day is counted", ungated.rows[0].fullCount, 6);
  check("without a gate no cell is flagged", ungated.rows[0].cells.every((c) => c.billable !== false), true);
  const ungatedCost = computeMonth({ ...args });
  check(
    "an ungated register still agrees with its ledger",
    ungated.rows[0].fullCount,
    ungatedCost.perMember.get("m1")!.fullMealCount,
  );

  // A snapshot frozen before `billable` existed carries no flag, and must read
  // as "counted" rather than silently dropping the day.
  const legacy = JSON.parse(JSON.stringify(ungated));
  check("a legacy snapshot has no flag", legacy.rows[0].cells[0].billable, undefined);
  check("a legacy flag reads as billable", legacy.rows[0].cells[0].billable !== false, true);
}

// ---------------------------------------------------------------------------
// Bazar duty rotation
// ---------------------------------------------------------------------------

section("Bazar duty rotation");
{
  const rooms = [
    { id: "r101", capacity: 2 },
    { id: "r102", capacity: 2 },
    { id: "r103", capacity: 2 },
    { id: "r104", capacity: 2 },
    { id: "r105", capacity: 1 },
    { id: "r106", capacity: 2 },
    { id: "r108", capacity: 1 },
  ];

  const units = buildDutyUnits(rooms);
  check("two single rooms pair into one day", units, [
    ["r101"],
    ["r102"],
    ["r103"],
    ["r104"],
    ["r105", "r108"],
    ["r106"],
  ]);

  check(
    "starting from room 103 puts it first",
    orderUnitsFrom(units, "r103"),
    [["r103"], ["r104"], ["r105", "r108"], ["r106"], ["r101"], ["r102"]],
  );
  check(
    "starting from a paired single pulls in its partner",
    orderUnitsFrom(units, "r108"),
    [["r105", "r108"], ["r106"], ["r101"], ["r102"], ["r103"], ["r104"]],
  );
  check("an unknown room is rejected", orderUnitsFrom(units, "nope"), null);

  // Every unit covers a day, so the cycle length is the unit count, not rooms.
  check("cycle length counts units not rooms", units.length, 6);

  // An odd single left over still gets a turn rather than being dropped.
  const oddSingles = buildDutyUnits([
    { id: "a", capacity: 1 },
    { id: "b", capacity: 1 },
    { id: "c", capacity: 1 },
  ]);
  check("leftover single still takes a day", oddSingles, [["a", "b"], ["c"]]);

  check("no rooms yields no units", buildDutyUnits([]), []);
}

// ---------------------------------------------------------------------------
// Open period with nothing closed yet
// ---------------------------------------------------------------------------

section("Open period starts where the data starts");
{
  // Members who have been around since January, with the first status change in
  // February and no month ever closed.
  const longStanding = MEMBERS.map((m) => ({ ...m, joinDate: "2025-01-01" }));

  const result = computeRunningBalances({
    members: longStanding,
    rooms: ROOMS,
    changes: [
      { memberId: "m1", date: "2025-02-10", status: "FULL", sehri: false },
    ],
    guestMeals: [],
    extras: [],
    bills: [],
    khalaPayments: [
      { date: "2025-02-05", amount: 1300 },
      { date: "2025-03-02", amount: 1300 },
    ],
    rateCards: [RATE_CARD],
    deposits: [],
    settlements: [],
    openingBalances: [],
    lastClosedMonth: null,
    today: "2025-03-05",
  });

  check(
    "period begins at the first month with activity, not the current month",
    result.periodStart,
    "2025-02-01",
  );

  const m1 = result.rows.find((r) => r.memberId === "m1")!;
  const m2 = result.rows.find((r) => r.memberId === "m2")!;
  const m3 = result.rows.find((r) => r.memberId === "m3")!;
  const m4 = result.rows.find((r) => r.memberId === "m4")!;

  // m1: Feb 10-28 (19 days) + Mar 1-5 (5 days) = 24 full days at 60 = 1440,
  // plus a whole month's Khala for each of February and March: 300 x 2 = 600.
  check("February's meals are included", m1.cost, 24 * 60 + 600);
  // The others never had a status recorded, so they only carry month charges:
  // two whole months of Khala, the solo rate for m3.
  check("no status means only month-level charges (shared room)", m2.cost, 600);
  check("no status means only month-level charges (alone in a 2-bed)", m3.cost, 800);
  check("no status means only month-level charges (1-bed room)", m4.cost, 600);
}

// ---------------------------------------------------------------------------
// FIX 6 — flat monthly charges accrue day by day
// ---------------------------------------------------------------------------

section("Flat monthly charges, and khala only once it is paid");
{
  const base = {
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [] as GuestMealData[],
    rateCards: [RATE_CARD],
  };

  // Day 10 of a 31-day month, the day the month's whole khala was paid. The flat
  // electricity and wifi charges are already the whole month; only the meals are
  // still counting up.
  const tenth = computeMonth({ ...base, extras: [], bills: BILLS, khalaPayments: MARCH_KHALA, today: "2025-03-10" });
  const t1 = tenth.perMember.get("m1")!;
  check("day 10 of 31: Khala is the full month", t1.khalaAmount, 300);
  check("day 10 of 31: electricity is the full month", t1.electricityAmount, 200);
  check("day 10 of 31: wifi is the full month", t1.wifiAmount, 125);
  check("day 10 of 31: meals are only the days that have happened", t1.mealAmount, 10 * 60);

  // Day one of the month, before any khala has been paid: the same flat
  // electricity and wifi, and no khala at all until there is some to charge.
  const first = computeMonth({ ...base, extras: [], bills: BILLS, today: "2025-03-01" });
  const f1 = first.perMember.get("m1")!;
  check("day 1 of 31, khala not yet paid: nothing is charged", f1.khalaAmount, 0);
  check("day 1 of 31: electricity is the full month", f1.electricityAmount, 200);
  check("day 1 of 31: wifi is the full month", f1.wifiAmount, 125);
  check("day 1 of 31: one day of meals", f1.mealAmount, 60);

  // A finished month bills exactly the same flat charges.
  const finished = computeMonth({ ...base, extras: [], bills: BILLS, khalaPayments: MARCH_KHALA, today: "2025-04-15" });
  const d1 = finished.perMember.get("m1")!;
  check("a finished month bills Khala in full", d1.khalaAmount, 300);
  check("a finished month bills the full electricity share", d1.electricityAmount, 200);
  check("a finished month bills the full wifi share", d1.wifiAmount, 125);
  check("a finished month bills the full solo Khala", finished.perMember.get("m3")!.khalaAmount, 400);

  // A late joiner pays the same full month as everybody else, but only the meals
  // they actually ate.
  const lateJoiner = member("m9", "C", { joinDate: "2025-03-25" });
  const arrived = computeMonth({
    month: "2025-03",
    members: [lateJoiner],
    rooms: ROOMS,
    changes: [{ memberId: "m9", date: "2025-03-25", status: "FULL", sehri: false }],
    guestMeals: [],
    extras: [],
    bills: [],
    // On the 25th, alone in the 1-bed room C, the khala paid that day was the
    // solo-in-a-shared-room rate for the one person it covered.
    khalaPayments: [{ date: "2025-03-25", amount: 400 }],
    rateCards: [RATE_CARD],
    today: "2025-03-25",
  });
  check(
    "a member who arrived today carries the khala paid that day",
    arrived.perMember.get("m9")!.khalaAmount,
    400,
  );
  check("a member who arrived today pays one day of meals", arrived.perMember.get("m9")!.mealAmount, 60);

  // The extra pool is built from dated line items, so it grows as items land
  // rather than being charged up front.
  const earlyPool = computeMonth({ ...base, extras: MARCH_EXTRAS, bills: [], today: "2025-03-05" });
  const latePool = computeMonth({ ...base, extras: MARCH_EXTRAS, bills: [], today: "2025-03-31" });
  check("the pool only contains items dated so far", earlyPool.perMember.get("m1")!.extraAmount, 250);
  check("the pool grows as more items land", latePool.perMember.get("m1")!.extraAmount, 375);

  // Billing a month — closing it, or previewing that close — now changes nothing
  // about the money, because the live view already charges the full month.
  const billing = computeMonth({
    ...base,
    extras: [],
    bills: BILLS,
    khalaPayments: MARCH_KHALA,
    finalize: true,
    today: "2025-03-10",
  });
  check("finalize: Khala is the full month", billing.perMember.get("m1")!.khalaAmount, 300);
  check("finalize: electricity is the full month", billing.perMember.get("m1")!.electricityAmount, 200);
  check("finalize: wifi is the full month", billing.perMember.get("m1")!.wifiAmount, 125);
  check("finalize: a solo member's Khala is the full month", billing.perMember.get("m3")!.khalaAmount, 400);
  check("finalize: meals still stop at today", billing.perMember.get("m1")!.mealAmount, 10 * 60);
  check(
    "the live view of the same month charges exactly the same flat charges",
    computeMonth({ ...base, extras: [], bills: BILLS, khalaPayments: MARCH_KHALA, today: "2025-03-10" }).perMember.get("m1")!
      .khalaAmount,
    300,
  );
}

// ---------------------------------------------------------------------------
// FIX 5 — recurring rows are part of the day's total before it is stored
// ---------------------------------------------------------------------------

section("Confirm-then-materialise ordering");
{
  const planned = autoExtraRowsFor("2025-03-05", RATE_CARD);
  check("a confirmed day carries recurring extra row", planned.map((row) => row.category), [
    "RECURRING_DAILY",
  ]);
  check("recurring daily amount is 300", planned.map((row) => row.amount), [300]);
  check("recurring row is flagged for the daily budget", planned.every((row) => row.showInDailyBudget), true);

  const dayBefore = computeDayTotals({
    date: "2025-03-05",
    members: MEMBERS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: [],
    rateCard: RATE_CARD,
    today: "2025-03-31",
  });
  const dayAfter = computeDayTotals({
    date: "2025-03-05",
    members: MEMBERS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: planned,
    rateCard: RATE_CARD,
    today: "2025-03-31",
  });
  check("without the recurring rows the day is understated", dayBefore.extraAmount, 0);
  check("merging the planned rows gives the slip's figure", dayAfter.extraAmount, 300);
  check(
    "the stored budget gains exactly the recurring costs",
    dayAfter.totalBudget - dayBefore.totalBudget,
    300,
  );

  // Idempotency: a day saved twice must not double-count, and a row that was
  // deliberately turned off must not come back.
  check("recurring row is pending on a fresh day", pendingAutoExtraRows("2025-03-05", RATE_CARD, []).length, 1);
  check(
    "an already-recorded row is not added again",
    pendingAutoExtraRows(
      "2025-03-05",
      RATE_CARD,
      planned.map((row) => row.sourceKey),
    ).length,
    0,
  );
  check(
    "a recorded/voided row is not resurrected",
    pendingAutoExtraRows("2025-03-05", RATE_CARD, [planned[0].sourceKey]).map(
      (row) => row.category,
    ),
    [],
  );
  check("a missing rate card plans nothing", autoExtraRowsFor("2025-03-05", null), []);
  check(
    "a zeroed rate card plans nothing",
    autoExtraRowsFor("2025-03-05", {
      ...RATE_CARD,
      dailyExtraAmount: 0,
      managerDailyFee: 0,
    }),
    [],
  );
}

// ---------------------------------------------------------------------------
// FIX 1 / FIX 8 — month locks and what a delete would destroy
// ---------------------------------------------------------------------------

section("Month locks");
{
  const closed = closedMonthSet(["2025-01", "2025-02"]);

  check("a date in a closed month is locked", closedMonthFor(closed, "2025-02-14"), "2025-02");
  check("a date in an open month is not locked", closedMonthFor(closed, "2025-03-01"), null);
  check("isMonthClosed agrees for a closed month", isMonthClosed(closed, "2025-02-28"), true);
  check("isMonthClosed agrees for an open month", isMonthClosed(closed, "2025-03-01"), false);
  check("nothing is locked when no month is closed", isMonthClosed(closedMonthSet([]), "2025-02-14"), false);

  const loss = historyLoss(
    ["2025-02-01", "2025-02-02", "2025-03-01", "2025-04-05"],
    closed,
  );
  check("every record is counted", loss.total, 4);
  check("only records in unclosed months are at risk", loss.unclosed, 2);
  check("the unclosed months are listed oldest first", loss.unclosedMonths, ["2025-03", "2025-04"]);
  check("records in closed months are safe to lose", historyLoss(["2025-01-05", "2025-02-05"], closed).unclosed, 0);
  check("no records means no risk", historyLoss([], closed).unclosed, 0);
}

// ---------------------------------------------------------------------------
// FIX 3 — settlement never skips an unclosed month
// ---------------------------------------------------------------------------

section("Settlement sequencing");
{
  const activity = monthsWithActivity({
    changes: [{ date: "2025-01-10" }],
    guestMeals: [],
    deposits: [],
    extras: [],
    bills: [],
  });
  check("activity months are collected", [...activity].sort(), ["2025-01"]);
  check(
    "voided extras do not count as activity",
    [...monthsWithActivity({
      changes: [],
      guestMeals: [],
      deposits: [],
      extras: [{ date: "2025-01-10", voided: true }],
      bills: [],
    })],
    [],
  );
  check(
    "bills and confirmed bazar days count as activity",
    [...monthsWithActivity({
      changes: [],
      guestMeals: [],
      deposits: [],
      extras: [],
      bills: [{ month: "2025-02" }],
      bazarDates: ["2025-03-04"],
    })].sort(),
    ["2025-02", "2025-03"],
  );

  const nothingClosed = closedMonthSet([]);
  check(
    "the first month ever needs nothing closed before it",
    requiredPrecedingClose({ month: "2025-01", closedMonths: nothingClosed, activityMonths: activity }),
    null,
  );
  check(
    "February must wait for January",
    requiredPrecedingClose({ month: "2025-02", closedMonths: nothingClosed, activityMonths: activity }),
    "2025-01",
  );
  check(
    "once January is closed, February is free",
    requiredPrecedingClose({
      month: "2025-02",
      closedMonths: closedMonthSet(["2025-01"]),
      activityMonths: activity,
    }),
    null,
  );
  // An empty month in between still has to be closed, otherwise its carry-forward
  // would be skipped.
  check(
    "an empty in-between month still has to be closed",
    requiredPrecedingClose({
      month: "2025-03",
      closedMonths: closedMonthSet(["2025-01"]),
      activityMonths: activity,
    }),
    "2025-02",
  );
  check(
    "a month with no earlier activity needs nothing closed",
    requiredPrecedingClose({
      month: "2025-05",
      closedMonths: nothingClosed,
      activityMonths: monthsWithActivity({
        changes: [{ date: "2025-05-02" }],
        guestMeals: [],
        deposits: [],
        extras: [],
        bills: [],
      }),
    }),
    null,
  );

  const settlements = [
    { memberId: "m1", month: "2025-01", openingBalance: 0, closingBalance: 100 },
    { memberId: "m1", month: "2025-02", openingBalance: 100, closingBalance: 40 },
    { memberId: "m2", month: "2025-02", openingBalance: 0, closingBalance: -25 },
  ];
  const fromFebruary = openingBalancesFor({
    month: "2025-03",
    closedMonths: closedMonthSet(["2025-01", "2025-02"]),
    settlements,
    openingBalances: [],
  });
  check(
    "opening balances come from the immediately preceding month",
    [...fromFebruary.entries()].sort(),
    [
      ["m1", 40],
      ["m2", -25],
    ],
  );
  check(
    "an older closing balance is NOT reused when the previous month is open",
    openingBalancesFor({
      month: "2025-03",
      closedMonths: closedMonthSet(["2025-01"]),
      settlements,
      openingBalances: [],
    }).size,
    0,
  );
  check(
    "the first month of the ledger opens at zero",
    openingBalancesFor({
      month: "2025-01",
      closedMonths: nothingClosed,
      settlements,
      openingBalances: [],
    }).size,
    0,
  );

  // Reopening an older month leaves later closed months holding stale figures,
  // so closing an older month while a later one is closed has to be refused.
  check(
    "months closed after this one are flagged",
    laterClosedMonthsFor("2025-02", closedMonthSet(["2025-01", "2025-03", "2025-04"])),
    ["2025-03", "2025-04"],
  );
  check(
    "nothing later is flagged for the newest closed month",
    laterClosedMonthsFor("2025-04", closedMonthSet(["2025-01", "2025-04"])),
    [],
  );
  check(
    "nothing later is flagged when no later month is closed",
    laterClosedMonthsFor("2025-04", closedMonthSet(["2025-01", "2025-02"])),
    [],
  );
}

// ---------------------------------------------------------------------------
// Declared opening balances (the "first month" seed)
// ---------------------------------------------------------------------------

section("Declared opening balance seeds the first open month");
{
  const settlements = [
    { memberId: "m1", month: "2025-03", openingBalance: 0, closingBalance: 2165 },
  ];

  // Bootstrap: nothing closed yet, so there is nothing to carry. A declared
  // opening becomes the authoritative start-of-month position.
  const bootstrap = computeRunningBalances({
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: MARCH_EXTRAS,
    bills: BILLS,
    khalaPayments: MARCH_KHALA,
    rateCards: [RATE_CARD],
    deposits: [{ memberId: "m1", date: "2025-03-02", amount: 5000 }],
    settlements: [],
    openingBalances: [{ memberId: "m1", month: "2025-03", amount: 900 }],
    lastClosedMonth: null,
    today: "2025-03-20",
  });
  const b1 = bootstrap.rows.find((r) => r.memberId === "m1")!;
  const b2 = bootstrap.rows.find((r) => r.memberId === "m2")!;
  check("declared opening is used when nothing is closed", b1.openingBalance, 900);
  check(
    "balance = opening + deposits - cost",
    b1.balance,
    900 + 5000 - (1200 + 300 + 325 + 375),
  );
  check("members without a declared opening still start at zero", b2.openingBalance, 0);

  // Override: a closed month would otherwise carry 2165 forward; an explicit
  // opening for the first open month replaces that carry.
  const override = computeRunningBalances({
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: [],
    bills: [],
    khalaPayments: [{ date: "2025-04-02", amount: 1300 }],
    rateCards: [RATE_CARD],
    deposits: [],
    settlements,
    openingBalances: [{ memberId: "m1", month: "2025-04", amount: 500 }],
    lastClosedMonth: "2025-03",
    today: "2025-04-05",
  });
  const o1 = override.rows.find((r) => r.memberId === "m1")!;
  check("declared opening overrides the carried closing balance", o1.openingBalance, 500);
  check("balance uses the overridden opening", o1.balance, 500 - (5 * 60 + 300));

  // No double counting: a declared opening for a *later* month in the open
  // period is ignored by the running total, which already rolls each month
  // forward through its own deposits and cost.
  const laterMonth = computeRunningBalances({
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: [],
    bills: [],
    rateCards: [RATE_CARD],
    deposits: [],
    settlements: [],
    openingBalances: [{ memberId: "m1", month: "2025-04", amount: 9999 }],
    lastClosedMonth: null,
    today: "2025-03-20",
  });
  const l1 = laterMonth.rows.find((r) => r.memberId === "m1")!;
  check("an opening for a later month is not double counted", l1.openingBalance, 0);

  // The month-close path must use the same precedence, so the figure shown
  // today and the figure stored when the month is closed cannot disagree.
  check(
    "close path: a declared opening replaces the carried closing balance",
    [
      ...openingBalancesFor({
        month: "2025-04",
        closedMonths: closedMonthSet(["2025-03"]),
        settlements,
        openingBalances: [{ memberId: "m1", month: "2025-04", amount: 500 }],
      }).entries(),
    ],
    [["m1", 500]],
  );
  check(
    "close path: a declared opening applies with no prior close (bootstrap)",
    [
      ...openingBalancesFor({
        month: "2025-01",
        closedMonths: closedMonthSet([]),
        settlements,
        openingBalances: [{ memberId: "m2", month: "2025-01", amount: -250 }],
      }).entries(),
    ],
    [["m2", -250]],
  );

  // Regression: the settlement page builds its preview by resolving openings
  // here, while the balances dashboard resolves them inside
  // `computeRunningBalances`. When `openingBalances` was an optional argument
  // the page forgot to pass it, defaulted to `[]`, and previewed every opening
  // as 0 while the dashboard showed the real figure — the two tabs disagreed.
  // Feeding the same declared opening through both paths must agree.
  const declaredOpenings = [
    { memberId: "m1", month: "2025-01", amount: 900 },
    { memberId: "m2", month: "2025-01", amount: -250 },
  ];
  const BOOTSTRAP_MEMBERS: MemberData[] = [
    member("m1", "A", { joinDate: "2025-01-01" }),
    member("m2", "B", { joinDate: "2025-01-01" }),
  ];
  const BOOTSTRAP_ROOMS: RoomData[] = [ROOMS[0], ROOMS[1]];
  const previewOpenings = openingBalancesFor({
    month: "2025-01",
    closedMonths: closedMonthSet([]),
    settlements,
    openingBalances: declaredOpenings,
  });
  const previewRows = buildSettlementRows({
    computation: computeMonth({
      month: "2025-01",
      members: BOOTSTRAP_MEMBERS,
      rooms: BOOTSTRAP_ROOMS,
      changes: [],
      guestMeals: [],
      extras: [],
      bills: [],
      rateCards: [],
      today: "2025-01-31",
    }),
    members: BOOTSTRAP_MEMBERS,
    rooms: BOOTSTRAP_ROOMS,
    deposits: [],
    openingBalances: previewOpenings,
  });
  const dashboard = computeRunningBalances({
    members: BOOTSTRAP_MEMBERS,
    rooms: BOOTSTRAP_ROOMS,
    changes: [],
    guestMeals: [],
    extras: [],
    bills: [],
    rateCards: [],
    deposits: [],
    settlements,
    openingBalances: declaredOpenings,
    lastClosedMonth: null,
    today: "2025-01-31",
  });
  check(
    "settlement preview shows the same opening as the balance dashboard",
    previewRows.map((row) => [row.memberId, row.openingBalance]).sort(),
    dashboard.rows
      .map((row) => [row.memberId, row.openingBalance])
      .sort(),
  );
  check(
    "settlement preview carries the declared opening for a bootstrap month",
    previewRows.map((row) => row.openingBalance),
    [900, -250],
  );
}

// ---------------------------------------------------------------------------
// CSV import parsing (paste-a-spreadsheet-to-bulk-add)
// ---------------------------------------------------------------------------

section("CSV import parsing");
{
  check(
    "quoted fields, embedded commas and escaped quotes",
    parseCsvRecords('a,"b,c",d\n"say ""hi""",e,f\n'),
    [
      ["a", "b,c", "d"],
      ['say "hi"', "e", "f"],
    ],
  );
  check("blank lines are dropped", parseCsvRecords("a,b\n\n\nc,d\n"), [
    ["a", "b"],
    ["c", "d"],
  ]);

  check("plain number", parseAmountCell("1500"), 1500);
  check("comma grouping", parseAmountCell("1,200"), 1200);
  check("taka sign", parseAmountCell("৳800"), 800);
  check("currency suffix", parseAmountCell("1200 tk"), 1200);
  check("parenthesised is negative", parseAmountCell("(250)"), -250);
  check("leading minus", parseAmountCell("-40"), -40);
  check("Bengali digits", parseAmountCell("৳১,৫০০"), 1500);
  check("not a number", parseAmountCell("abc"), null);
  check("empty", parseAmountCell("  "), null);

  check("ISO date", parseDateCell("2025-03-05"), "2025-03-05");
  check("day-first date", parseDateCell("5/3/2025"), "2025-03-05");
  check("two-digit year", parseDateCell("05-03-25"), "2025-03-05");
  check("impossible date", parseDateCell("2025-02-30"), null);
  check("nonsense date", parseDateCell("soon"), null);

  // Header-driven.
  const withHeader = parseCsvImport(
    "name,room,amount,date\nRahim,101,1500,2025-03-05\nKarim,102,1200\n",
  );
  check("header is detected", withHeader.headerDetected, true);
  check("header rows parsed", withHeader.rows.map((r) => [r.name, r.room, r.amount, r.date]), [
    ["Rahim", "101", 1500, "2025-03-05"],
    ["Karim", "102", 1200, null],
  ]);
  check(
    "a quoted grouped number is one amount",
    parseCsvImport('name,room,amount\nKarim,102,"1,200"\n').rows[0].amount,
    1200,
  );
  check(
    "an unquoted grouped number split by the reader is refused, not guessed",
    parseCsvImport("name,room,amount\nKarim,102,৳1,200\n").rows[0].problem,
    "Amount may be split by a comma — re-paste as plain digits",
  );

  // Positional fallback with no header.
  const positional = parseCsvImport("Rahim,101,1500\nKarim,102,1200\n");
  check("no header falls back to name,room,amount", positional.headerDetected, false);
  check(
    "positional rows parsed",
    positional.rows.map((r) => [r.name, r.room, r.amount]),
    [
      ["Rahim", "101", 1500],
      ["Karim", "102", 1200],
    ],
  );

  check(
    "a bad amount is flagged, not thrown",
    parseCsvImport("name,room,amount\nRahim,101,oops\n").rows[0].problem,
    "Amount is not a number",
  );
  check("a missing name is flagged", parseCsvImport("name,amount\n,100\n").rows[0].problem, "No name");
}

// ---------------------------------------------------------------------------
// CSV row → member matching
// ---------------------------------------------------------------------------

section("CSV row to member matching");
{
  const members = [
    { id: "m1", name: "Rahim", roomNumber: "101" },
    { id: "m2", name: "Karim", roomNumber: "102" },
    { id: "m3", name: "Rahim", roomNumber: "103" },
  ];

  check("exact name match", resolveMember("Rahim", "", members), { ok: false, reason: "ambiguous", candidates: ["m1", "m3"] });
  check("room breaks the tie", resolveMember("Rahim", "103", members), { ok: true, id: "m3" });
  check("case and spacing are ignored", resolveMember("  karim ", "", members), { ok: true, id: "m2" });
  check("unique name", resolveMember("Karim", "", members), { ok: true, id: "m2" });
  check("unknown name", resolveMember("Nobody", "", members).ok, false);
  check("blank name is not matched", resolveMember("", "101", members).ok, false);
  // A partial name is refused rather than guessed at: crediting a deposit to the
  // wrong person is far worse than skipping one row.
  check("a partial name is refused, not guessed", resolveMember("Rahi", "", members).ok, false);
  check("a first name is refused, not guessed", resolveMember("Kari", "", members).ok, false);
  check("a room does not rescue a partial name", resolveMember("Rahi", "101", members).ok, false);
  check(
    "the candidates of a refused row are reported back",
    resolveMember("Rahi", "", members),
    { ok: false, reason: "not-found", candidates: ["m1", "m2", "m3"] },
  );
}

// ---------------------------------------------------------------------------
// FIX 4 — the closed-month register is a frozen snapshot
// ---------------------------------------------------------------------------

section("Frozen register snapshot");
{
  const live = mealRegisterForMonth({
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    today: "2025-03-31",
  });
  const snapshot: RegisterSnapshot = { days: live.days, rows: live.rows };

  // It is stored as jsonb, so it has to survive a round-trip unchanged.
  const roundTripped = JSON.parse(JSON.stringify(snapshot)) as RegisterSnapshot;
  check("the snapshot survives a JSON round-trip", roundTripped, snapshot);
  check("every day column is preserved", roundTripped.days.length, 31);
  check(
    "per-member totals are preserved",
    roundTripped.rows.find((row) => row.memberId === "m1")!.fullCount,
    31,
  );
  check(
    "per-day cells are preserved",
    roundTripped.rows.find((row) => row.memberId === "m1")!.cells[0].status,
    "FULL",
  );

  // The frozen register must agree with the frozen ledger stored beside it.
  const computation = computeMonth({
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [],
    extras: [],
    bills: [],
    rateCards: [RATE_CARD],
    today: "2025-03-31",
  });
  const mismatches = roundTripped.rows.filter((row) => {
    const cost = computation.perMember.get(row.memberId);
    if (!cost) return false;
    return cost.fullMealCount !== row.fullCount || cost.halfMealCount !== row.halfCount;
  });
  check("the frozen register matches the frozen ledger", mismatches.length, 0);
}

// ---------------------------------------------------------------------------
// FIX 7 — password policy and the optional solo wifi toggle
// ---------------------------------------------------------------------------

section("Password policy and solo wifi toggle");
{
  check("a short password is rejected", passwordProblem("short") !== null, true);
  check("the old default is rejected", passwordProblem("admin") !== null, true);
  check("another well-known default is rejected", passwordProblem("password") !== null, true);
  check("a repeated character is rejected", passwordProblem("aaaaaaaaaa") !== null, true);
  check("padding cannot smuggle a default through", passwordProblem("  ADMIN  ") !== null, true);
  check("a reasonable password is accepted", passwordProblem("khala-300-taka"), null);
  check("isWeakPassword agrees", isWeakPassword("12345678"), true);

  let threw = false;
  try {
    assertStrongPassword("admin", "ADMIN_PASSWORD");
  } catch {
    threw = true;
  }
  check("assertStrongPassword refuses a default", threw, true);

  let accepted = true;
  try {
    assertStrongPassword("a-long-enough-passphrase", "ADMIN_PASSWORD");
  } catch {
    accepted = false;
  }
  check("assertStrongPassword accepts a real password", accepted, true);

  // The solo wifi multiplier is an optional per-mess toggle. It has to reach the
  // month calculation, not just apportionUtilities.
  const base = {
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [] as GuestMealData[],
    extras: [] as ExtraItemData[],
    bills: BILLS,
    khalaPayments: MARCH_KHALA,
    rateCards: [RATE_CARD],
    today: "2025-03-31",
  };
  const singleWifi = computeMonth(base);
  const doubleWifi = computeMonth({ ...base, soloWifiMultiplier: 2 });

  check("default: a solo member pays the single wifi share", singleWifi.perMember.get("m3")!.wifiAmount, 125);
  check("toggle on: a solo member pays double wifi", doubleWifi.perMember.get("m3")!.wifiAmount, 200);
  check("the toggle apportions shared-room member's share proportionally", doubleWifi.perMember.get("m1")!.wifiAmount, 100);
  check(
    "the toggle raises the solo member's month by exactly the extra wifi share",
    doubleWifi.perMember.get("m3")!.totalCost - singleWifi.perMember.get("m3")!.totalCost,
    75,
  );
  check(
    "the toggle does not touch electricity",
    doubleWifi.perMember.get("m3")!.electricityAmount,
    singleWifi.perMember.get("m3")!.electricityAmount,
  );
}

// ---------------------------------------------------------------------------
// Special ("solo") rooms — a multi-bed room let out whole to one person
// ---------------------------------------------------------------------------

section("Special rooms");
{
  // A special double: one person has the whole room.
  const specialRooms: RoomData[] = [
    { id: "A", number: "101", capacity: 2, solo: true },
    { id: "B", number: "102", capacity: 2, solo: false },
  ];
  const oneAlone = [
    member("m1", "A", { joinDate: "2025-03-01" }),
    member("m2", "B", { joinDate: "2025-03-01" }),
    member("m3", "C", { joinDate: "2025-03-01" }),
  ];
  const occ = (rooms: RoomData[], members: MemberData[]) =>
    occupancyForRange({
      members,
      rooms,
      from: "2025-03-01",
      to: "2025-03-31",
      today: "2025-03-31",
    });

  const aloneInEach = occ(specialRooms, oneAlone);
  check(
    "a special double with one person is solo",
    isSoloInSharedRoom(aloneInEach.get("A")),
    true,
  );
  check(
    "a plain double with one person is solo too",
    isSoloInSharedRoom(aloneInEach.get("B")),
    true,
  );

  // The decisive rule: the designation describes the arrangement, it does not
  // force solo billing. A second person moving in turns the special room into an
  // ordinary shared room rather than charging one person for a whole double.
  const twoInSpecial = occ(
    specialRooms,
    [...oneAlone, member("m4", "A", { joinDate: "2025-03-15" })],
  );
  check(
    "a special room becomes an ordinary shared room once a second person moves in",
    isSoloInSharedRoom(twoInSpecial.get("A")),
    false,
  );
  check(
    "the other single-occupant room is still solo",
    isSoloInSharedRoom(twoInSpecial.get("B")),
    true,
  );

  // A one-bed room is never "alone in a shared room", designated or not.
  const singleRoom = occ(
    [{ id: "A", number: "101", capacity: 1, solo: true }],
    [member("m1", "A", { joinDate: "2025-03-01" })],
  );
  check(
    "a single room is never solo even if flagged",
    isSoloInSharedRoom(singleRoom.get("A")),
    false,
  );

  // The designation must reach the money: a special room and a plain double
  // holding the same single person cost the same, because both are alone.
  const specialBase = {
    month: "2025-03",
    changes: FULL_FROM_MARCH_1,
    guestMeals: [] as GuestMealData[],
    extras: [] as ExtraItemData[],
    bills: BILLS,
    rateCards: [RATE_CARD],
    today: "2025-03-31",
  };
  const soloMember = [member("m3", "A", { joinDate: "2025-03-01" })];
  const sharedMember = [member("m3", "B", { joinDate: "2025-03-01" })];
  // Each case is a one-member mess, so the month's khala paid is that member's
  // own rate: the solo rate when alone, the normal rate when sharing.
  const specialCost = computeMonth({
    ...specialBase,
    members: soloMember,
    rooms: [{ id: "A", number: "101", capacity: 2, solo: true }],
    khalaPayments: [{ date: "2025-03-10", amount: 400 }],
  });
  const plainCost = computeMonth({
    ...specialBase,
    members: sharedMember,
    rooms: [{ id: "B", number: "102", capacity: 2, solo: false }],
    khalaPayments: [{ date: "2025-03-10", amount: 400 }],
  });
  check(
    "a special room alone is billed the same as any alone double",
    specialCost.perMember.get("m3")!.totalCost,
    plainCost.perMember.get("m3")!.totalCost,
  );
  check(
    "a special room alone pays the solo khala rate",
    specialCost.perMember.get("m3")!.khalaAmount,
    RATE_CARD.khalaSoloRate,
  );

  // The room type label is what the manager picks from, so it has to round-trip.
  check(
    "a special double round-trips through the form value",
    parseRoomTypeValue(roomTypeValue({ capacity: 2, solo: true })),
    { capacity: 2, solo: true },
  );
  check(
    "a plain double round-trips through the form value",
    parseRoomTypeValue(roomTypeValue({ capacity: 2, solo: false })),
    { capacity: 2, solo: false },
  );
  check(
    "a single never round-trips as special",
    parseRoomTypeValue(roomTypeValue({ capacity: 1, solo: true })),
    { capacity: 1, solo: false },
  );
  check(
    "a special double is labelled as such",
    roomTypeLabel({ capacity: 2, solo: true }),
    "solo double",
  );
  check(
    "a plain triple keeps its plain label",
    roomTypeLabel({ capacity: 3, solo: false }),
    "triple",
  );
  check(
    "the dropdown offers the special types",
    ROOM_TYPES.map(roomTypeValue),
    ["1", "2", "3", "2-solo", "3-solo"],
  );
}

// ---------------------------------------------------------------------------
// Two separate cost pools, khala bill, and manager fee deduction
// ---------------------------------------------------------------------------

section("Two separate cost pools, khala bill, and manager fee deduction");
{
  const twelveMembers: MemberData[] = Array.from({ length: 12 }, (_, i) => ({
    id: `m${i + 1}`,
    name: `Boarder ${i + 1}`,
    roomId: `r${(i % 4) + 1}`,
    active: true,
    joinDate: "2026-09-01",
    leaveDate: null,
  }));
  const fourRooms: RoomData[] = Array.from({ length: 4 }, (_, i) => ({
    id: `r${i + 1}`,
    number: `10${i + 1}`,
    capacity: 3,
    floor: 1,
    baseRent: 3000,
  }));

  // Extras pool: 300 recurring + 6000 one-off + legacy manager fee row (must be excluded)
  const extrasList: ExtraItemData[] = [
    {
      id: "ex-rec",
      date: "2026-09-01",
      label: "Daily Extra",
      amount: 300,
      category: "RECURRING_DAILY",
      showInDailyBudget: true,
      voided: false,
    },
    {
      id: "ex-fridge",
      date: "2026-09-05",
      label: "Fridge repair",
      amount: 6000,
      category: "ONE_OFF",
      showInDailyBudget: false,
      voided: false,
    },
    {
      id: "ex-legacy-mgr",
      date: "2026-09-01",
      label: "Manager fee legacy",
      amount: 30,
      category: "MANAGER_FEE",
      showInDailyBudget: true,
      voided: false,
    },
  ];

  const pool = extraPoolForRange({
    extras: extrasList,
    from: "2026-09-01",
    to: "2026-09-30",
    activeMemberIds: Array.from({ length: 12 }, (_, i) => `u${i + 1}`),
  });

  check("extras pool excludes manager fee", pool.total, 6300);
  check("extras pool per head is 6300 / 12 = 525", pool.perMember, 525);

  // Utility pool: electricity 2400, wifi 1200, khala 3600
  const utilityBills: UtilityBillData[] = [
    { month: "2026-09", type: "ELECTRICITY", amount: 2400 },
    { month: "2026-09", type: "WIFI", amount: 1200 },
    { month: "2026-09", type: "KHALA", amount: 3600 },
  ];

  const monthCalc = computeMonth({
    month: "2026-09",
    cutoff: "2026-09-30",
    finalize: true,
    members: twelveMembers,
    rooms: fourRooms,
    changes: [],
    guestMeals: [],
    extras: extrasList,
    bills: utilityBills,
    // All 12 share a room, so the month's khala target is 12 x 300 = 3,600.
    khalaPayments: [{ date: "2026-09-10", amount: 3600 }],
    rateCards: [{ ...RATE_CARD, dailyExtraAmount: 300, managerDailyFee: 30 }],
    today: "2026-09-30",
  });

  check("month extra pool per member is 525", monthCalc.extraPool.perMember, 525);
  check("month electricity total is 2400", monthCalc.totals.electricityAmount, 2400);
  check("month wifi total is 1200", monthCalc.totals.wifiAmount, 1200);
  check("month khala total is the 3600 actually paid", monthCalc.totals.khalaAmount, 3600);
  check(
    "each member utility share is (2400+1200+3600)/12 = 600",
    monthCalc.perMember.get("m1")?.khalaElecWifiAmount,
    600,
  );
  check(
    "each member extra share is 525",
    monthCalc.perMember.get("m1")?.extraAmount,
    525,
  );

  // Manager fee deduction on bazar budget:
  // With meal total 1000 and manager fee 30: cash given out = 1000 - 30 = 970
  const dayBudget = computeDayTotals({
    date: "2026-09-01",
    members: twelveMembers,
    changes: [],
    guestMeals: [],
    extras: [{ id: "rec1", date: "2026-09-01", label: "Extra", amount: 300, category: "RECURRING_DAILY", showInDailyBudget: true, voided: false }],
    rateCard: { ...RATE_CARD, managerDailyFee: 30 },
    today: "2026-09-01",
  });
  check("manager fee is held back from bazar cash", dayBudget.managerFeeAmount, 30);

  // Running balance separates utilityCost and extraCost
  const running = computeRunningBalances({
    members: twelveMembers,
    rooms: fourRooms,
    changes: [],
    guestMeals: [],
    extras: extrasList,
    bills: utilityBills,
    khalaPayments: [{ date: "2026-09-10", amount: 3600 }],
    rateCards: [{ ...RATE_CARD, dailyExtraAmount: 300, managerDailyFee: 30 }],
    deposits: [],
    settlements: [],
    openingBalances: [],
    lastClosedMonth: null,
    today: "2026-09-30",
  });

  check("running balance row has utilityCost 600", running.rows[0].utilityCost, 600);
  check("running balance row has extraCost 525", running.rows[0].extraCost, 525);
  check("running balance summary has utilityCost 7200", running.summary.utilityCost, 7200);
  check("running balance summary has extraCost 6300", running.summary.extraCost, 6300);
}

// ---------------------------------------------------------------------------
// Room-capacity utility split and exact pool reconciliation
// ---------------------------------------------------------------------------

section("Room-capacity utility split and exact pool reconciliation");
{
  // 12 active members:
  // 8 members in 4 shared double rooms (2 people each -> normal weight 1)
  // 4 members in 4 single-occupancy double rooms (1 person each -> solo weight 2)
  const userRooms: RoomData[] = [
    { id: "r1", number: "101", capacity: 2, solo: false },
    { id: "r2", number: "102", capacity: 2, solo: false },
    { id: "r3", number: "103", capacity: 2, solo: false },
    { id: "r4", number: "104", capacity: 2, solo: false },
    { id: "r5", number: "201", capacity: 2, solo: false },
    { id: "r6", number: "202", capacity: 2, solo: false },
    { id: "r7", number: "203", capacity: 2, solo: false },
    { id: "r8", number: "204", capacity: 2, solo: false },
  ];
  const userMembers: MemberData[] = [
    member("u1", "r1", { joinDate: "2026-09-01" }),
    member("u2", "r1", { joinDate: "2026-09-01" }),
    member("u3", "r2", { joinDate: "2026-09-01" }),
    member("u4", "r2", { joinDate: "2026-09-01" }),
    member("u5", "r3", { joinDate: "2026-09-01" }),
    member("u6", "r3", { joinDate: "2026-09-01" }),
    member("u7", "r4", { joinDate: "2026-09-01" }),
    member("u8", "r4", { joinDate: "2026-09-01" }),
    member("u9", "r5", { joinDate: "2026-09-01" }),
    member("u10", "r6", { joinDate: "2026-09-01" }),
    member("u11", "r7", { joinDate: "2026-09-01" }),
    member("u12", "r8", { joinDate: "2026-09-01" }),
  ];

  const bills: UtilityBillData[] = [
    { month: "2026-09", type: "ELECTRICITY", amount: 600000 },
    { month: "2026-09", type: "WIFI", amount: 15000 },
    { month: "2026-09", type: "KHALA", amount: 4000 },
  ];

  const calc = computeMonth({
    month: "2026-09",
    finalize: true,
    members: userMembers,
    rooms: userRooms,
    changes: [],
    guestMeals: [],
    extras: [
      { id: "rec", date: "2026-09-01", label: "Daily recurring", amount: 8400, category: "RECURRING_DAILY", showInDailyBudget: true, voided: false },
      { id: "man", date: "2026-09-15", label: "Fridge repair", amount: 6000, category: "ONE_OFF", showInDailyBudget: false, voided: false },
    ],
    bills,
    // The month's khala actually paid: 8 shared x 300 + 4 solo x 400 = 4,000.
    khalaPayments: [{ date: "2026-09-12", amount: 4000 }],
    rateCards: [{ ...RATE_CARD, khalaNormalRate: 300, khalaSoloRate: 400 }],
    soloElectricityMultiplier: 2,
    soloWifiMultiplier: 1,
    today: "2026-09-30",
  });

  // Verify pool totals
  const utilityPoolTotal = 600000 + 15000 + 4000;
  const extrasPoolTotal = 8400 + 6000;
  check("utility pool total is 619,000", utilityPoolTotal, 619000);
  check("extras pool total is 14,400", calc.extraPool.total, extrasPoolTotal);
  check("extras per member is 1,200", calc.extraPool.perMember, 1200);

  // Verify individual member shares
  const sharedMember = calc.perMember.get("u1")!;
  const soloMember = calc.perMember.get("u9")!;

  // Electricity: 600,000 across weight 16 (8x1 + 4x2)
  check("shared member electricity is 37,500", sharedMember.electricityAmount, 37500);
  check("solo member electricity is 75,000 (exactly double 37,500)", soloMember.electricityAmount, 75000);

  // Wifi: 15,000 across 12 members (multiplier 1)
  check("shared member wifi is 1,250", sharedMember.wifiAmount, 1250);
  check("solo member wifi is 1,250", soloMember.wifiAmount, 1250);

  // Khala: 4,000 across weights (8x300 + 4x400 = 4,000)
  check("shared member khala is 300", sharedMember.khalaAmount, 300);
  check("solo member khala is 400", soloMember.khalaAmount, 400);

  // Combined utility share (Khala+Wifi+Electricity)
  check("shared member utility share is 37,500 + 1,250 + 300 = 39,050", sharedMember.khalaElecWifiAmount, 39050);
  check("solo member utility share is 75,000 + 1,250 + 400 = 76,650", soloMember.khalaElecWifiAmount, 76650);

  // CRITICAL CHECK: Sum of all member utility shares equals the utility pool EXACTLY
  const totalSettlementUtility = [...calc.perMember.values()].reduce((acc, r) => acc + r.khalaElecWifiAmount, 0);
  check("settlement utility column total equals utility pool total (619,000) exactly", totalSettlementUtility, 619000);

  // Verify with an uneven number requiring rounding distribution, on a month
  // where only part of the khala has been paid. The saved KHALA bill is
  // deliberately ignored: khala comes from dated payments, so a stray bill row
  // cannot quietly change what the mess charges.
  const unevenBills: UtilityBillData[] = [
    { month: "2026-09", type: "ELECTRICITY", amount: 600001 },
    { month: "2026-09", type: "WIFI", amount: 15001 },
    { month: "2026-09", type: "KHALA", amount: 4001 },
  ];
  const unevenCalc = computeMonth({
    month: "2026-09",
    finalize: true,
    members: userMembers,
    rooms: userRooms,
    changes: [],
    guestMeals: [],
    extras: [],
    bills: unevenBills,
    // Only 2,000 of the 4,000 target handed over so far, in two instalments.
    khalaPayments: [
      { date: "2026-09-06", amount: 1200 },
      { date: "2026-09-24", amount: 800 },
    ],
    rateCards: [{ ...RATE_CARD, khalaNormalRate: 300, khalaSoloRate: 400 }],
    soloElectricityMultiplier: 2,
    soloWifiMultiplier: 1,
    today: "2026-09-30",
  });
  const unevenPoolTotal = 600001 + 15001 + 2000;
  const unevenSettlementTotal = [...unevenCalc.perMember.values()].reduce((acc, r) => acc + r.khalaElecWifiAmount, 0);
  check("rounding distribution ensures uneven total matches exactly", unevenSettlementTotal, unevenPoolTotal);
  check(
    "a saved Khala bill does not change the Khala charged",
    unevenCalc.perMember.get("u1")!.khalaAmount,
    150,
  );
}

// ---------------------------------------------------------------------------
// Input handling: money typed by a human, and month keys
// ---------------------------------------------------------------------------

section("Money typed into a form");
{
  const parse = takaAmount(0);
  const read = (value: unknown) => parse.safeParse(value);

  check("plain digits", read(1500).success && read(1500).data, 1500);
  check("a numeric string", read("1500").data, 1500);
  check("the taka sign is ignored", read("৳1500").data, 1500);
  check("lakh grouping is accepted", read("1,50,000").data, 150000);
  check("Bengali digits are accepted", read("৳১,৫০০").data, 1500);
  check("a negative amount is refused", read("-50").success, false);
  check("a decimal is refused", read("12.50").success, false);
  check("text is refused", read("abc").success, false);
  // An empty box used to become ৳0 and write a ৳0 row into the pool.
  check("an empty box is refused, not ৳0", read("").success, false);
  check("a whitespace-only box is refused", read("   ").success, false);
  check("a missing value is refused", read(undefined).success, false);

  const positive = takaAmount(1);
  check("an extra item cannot be ৳0", positive.safeParse(0).success, false);
  check("an extra item of ৳1 is fine", positive.safeParse(1).data, 1);

  // The message the manager sees must name the problem in words.
  const message = firstIssue(read("abc").error, "fallback");
  check("the rejection reads as a sentence", /amount/i.test(message), true);
  check("no raw library message leaks", message.startsWith("Invalid input:"), false);
}

section("Month and date keys");
{
  check("a real month is accepted", isValidMonthKey("2026-09"), true);
  check("month 00 is refused", isValidMonthKey("2026-00"), false);
  check("month 13 is refused", isValidMonthKey("2026-13"), false);
  check("month 99 is refused", isValidMonthKey("2026-99"), false);
  check("a short key is refused", isValidMonthKey("2026-9"), false);
  check("a date key is refused", isValidMonthKey("2026-09-01"), false);
  check("a real date is accepted", isValidDateKey("2026-09-30"), true);
  check("30 February is refused", isValidDateKey("2026-02-30"), false);
  check("29 February 2028 is accepted", isValidDateKey("2028-02-29"), true);
}

// ---------------------------------------------------------------------------
// The confirmation gate
//
// Meal status is sticky, so before the gate the balance grew a day's meals the
// moment midnight passed, with no confirmation anywhere. The gate says a day only
// charges once its bazar is confirmed — but never for a day that has already
// been billed.
// ---------------------------------------------------------------------------

section("The confirmation gate");
{
  const gate = (
    startsOn: string,
    confirmed: string[],
  ): MealChargeGate => ({ startsOn, confirmedDays: new Set(confirmed) });

  const everyDayOfMarch = Array.from({ length: 31 }, (_, i) =>
    `2025-03-${String(i + 1).padStart(2, "0")}`,
  );

  // One member, FULL from the 1st at ৳60 a day, with every other charge left out
  // so the meal figure is read straight off the member's own row.
  const SOLO: MemberData[] = [member("m1", "A")];
  const soloFull: StatusChangeData[] = [
    { memberId: "m1", date: "2025-03-01", status: "FULL", sehri: false },
  ];

  const mealsFor = (options: {
    gate?: MealChargeGate | null;
    today: string;
    changes?: StatusChangeData[];
    guestMeals?: GuestMealData[];
  }) => {
    const computation = computeMonth({
      month: "2025-03",
      members: SOLO,
      rooms: ROOMS,
      changes: options.changes ?? soloFull,
      guestMeals: options.guestMeals ?? [],
      extras: [],
      bills: [],
      rateCards: [RATE_CARD],
      today: options.today,
      ...(options.gate === undefined ? {} : { gate: options.gate }),
    });
    return computation.perMember.get("m1")!.mealAmount;
  };

  // Without a gate, a full unfiltered month is billed — the old behaviour, and
  // what every other assertion in this file already assumes.
  check("no gate bills the whole month as before", mealsFor({ today: "2025-03-31" }), 31 * 60);

  // The headline bug. Nothing confirmed, so nothing is charged.
  check(
    "an unconfirmed month charges nothing at all",
    mealsFor({ gate: gate("2025-03-01", []), today: "2025-03-31" }),
    0,
  );
  check(
    "the same month with every day confirmed is billed in full",
    mealsFor({ gate: gate("2025-03-01", everyDayOfMarch), today: "2025-03-31" }),
    31 * 60,
  );
  check(
    "only the confirmed day is charged",
    mealsFor({ gate: gate("2025-03-01", ["2025-03-05"]), today: "2025-03-31" }),
    60,
  );
  check(
    "two confirmed days are charged",
    mealsFor({
      gate: gate("2025-03-01", ["2025-03-05", "2025-03-06"]),
      today: "2025-03-31",
    }),
    120,
  );

  // The regression that matters most: the gate must never reach backwards.
  // Days 1-9 predate it, so they stay billed exactly as they always were —
  // switching this on cannot quietly refund a month already charged.
  check(
    "days before the gate starts are still charged, confirmed or not",
    mealsFor({ gate: gate("2025-03-10", ["2025-03-11"]), today: "2025-03-31" }),
    (9 + 1) * 60,
  );

  // The reported symptom, end to end: midnight passes and nothing moves.
  {
    const through10 = mealsFor({
      gate: gate("2025-03-10", ["2025-03-10"]),
      today: "2025-03-10",
    });
    check("the confirmed day is charged", through10, (9 + 1) * 60);
    check(
      "midnight arriving does not charge the new day",
      mealsFor({ gate: gate("2025-03-10", ["2025-03-10"]), today: "2025-03-11" }),
      through10,
    );
    check(
      "a day left unconfirmed stays free however far the month runs",
      mealsFor({ gate: gate("2025-03-10", ["2025-03-10"]), today: "2025-03-31" }),
      through10,
    );
    check(
      "confirming the new day is what moves the balance",
      mealsFor({
        gate: gate("2025-03-10", ["2025-03-10", "2025-03-11"]),
        today: "2025-03-11",
      }),
      through10 + 60,
    );
  }

  // A guest meal is a meal and obeys the same rule.
  const guestOnFifth: GuestMealData[] = [
    { memberId: "m1", date: "2025-03-05", type: "GUEST_FULL", count: 1 },
  ];
  const guestCount = (confirmed: string[]) =>
    computeMonth({
      month: "2025-03",
      members: SOLO,
      rooms: ROOMS,
      changes: soloFull,
      guestMeals: guestOnFifth,
      extras: [],
      bills: [],
      rateCards: [RATE_CARD],
      today: "2025-03-31",
      gate: gate("2025-03-01", confirmed),
    }).totals.guestFullCount;

  check("a guest meal on an unconfirmed day is not charged", guestCount(["2025-03-06"]), 0);
  check("the same guest meal on a confirmed day is charged", guestCount(["2025-03-05"]), 1);

  // The empty hostel: nobody ate, so there is nothing to charge.
  check(
    "a day with everyone OFF has nothing to charge",
    mealsFor({
      gate: gate("2025-03-01", []),
      changes: [{ memberId: "m1", date: "2025-03-01", status: "OFF", sehri: false }],
      today: "2025-03-31",
    }),
    0,
  );

  // Money that actually changed hands is never gated. A deposit paid on the 20th
  // must still be in the balance on the 20th, confirmed or not.
  {
    const balance = computeRunningBalances({
      members: SOLO,
      rooms: ROOMS,
      changes: soloFull,
      guestMeals: [],
      extras: [],
      bills: [],
      rateCards: [RATE_CARD],
      deposits: [{ memberId: "m1", date: "2025-03-20", amount: 5000 }],
      deductions: [],
      settlements: [],
      openingBalances: [],
      lastClosedMonth: null,
      today: "2025-03-31",
      gate: gate("2025-03-01", ["2025-03-10"]),
    }).rows.find((row) => row.memberId === "m1");

    check("a deposit after the last confirmed day still counts", balance?.deposits, 5000);
    check("only confirmed days are charged to the member", balance?.cost, 60);
    check("the balance nets the deposit against the confirmed cost", balance?.balance, 5000 - 60);
  }
}

section("The gate is built from the mess's own settings");
{
  check(
    "no configured start date means no gate at all",
    mealChargeGate({ mealChargeGateStarts: null }, ["2025-03-05"]),
    null,
  );
  const built = mealChargeGate(
    { mealChargeGateStarts: "2025-03-10" },
    ["2025-03-11", "2025-03-12"],
  );
  check("the start date is carried through", built?.startsOn, "2025-03-10");
  check("a day before the start is chargeable, confirmed or not", dayIsChargeable("2025-03-09", built!), true);
  check("an unconfirmed day on the start date is not chargeable", dayIsChargeable("2025-03-10", built!), false);
  check("a confirmed day after the start is chargeable", dayIsChargeable("2025-03-11", built!), true);
}

section("The most recent confirmed day");
{
  check(
    "the latest of several is picked",
    latestConfirmedDay(["2025-03-01", "2025-03-20", "2025-03-11"], "2025-03-31"),
    "2025-03-20",
  );
  check("nothing confirmed means nothing to report", latestConfirmedDay([], "2025-03-31"), null);
  check(
    "a future date is never reported",
    latestConfirmedDay(["2025-03-20", "2025-04-05"], "2025-03-31"),
    "2025-03-20",
  );
}

section("The days that are being given away");
{
  const gate: MealChargeGate = {
    startsOn: "2025-03-01",
    confirmedDays: new Set(["2025-03-05", "2025-03-06"]),
  };
  const everyoneOff = MEMBERS.map((m) => ({
    memberId: m.id,
    date: "2025-03-01",
    status: "OFF" as const,
    sehri: false,
  }));
  const skipped = (changes: StatusChangeData[], guestMeals: GuestMealData[] = []) =>
    unconfirmedChargeableDays({
      gate,
      members: MEMBERS,
      changes,
      guestMeals,
      from: "2025-03-01",
      to: "2025-03-10",
      today: "2025-03-10",
    });

  // Everyone is FULL from the 1st, so every unconfirmed day would have charged.
  check("every unconfirmed day with meals is listed, in order", skipped(FULL_FROM_MARCH_1), [
    "2025-03-01", "2025-03-02", "2025-03-03", "2025-03-04",
    "2025-03-07", "2025-03-08", "2025-03-09", "2025-03-10",
  ]);

  // Activity is read from the resolved timeline, not from the change rows, so one
  // status set on the 1st makes every later day chargeable even though nothing
  // is recorded against them. Missing this is how the warning would go blind on
  // exactly the days it exists to catch.
  check(
    "one status set on the 1st still makes all 8 unconfirmed days chargeable",
    skipped([{ memberId: "m1", date: "2025-03-01", status: "FULL", sehri: false }, ...everyoneOff.slice(1)]),
    ["2025-03-01", "2025-03-02", "2025-03-03", "2025-03-04", "2025-03-07", "2025-03-08", "2025-03-09", "2025-03-10"],
  );

  check("an empty hostel lists nothing", skipped(everyoneOff), []);

  check(
    "a guest meal alone makes a day chargeable",
    skipped(everyoneOff, [{ memberId: "m1", date: "2025-03-09", type: "GUEST_FULL", count: 1 }]),
    ["2025-03-09"],
  );

  check(
    "with the gate off there is nothing being skipped",
    unconfirmedChargeableDays({
      gate: null,
      members: MEMBERS,
      changes: FULL_FROM_MARCH_1,
      guestMeals: [],
      from: "2025-03-01",
      to: "2025-03-10",
      today: "2025-03-10",
    }),
    [],
  );

  check(
    "a future day is never listed",
    unconfirmedChargeableDays({
      gate,
      members: MEMBERS,
      changes: FULL_FROM_MARCH_1,
      guestMeals: [],
      from: "2025-03-01",
      to: "2025-03-20",
      today: "2025-03-10",
    }),
    skipped(FULL_FROM_MARCH_1),
  );
}
// ---------------------------------------------------------------------------
// The settlement screen and the balance dashboard must agree
// ---------------------------------------------------------------------------

section("Settlement screen agrees with the balance dashboard");

{
  // A member on FULL meals every day of an open month, with a rate card whose
  // full meal rate is a round number, so a one-day difference is unmistakable.
  const RATE: RateCardData = { ...RATE_CARD, fullMealRate: 60 };
  const changes: StatusChangeData[] = [
    { memberId: "m1", date: "2025-03-01", status: "FULL", sehri: false },
  ];
  const common = {
    month: "2025-03" as const,
    cutoff: "2025-03-10",
    members: MEMBERS,
    rooms: ROOMS,
    changes,
    guestMeals: [],
    extras: [],
    bills: [],
    khalaPayments: [],
    rateCards: [RATE],
    today: "2025-03-10",
  };

  // The bazar was confirmed on the 1st and 2nd but never on the 3rd. The gate
  // exists so that the 3rd is free to everybody.
  const gate = mealChargeGate(
    { mealChargeGateStarts: "2025-03-03" },
    ["2025-03-01", "2025-03-02"],
  );

  const gated = computeMonth({ ...common, gate });
  const ungated = computeMonth({ ...common });
  check("the gate frees the unconfirmed day", gated.perMember.get("m1")!.fullMealCount, 2);
  check("without the gate every day up to today is charged", ungated.perMember.get("m1")!.fullMealCount, 10);

  // This is the regression. The settlement screen used to call `computeMonth`
  // without handing it the gate, so it billed the unconfirmed day while the
  // balance dashboard — which does pass the gate — gave it away. Every member
  // was then overcharged by exactly one full meal rate, on both the preview and
  // the frozen month, and the frozen figure propagated forever through the
  // carry-forward chain.
  {
    const settlementRow = buildSettlementRows({
      computation: gated,
      members: MEMBERS,
      rooms: ROOMS,
      deposits: [],
      deductions: [],
      openingBalances: new Map(),
    }).find((r) => r.memberId === "m1")!;

    const running = computeRunningBalances({
      members: MEMBERS,
      rooms: ROOMS,
      changes,
      guestMeals: [],
      extras: [],
      bills: [],
      rateCards: [RATE],
      deposits: [],
      deductions: [],
      settlements: [],
      openingBalances: [],
      lastClosedMonth: null,
      today: "2025-03-10",
      gate,
    }).rows.find((r) => r.memberId === "m1")!;

    check(
      "the settlement row costs exactly what the balance page costs",
      settlementRow.totalCost,
      running.cost,
    );
    check("and they reach the same balance", settlementRow.closingBalance, running.balance);
  }

  // A deduction has to be visible on the row, not only folded into the closing
  // balance. When it was hidden, the printed arithmetic read
  // opening + deposit − cost and still disagreed with the balance beside it.
  {
    const row = buildSettlementRows({
      computation: gated,
      members: MEMBERS,
      rooms: ROOMS,
      deposits: [{ memberId: "m1", date: "2025-03-01", amount: 600 }],
      deductions: [{ memberId: "m1", date: "2025-03-01", amount: 90 }],
      openingBalances: new Map([["m1", 306]]),
    }).find((r) => r.memberId === "m1")!;

    check("the row reports the deposit gross", row.newDeposits, 600);
    check("the row reports what was taken out", row.newDeductions, 90);
    check(
      "the printed columns now reconcile to the balance",
      row.openingBalance + row.newDeposits - row.totalCost - row.newDeductions,
      row.closingBalance,
    );
  }
}

// ---------------------------------------------------------------------------
// Guest meals that carry forward
// ---------------------------------------------------------------------------

section("Guest meals carry forward when the mess asks them to");

{
  const HOST = [member("m1", "A")];
  const FULL = [{ memberId: "m1", date: "2025-03-01", status: "FULL" as const, sehri: false }];
  const at = (date: string, count: number): GuestMealData => ({
    memberId: "m1",
    date,
    type: "GUEST_FULL",
    count,
  });

  // OFF is the default and must stay the old behaviour, or simply deploying
  // this would start charging people for guests nobody entered.
  {
    const guests = [at("2025-03-01", 2)];
    check("off: the day itself reads 2", guestCountsOn(guests, "m1", "2025-03-01").full, 2);
    check("off: the next day resets to 0", guestCountsOn(guests, "m1", "2025-03-02").full, 0);
    check("off: explicit null behaves the same as off", guestCountsOn(guests, "m1", "2025-03-02", null).full, 0);
  }

  // A stored zero is not the same as an absent row once carry-forward is on.
  {
    const guests = [at("2025-03-01", 2), at("2025-03-03", 0)];
    check("on: 2 carries forward", guestCountsOn(guests, "m1", "2025-03-02", "2025-03-01").full, 2);
    check("on: an explicit 0 stops the carry", guestCountsOn(guests, "m1", "2025-03-03", "2025-03-01").full, 0);
    check("on: and it stays 0 afterwards", guestCountsOn(guests, "m1", "2025-03-09", "2025-03-01").full, 0);
  }

  // The boundary is the whole safety argument: rows before the start date keep
  // their old per-day meaning, so an already-billed month cannot move.
  {
    const guests = [at("2025-03-01", 2)];
    const sticky = "2025-03-05";
    check("before the start date a row is still just that day", guestCountsOn(guests, "m1", "2025-03-02", sticky).full, 0);
    check("the first sticky day inherits the day before", guestCountsOn(guests, "m1", "2025-03-05", sticky).full, 2);
    check("and holds it", guestCountsOn(guests, "m1", "2025-03-20", sticky).full, 2);
  }

  // Half guests are carried independently of full ones.
  {
    const guests: GuestMealData[] = [
      { memberId: "m1", date: "2025-03-01", type: "GUEST_FULL", count: 1 },
      { memberId: "m1", date: "2025-03-01", type: "GUEST_HALF", count: 3 },
      { memberId: "m1", date: "2025-03-04", type: "GUEST_FULL", count: 0 },
    ];
    const read = (date: string) => guestCountsOn(guests, "m1", date, "2025-03-01");
    check("both kinds carry", [read("2025-03-02").full, read("2025-03-02").half], [1, 3]);
    check("zeroing one kind leaves the other", [read("2025-03-04").full, read("2025-03-04").half], [0, 3]);
  }

  // A zero row must read as "no guests" when the feature is off, or saving a
  // zero would start costing money on a day that never had any.
  {
    const zeros = [at("2025-03-01", 0), at("2025-03-02", 0)];
    check("a stored zero reads as none when off", guestCountsOn(zeros, "m1", "2025-03-01").full, 0);
    check("a stored zero is not counted by the day total", computeDayTotals({
      date: "2025-03-01", members: HOST, changes: FULL, guestMeals: zeros,
      extras: [], rateCard: RATE_CARD, today: "2025-03-31",
    }).guestFullCount, 0);
  }

  // The month engine has to charge a carried guest on every day it applies, not
  // only on the day it was typed — otherwise the board and the bill disagree.
  {
    const guests = [at("2025-03-01", 2)];
    const month = (sticky: string | null) => computeMonth({
      month: "2025-03", members: HOST, rooms: ROOMS, changes: FULL,
      guestMeals: guests, extras: [], bills: [], rateCards: [RATE_CARD],
      today: "2025-03-03", stickyGuestMealsFrom: sticky,
    });
    check("off: charged once, on the only day with a row", month(null).totals.guestFullCount, 2);
    check("on: charged on all three days", month("2025-03-01").totals.guestFullCount, 6);
    check("on: and the extra two days are billed too",
      month("2025-03-01").totals.mealAmount,
      (2 + 1) * 60 + 6 * RATE_CARD.guestFullRate,
    );
  }

  // Turning it on from today must not touch a day already behind us.
  {
    const guests = [at("2025-03-01", 2)];
    const later = computeMonth({
      month: "2025-03", members: HOST, rooms: ROOMS, changes: FULL,
      guestMeals: guests, extras: [], bills: [], rateCards: [RATE_CARD],
      today: "2025-03-03", stickyGuestMealsFrom: "2025-03-03",
    });
    check("a start date after the fact leaves earlier days alone", later.totals.guestFullCount, 4);
  }

  // A host who is marked OFF can still be hosting guests. This is why guests
  // are priced in their own pass rather than behind the member's status check.
  {
    const OFF: StatusChangeData[] = [{ memberId: "m1", date: "2025-03-01", status: "OFF", sehri: false }];
    const comp = computeMonth({
      month: "2025-03", members: HOST, rooms: ROOMS, changes: OFF,
      guestMeals: [at("2025-03-01", 2)], extras: [], bills: [], rateCards: [RATE_CARD],
      today: "2025-03-01",
    });
    check("a guest is still charged when the host eats nothing", comp.totals.guestFullCount, 2);
  }

  // Carry-forward must not smuggle guests onto an unconfirmed day: the gate
  // still decides whether a day may cost anybody anything.
  {
    const guests = [at("2025-03-01", 2)];
    const gate = mealChargeGate({ mealChargeGateStarts: "2025-03-02" }, ["2025-03-01"]);
    const comp = computeMonth({
      month: "2025-03", members: HOST, rooms: ROOMS, changes: FULL,
      guestMeals: guests, extras: [], bills: [], rateCards: [RATE_CARD],
      today: "2025-03-03", stickyGuestMealsFrom: "2025-03-01", gate,
    });
    check("an unconfirmed day hosts no guests, carried or not", comp.totals.guestFullCount, 2);
  }

  // A recorded "none" must not make a day look like it hosted somebody, or the
  // "days being given away" warning would fire on a day nobody visited.
  check(
    "a zero row is not a guest day",
    unconfirmedChargeableDays({
      gate: mealChargeGate({ mealChargeGateStarts: "2025-03-01" }, []),
      members: HOST, changes: [], guestMeals: [at("2025-03-05", 0)],
      from: "2025-03-01", to: "2025-03-10", today: "2025-03-10",
    }),
    [],
  );
  check(
    "a real guest day still is",
    unconfirmedChargeableDays({
      gate: mealChargeGate({ mealChargeGateStarts: "2025-03-01" }, []),
      members: HOST, changes: [], guestMeals: [at("2025-03-05", 1)],
      from: "2025-03-01", to: "2025-03-10", today: "2025-03-10",
    }),
    ["2025-03-05"],
  );

  // The resolver is the single source of truth, so the board, the day budget and
  // the room cards have to be reading the same numbers.
  {
    const guests = [at("2025-03-01", 2)];
    const sticky = "2025-03-01";
    const day = computeDayTotals({
      date: "2025-03-02", members: HOST, changes: FULL, guestMeals: guests,
      extras: [], rateCard: RATE_CARD, today: "2025-03-31", stickyGuestMealsFrom: sticky,
    });
    const rooms = roomBreakdownForDay({
      date: "2025-03-02", members: HOST, rooms: ROOMS, changes: FULL,
      guestMeals: guests, today: "2025-03-31", stickyGuestMealsFrom: sticky,
    });
    const states = memberDayStates({
      date: "2025-03-02", members: HOST, changes: FULL, guestMeals: guests,
      today: "2025-03-31", stickyGuestMealsFrom: sticky,
    });
    check("the day budget counts the carried guests", day.guestFullCount, 2);
    check("the room card agrees", rooms[0].guestFullCount, 2);
    check("the board agrees", states.get("m1")!.guestFullCount, 2);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(
  `\n${passed} passed, ${failures.length} failed${failures.length ? ":" : ""}`,
);
for (const failure of failures) console.log(`  x ${failure}`);
process.exit(failures.length > 0 ? 1 : 0);
