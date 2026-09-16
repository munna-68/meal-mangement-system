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
  type ExtraItemData,
  type MemberData,
  type RateCardData,
  type RoomData,
  type StatusChangeData,
  type GuestMealData,
  type UtilityBillData,
  type DepositData,
} from "../src/lib/calc";

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

section("Electricity + wifi apportionment (by room capacity)");
{
  const apportionment = apportionUtilities({
    members: MEMBERS,
    rooms: ROOMS,
    bills: BILLS,
    from: "2025-03-01",
    to: "2025-03-31",
    today: "2025-03-31",
  });

  check("total capacity = 2+2+1", apportionment.totalCapacity, 5);
  check("per unit rate = 1500/5", apportionment.perUnitRate, 300);
  check("sharing a 2-cap room pays 1x", apportionment.byMember.get("m1"), {
    electricity: 200,
    wifi: 100,
    total: 300,
  });
  check("roommate pays the same", apportionment.byMember.get("m2"), {
    electricity: 200,
    wifi: 100,
    total: 300,
  });
  check("alone in a 2-cap room pays exactly 2x", apportionment.byMember.get("m3"), {
    electricity: 400,
    wifi: 200,
    total: 600,
  });
  check("1-cap room pays exactly 1x", apportionment.byMember.get("m4"), {
    electricity: 200,
    wifi: 100,
    total: 300,
  });
  const collected = [...apportionment.byMember.values()].reduce(
    (t, s) => t + s.total,
    0,
  );
  check("shares add up to the full bill", collected, 1500);
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
  check("khala + wifi + electricity", m1.khalaElecWifiAmount, 600);
  check("extra is the same for everyone", m1.extraAmount, 375);
  check("total cost m1 = 1860+300+300+375", m1.totalCost, 2835);
  check("total cost m3 = 1860+400+600+375", m3.totalCost, 3235);
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
  check("m1 closing = 5000 - 2835", m1.closingBalance, 2165);
  check("deposit after the month is excluded", m3.newDeposits, 1000);
  check("m3 closing = 1000 - 3235 (negative)", m3.closingBalance, -2235);
  check("m2 closing = 0 - 2835", m2.closingBalance, -2835);

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
    2165,
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
  check("20 full meals to date", m1.cost, 20 * 60 + 300 + 300 + 375);
  check("balance = 5000 - 2175", m1.balance, 2825);
  check("member with no deposit is in deficit", m2.balance, -2175);
  check("deficit count", result.summary.membersInDeficit, 3);
  check(
    "mess-wide balance = 2825 - 2175 - 2575 - 2175",
    result.summary.balance,
    -4100,
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
