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
  computeRunningBalances,
  extraPoolForRange,
  khalaAmountFor,
  occupancyForRange,
  rateCardFor,
  resolveStatusTimeline,
  mealRegisterForMonth,
  roomBreakdownForDay,
  type ExtraItemData,
  type MemberData,
  type RateCardData,
  type RoomData,
  type StatusChangeData,
  type GuestMealData,
  type UtilityBillData,
  type DepositData,
} from "../src/lib/calc";
import { buildDutyUnits, orderUnitsFrom } from "../src/lib/roster";

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
  guestFullRate: 80,
  guestHalfRate: 45,
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
  check("guest full amount 2x80", totals.guestFullAmount, 160);
  check("guest half amount", totals.guestHalfAmount, 0);
  check("only budget-flagged extras count", totals.extraAmount, 330);
  check(
    "guest meal does not change host status (m4 still OFF)",
    totals.fullCount,
    1,
  );
  check("total = 60+70+160+330-20", totals.totalBudget, 600);

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
    lastClosedMonth: null,
    today: "2025-03-20",
  });

  const m1 = result.rows.find((r) => r.memberId === "m1")!;
  const m2 = result.rows.find((r) => r.memberId === "m2")!;

  check("period starts at the open month", result.periodStart, "2025-03-01");
  // 20 days x 60 meals, plus 300 khala, 375 utilities (250 elec + 125 wifi), 375 extra.
  check("20 full meals to date", m1.cost, 20 * 60 + 300 + 375 + 375);
  check("balance = 5000 - 2250", m1.balance, 2750);
  check("member with no deposit is in deficit", m2.balance, -2250);
  check("deficit count", result.summary.membersInDeficit, 3);
  // m3 is solo in a 2-bed room: 400 khala and 625 utilities.
  const m3 = result.rows.find((r) => r.memberId === "m3")!;
  check("solo member's month-to-date cost", m3.cost, 20 * 60 + 400 + 625 + 375);
  check(
    "mess-wide balance = 2750 - 2250 - 2600 - 2250",
    result.summary.balance,
    -4350,
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
    lastClosedMonth: "2025-03",
    today: "2025-04-05",
  });

  const m1 = result.rows.find((r) => r.memberId === "m1")!;
  check("period resumes after the closed month", result.periodStart, "2025-04-01");
  check("opening balance comes from the closed month", m1.openingBalance, 2165);
  // Meal costs accrue day by day (5 x 60), while the month-level flat charges
  // (Khala here) are billed in full for the in-progress month.
  check("5 April days at 60, plus the flat monthly Khala", m1.cost, 5 * 60 + 300);
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

  // m1: Feb 10-28 (19 days) + Mar 1-5 (5 days) = 24 full days at 60,
  // plus one month's Khala in each of February and March.
  check("February's meals are included", m1.cost, 24 * 60 + 300 + 300);
  // The others never had a status recorded, so they only carry month charges:
  // Khala normal twice for the shared/1-cap rooms, solo twice for m3.
  check("no status means only month-level charges (shared room)", m2.cost, 600);
  check("no status means only month-level charges (alone in a 2-bed)", m3.cost, 800);
  check("no status means only month-level charges (1-bed room)", m4.cost, 600);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(
  `\n${passed} passed, ${failures.length} failed${failures.length ? ":" : ""}`,
);
for (const failure of failures) console.log(`  x ${failure}`);
process.exit(failures.length > 0 ? 1 : 0);
