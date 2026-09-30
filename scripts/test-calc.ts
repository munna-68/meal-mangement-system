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
  isSoloInSharedRoom,
  khalaAmountFor,
  occupancyForRange,
  rateCardFor,
  resolveStatusTimeline,
  mealRegisterForMonth,
  roomBreakdownForDay,
  type ExtraItemData,
  type MemberData,
  type RateCardData,
  type RegisterSnapshot,
  type RoomData,
  type StatusChangeData,
  type GuestMealData,
  type UtilityBillData,
  type DepositData,
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
  check("only budget-flagged extras count", totals.extraAmount, 330);
  check(
    "guest meal does not change host status (m4 still OFF)",
    totals.fullCount,
    1,
  );
  check("total = 60+70+150-10+330-20", totals.totalBudget, 580);

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
  check("worked total budget", workedTotals.totalBudget, 175);

  const voidedExtras = extras.map((e) =>
    e.id === "e1" ? { ...e, voided: true } : e,
  );
  check(
    "voided extra is excluded",
    computeDayTotals({
      date: "2025-03-05",
      members: MEMBERS,
      changes,
      guestMeals: guests,
      extras: voidedExtras,
      rateCard: RATE_CARD,
      today: "2025-03-31",
    }).extraAmount,
    30,
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
  check("per-head electricity = 1000/4", apportionment.perHeadElectricity, 250);
  check("per-head wifi = 500/4", apportionment.perHeadWifi, 125);
  check("exactly one solo member", apportionment.soloCount, 1);

  check("sharing a 2-bed room pays the base share", apportionment.byMember.get("m1"), {
    electricity: 250,
    wifi: 125,
    total: 375,
  });
  check("roommate pays the same base share", apportionment.byMember.get("m2"), {
    electricity: 250,
    wifi: 125,
    total: 375,
  });
  check(
    "alone in a 2-bed room: electricity doubled, wifi NOT doubled",
    apportionment.byMember.get("m3"),
    { electricity: 500, wifi: 125, total: 625 },
  );
  check("a 1-bed room pays the base share", apportionment.byMember.get("m4"), {
    electricity: 250,
    wifi: 125,
    total: 375,
  });

  // Doubling one member's share collects more than the bill. That is the mess's
  // rule as described, so it is asserted rather than treated as a rounding bug.
  const collected = [...apportionment.byMember.values()].reduce(
    (t, s) => t + s.total,
    0,
  );
  const billTotal =
    apportionment.totalElectricity + apportionment.totalWifi;
  check("collected = bill + one extra electricity share", collected, billTotal + 250);

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
    electricity: 500,
    wifi: 250,
    total: 750,
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
    activeMemberCount: 4,
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
    activeMemberCount: 4,
  });
  check("voided items are excluded from the pool", withVoided.total, 1500);

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

  // With manager fee included (e.g. ৳30/day)
  const withManagerFee = computeMonthlyFixedExtraSummary({
    month: "2026-09",
    confirmedBazarDaysCount: 28,
    rateCard: { ...RATE_CARD, dailyExtraAmount: 300, managerDailyFee: 30 },
    activeMemberCount: 30,
  });
  check("fixed extra summary includes manager fee total 28 * 30 = 840", withManagerFee.totalManagerFee, 840);
  check("fixed extra summary per boarder manager fee is 28", withManagerFee.perBoarderManagerFee, 28);
  check("fixed extra summary combined per boarder is 280 + 28 = 308", withManagerFee.combinedPerBoarder, 308);

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
    rateCards: [RATE_CARD],
    today: "2025-03-31",
  });

  const m1 = computation.perMember.get("m1")!;
  const m3 = computation.perMember.get("m3")!;

  check("31 full meals counted", m1.fullMealCount, 31);
  check("meal amount = 31 x 60", m1.mealAmount, 1860);
  check("khala is flat for the month, not per day", m1.khalaAmount, 300);
  check("khala + wifi + electricity = 300 + 375", m1.khalaElecWifiAmount, 675);
  check("extra is the same for everyone", m1.extraAmount, 375);
  check("total cost m1 = 1860+675+375", m1.totalCost, 2910);
  check("solo member pays 400 khala + 625 utilities", m3.khalaElecWifiAmount, 1025);
  check("total cost m3 = 1860+1025+375", m3.totalCost, 3260);
  check("everyone gets an identical extra", [
    ...computation.perMember.values(),
  ].every((r) => r.extraAmount === 375), true);
  check("4 active members", computation.activeMemberIds.length, 4);
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
  check("m1 closing = 5000 - 2910", m1.closingBalance, 2090);
  check("deposit after the month is excluded", m3.newDeposits, 1000);
  check("m3 closing = 1000 - 3260 (negative)", m3.closingBalance, -2260);
  check("m2 closing = 0 - 2910", m2.closingBalance, -2910);

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
    2090,
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
  // 20 of March's 31 days. Meals accrue per day; Khala, electricity and wifi are
  // flat monthly amounts accrued by the same 20/31 fraction.
  //   20 x 60 = 1200
  //   Khala     round(300 x 20/31) = 194
  //   Elec+wifi round(250 x 20/31) + round(125 x 20/31) = 161 + 81 = 242
  //   Extra     the pool is already date-bounded, so it is not pro-rated: 375
  check("20 full meals to date", m1.cost, 1200 + 194 + 242 + 375);
  check("balance = 5000 - 2011", m1.balance, 5000 - (1200 + 194 + 242 + 375));
  check("member with no deposit is in deficit", m2.balance, -(1200 + 194 + 242 + 375));
  check("deficit count", result.summary.membersInDeficit, 3);
  // m3 is solo in a 2-bed room: Khala round(400 x 20/31) = 258 and
  // round(250 x 2 x 20/31) + round(125 x 20/31) = 323 + 81 = 404.
  const m3 = result.rows.find((r) => r.memberId === "m3")!;
  check("solo member's month-to-date cost", m3.cost, 1200 + 258 + 404 + 375);
  check(
    "mess-wide balance = 5000 - 2011 - 2011 - 2237 - 2011",
    result.summary.balance,
    5000 - 2011 - 2011 - 2237 - 2011,
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
  // Meal costs accrue day by day (5 x 60), and the month-level flat charges
  // accrue too: Khala round(300 x 5/30) = 50 rather than the whole 300.
  check("5 April days at 60, plus 5 days of accrued Khala", m1.cost, 5 * 60 + 50);
  check("balance = 2165 - 350", m1.balance, 1815);
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
  // plus February's Khala in full (that month is over: 300) and March's Khala
  // accrued over 5 of its 31 days: round(300 x 5/31) = 48.
  check("February's meals are included", m1.cost, 24 * 60 + 300 + 48);
  // The others never had a status recorded, so they only carry month charges:
  // Khala normal in full for February plus 5/31 of it in March, solo for m3.
  check("no status means only month-level charges (shared room)", m2.cost, 300 + 48);
  check("no status means only month-level charges (alone in a 2-bed)", m3.cost, 400 + 65);
  check("no status means only month-level charges (1-bed room)", m4.cost, 300 + 48);
}

// ---------------------------------------------------------------------------
// FIX 6 — flat monthly charges accrue day by day
// ---------------------------------------------------------------------------

section("Flat monthly charges accrue day by day");
{
  const base = {
    month: "2025-03",
    members: MEMBERS,
    rooms: ROOMS,
    changes: FULL_FROM_MARCH_1,
    guestMeals: [] as GuestMealData[],
    rateCards: [RATE_CARD],
  };

  // Day 10 of a 31-day month. Every flat charge is a tenth-ish of the month.
  const tenth = computeMonth({ ...base, extras: [], bills: BILLS, today: "2025-03-10" });
  const t1 = tenth.perMember.get("m1")!;
  check("day 10 of 31: Khala accrued, not billed in full", t1.khalaAmount, Math.round((300 * 10) / 31));
  check("day 10 of 31: electricity accrued", t1.electricityAmount, Math.round((250 * 10) / 31));
  check("day 10 of 31: wifi accrued", t1.wifiAmount, Math.round((125 * 10) / 31));
  check("day 10 of 31: 10 days of meals", t1.mealAmount, 10 * 60);
  check(
    "day 10 of 31 is nowhere near a full month of flat charges",
    t1.khalaElecWifiAmount < 300 + 375,
    true,
  );

  // Day one of the month: one day of everything, not a whole month.
  const first = computeMonth({ ...base, extras: [], bills: BILLS, today: "2025-03-01" });
  const f1 = first.perMember.get("m1")!;
  check("day 1 of 31: one day of Khala", f1.khalaAmount, Math.round(300 / 31));
  check("day 1 of 31: one day of electricity", f1.electricityAmount, Math.round(250 / 31));
  check("day 1 of 31: one day of meals", f1.mealAmount, 60);
  check("day 1 of 31: one day of wifi", f1.wifiAmount, Math.round(125 / 31));

  // A month that has finished still bills in full, so settlements are unchanged.
  const finished = computeMonth({ ...base, extras: [], bills: BILLS, today: "2025-04-15" });
  const d1 = finished.perMember.get("m1")!;
  check("a finished month bills Khala in full", d1.khalaAmount, 300);
  check("a finished month bills the full electricity share", d1.electricityAmount, 250);
  check("a finished month bills the full wifi share", d1.wifiAmount, 125);
  check("a finished month bills the full extra share", finished.perMember.get("m3")!.khalaAmount, 400);

  // A late joiner only accrues from their own first day.
  const lateJoiner = member("m9", "C", { joinDate: "2025-03-25" });
  const arrived = computeMonth({
    month: "2025-03",
    members: [lateJoiner],
    rooms: ROOMS,
    changes: [{ memberId: "m9", date: "2025-03-25", status: "FULL", sehri: false }],
    guestMeals: [],
    extras: [],
    bills: [],
    rateCards: [RATE_CARD],
    today: "2025-03-25",
  });
  check("a member who arrived today pays one day of Khala", arrived.perMember.get("m9")!.khalaAmount, Math.round(300 / 31));
  check("a member who arrived today pays one day of meals", arrived.perMember.get("m9")!.mealAmount, 60);

  // The extra pool is already built from dated line items, so it is NOT
  // pro-rated again — it grows as items land rather than being charged up front.
  const earlyPool = computeMonth({ ...base, extras: MARCH_EXTRAS, bills: [], today: "2025-03-05" });
  const latePool = computeMonth({ ...base, extras: MARCH_EXTRAS, bills: [], today: "2025-03-31" });
  check("the pool only contains items dated so far", earlyPool.perMember.get("m1")!.extraAmount, 250);
  check("the pool grows as more items land", latePool.perMember.get("m1")!.extraAmount, 375);

  // Billing a month — closing it, or previewing that close — charges the flat
  // charges in full even when the month has not finished. Otherwise closing a
  // month on the 10th would permanently under-charge everyone by 21/31.
  const billing = computeMonth({
    ...base,
    extras: [],
    bills: BILLS,
    finalize: true,
    today: "2025-03-10",
  });
  check("finalize: Khala is billed in full mid-month", billing.perMember.get("m1")!.khalaAmount, 300);
  check("finalize: electricity is billed in full", billing.perMember.get("m1")!.electricityAmount, 250);
  check("finalize: wifi is billed in full", billing.perMember.get("m1")!.wifiAmount, 125);
  check("finalize: a solo member's Khala is billed in full", billing.perMember.get("m3")!.khalaAmount, 400);
  check("finalize: meals still stop at today", billing.perMember.get("m1")!.mealAmount, 10 * 60);
  check(
    "finalize does not leak into the live view of the same month",
    computeMonth({ ...base, extras: [], bills: BILLS, today: "2025-03-10" }).perMember.get("m1")!
      .khalaAmount,
    Math.round((300 * 10) / 31),
  );
}

// ---------------------------------------------------------------------------
// FIX 5 — recurring rows are part of the day's total before it is stored
// ---------------------------------------------------------------------------

section("Confirm-then-materialise ordering");
{
  const planned = autoExtraRowsFor("2025-03-05", RATE_CARD);
  check("a confirmed day carries both recurring rows", planned.map((row) => row.category), [
    "RECURRING_DAILY",
    "MANAGER_FEE",
  ]);
  check("the manager fee is added on top of the daily Extra", planned.map((row) => row.amount), [300, 30]);
  check("both rows are flagged for the daily budget", planned.every((row) => row.showInDailyBudget), true);

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
  check("merging the planned rows gives the slip's figure", dayAfter.extraAmount, 330);
  check(
    "the stored budget gains exactly the recurring costs",
    dayAfter.totalBudget - dayBefore.totalBudget,
    330,
  );

  // Idempotency: a day saved twice must not double-count, and a row that was
  // deliberately turned off must not come back.
  check("both rows are pending on a fresh day", pendingAutoExtraRows("2025-03-05", RATE_CARD, []).length, 2);
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
    "a voided row is not resurrected",
    pendingAutoExtraRows("2025-03-05", RATE_CARD, [planned[0].sourceKey]).map(
      (row) => row.category,
    ),
    ["MANAGER_FEE"],
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
    900 + 5000 - (1200 + 194 + 242 + 375),
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
    rateCards: [RATE_CARD],
    deposits: [],
    settlements,
    openingBalances: [{ memberId: "m1", month: "2025-04", amount: 500 }],
    lastClosedMonth: "2025-03",
    today: "2025-04-05",
  });
  const o1 = override.rows.find((r) => r.memberId === "m1")!;
  check("declared opening overrides the carried closing balance", o1.openingBalance, 500);
  check("balance uses the overridden opening", o1.balance, 500 - (5 * 60 + 50));

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
    rateCards: [RATE_CARD],
    today: "2025-03-31",
  };
  const singleWifi = computeMonth(base);
  const doubleWifi = computeMonth({ ...base, soloWifiMultiplier: 2 });

  check("default: a solo member pays the single wifi share", singleWifi.perMember.get("m3")!.wifiAmount, 125);
  check("toggle on: a solo member pays double wifi", doubleWifi.perMember.get("m3")!.wifiAmount, 250);
  check("the toggle leaves a shared-room member alone", doubleWifi.perMember.get("m1")!.wifiAmount, 125);
  check(
    "the toggle raises the solo member's month by exactly the extra wifi share",
    doubleWifi.perMember.get("m3")!.totalCost - singleWifi.perMember.get("m3")!.totalCost,
    125,
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
  const specialCost = computeMonth({
    ...specialBase,
    members: soloMember,
    rooms: [{ id: "A", number: "101", capacity: 2, solo: true }],
  });
  const plainCost = computeMonth({
    ...specialBase,
    members: sharedMember,
    rooms: [{ id: "B", number: "102", capacity: 2, solo: false }],
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
// Report
// ---------------------------------------------------------------------------

console.log(
  `\n${passed} passed, ${failures.length} failed${failures.length ? ":" : ""}`,
);
for (const failure of failures) console.log(`  x ${failure}`);
process.exit(failures.length > 0 ? 1 : 0);
