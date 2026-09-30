/**
 * Runs the APP's own calculation engine (unmodified) against the QA snapshot of
 * the owner's current data, so we can see exactly what each page would show.
 */
import { Client } from "pg";

import {
  buildSettlementRows,
  computeDayTotals,
  computeMonth,
  computeRunningBalances,
  mealRegisterForMonth,
  rateCardFor,
  apportionUtilities,
} from "../../src/lib/calc";
import { closedMonthSet, openingBalancesFor } from "../../src/lib/locks";
import { monthOf, monthStart, monthEnd, todayKey } from "../../src/lib/dates";

const URL = process.env.QA_SNAPSHOT_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/postgres";

async function main() {
  const client = new Client({ connectionString: URL });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const many = async (sql: string) => (await client.query(sql)).rows;

  const settings = (await many(`select * from mess_settings`))[0];
  const rateCards = await many(
    `select id, effective_from::text as "effectiveFrom", effective_to::text as "effectiveTo",
            full_meal_rate as "fullMealRate", half_meal_rate as "halfMealRate",
            guest_full_rate as "guestFullRate", guest_half_rate as "guestHalfRate",
            sehri_rate as "sehriRate", feast_flat_charge as "feastFlatCharge",
            khala_normal_rate as "khalaNormalRate", khala_solo_rate as "khalaSoloRate",
            manager_daily_fee as "managerDailyFee", daily_extra_amount as "dailyExtraAmount"
     from rate_cards order by effective_from`,
  );
  const rooms = await many(`select id, number, capacity, solo from rooms order by number`);
  const members = await many(
    `select m.id, m.name, m.room_id as "roomId", m.active, m.join_date::text as "joinDate",
            m.leave_date::text as "leaveDate", r.number as "roomNumber"
     from members m join rooms r on r.id=m.room_id order by m.name`,
  );
  const changes = await many(
    `select member_id as "memberId", date::text as date, status, sehri from meal_status_changes order by date`,
  );
  const guestMeals = await many(
    `select member_id as "memberId", date::text as date, type, count from guest_meals order by date`,
  );
  const extras = await many(
    `select id, date::text as date, label, amount, category,
            show_in_daily_budget as "showInDailyBudget", voided,
            is_auto as "isAuto", source_key as "sourceKey"
     from extra_line_items order by date`,
  );
  const bills = (
    await many(`select month::text as month, type, amount from utility_bills`)
  ).map((r: any) => ({ ...r, month: monthOf(r.month) }));
  const deposits = await many(
    `select member_id as "memberId", date::text as date, amount from deposits`,
  );
  const settlements = (
    await many(
      `select member_id as "memberId", month::text as month,
              opening_balance as "openingBalance", closing_balance as "closingBalance"
       from monthly_settlements`,
    )
  ).map((r: any) => ({ ...r, month: monthOf(r.month) }));
  const openingBalances = (
    await many(`select member_id as "memberId", month::text as month, amount from opening_balances`)
  ).map((r: any) => ({ ...r, month: monthOf(r.month) }));
  const closedMonths = (await many(`select month::text as month from month_closes`)).map((r: any) =>
    monthOf(r.month),
  );
  const bazarDates = (await many(`select date::text as date from daily_bazar_records`)).map(
    (r: any) => r.date,
  );

  await client.query("COMMIT");
  await client.end();

  const today = todayKey();
  const month = monthOf(today);
  const settingsM = {
    hostelName: settings.hostel_name,
    address: settings.address,
    ramadanMode: settings.ramadan_mode,
    soloElectricityMultiplier: settings.solo_electricity_multiplier,
    soloWifiMultiplier: settings.solo_wifi_multiplier,
  };

  console.log("TODAY (Asia/Dhaka):", today, " MONTH:", month);
  console.log("RATE CARDS:", JSON.stringify(rateCards));
  console.log("BILLS:", JSON.stringify(bills));
  console.log(
    "EXTRAS:",
    JSON.stringify(
      extras.map((e: any) => ({ d: e.date, l: e.label, a: e.amount, auto: e.isAuto, voided: e.voided, src: e.sourceKey })),
    ),
  );
  console.log("BAZAR DATES:", JSON.stringify(bazarDates));
  console.log("CLOSED MONTHS:", JSON.stringify(closedMonths));
  console.log("MEMBERS/ROOMS:", JSON.stringify(members.map((m: any) => [m.name, m.roomNumber])));

  const apportionment = apportionUtilities({
    members: members as any,
    rooms: rooms as any,
    bills: bills as any,
    from: monthStart(month),
    to: monthEnd(month),
    soloElectricityMultiplier: settingsM.soloElectricityMultiplier,
    soloWifiMultiplier: settingsM.soloWifiMultiplier,
    today,
  });
  console.log("\n--- apportionUtilities ---", apportionment, "sum:", [...apportionment.byMember.values()].reduce((t, s) => t + s.total, 0));

  const computation = computeMonth({
    month,
    cutoff: monthEnd(month),
    finalize: true,
    members: members as any,
    rooms: rooms as any,
    changes: changes as any,
    guestMeals: guestMeals as any,
    extras: extras as any,
    bills: bills as any,
    rateCards: rateCards as any,
    ramadanMode: settingsM.ramadanMode,
    soloElectricityMultiplier: settingsM.soloElectricityMultiplier,
    soloWifiMultiplier: settingsM.soloWifiMultiplier,
    today,
  });
  const opening = openingBalancesFor({
    month,
    closedMonths: closedMonthSet(closedMonths),
    settlements: settlements as any,
    openingBalances: openingBalances as any,
  });
  const rows = buildSettlementRows({
    computation,
    members: members as any,
    rooms: rooms as any,
    deposits: deposits as any,
    openingBalances: opening,
  });

  console.log("\n--- Settlement rows (finalize: true) ---");
  console.table(
    rows.map((r: any) => ({
      room: r.roomNumber,
      name: r.memberName,
      full: r.fullMealCount,
      half: r.halfMealCount,
      gF: r.guestFullCount,
      gH: r.guestHalfCount,
      meal: r.mealAmount,
      khala: r.khalaAmount,
      elec: r.electricityAmount,
      wifi: r.wifiAmount,
      kw: r.khalaElecWifiAmount,
      extra: r.extraAmount,
      cost: r.totalCost,
      open: r.openingBalance,
      dep: r.newDeposits,
      close: r.closingBalance,
    })),
  );
  const sum = (f: (r: any) => number) => rows.reduce((t, r: any) => t + f(r), 0);
  console.log("SETTLEMENT TOTALS", {
    utilityColumn: sum((r) => r.khalaElecWifiAmount),
    extras: sum((r) => r.extraAmount),
    cost: sum((r) => r.totalCost),
    meal: sum((r) => r.mealAmount),
    khala: sum((r) => r.khalaAmount),
    elec: sum((r) => r.electricityAmount),
    wifi: sum((r) => r.wifiAmount),
    closing: sum((r) => r.closingBalance),
  });
  console.log("engine totals:", computation.totals);
  console.log("extraPool:", computation.extraPool);

  const running = computeRunningBalances({
    members: members as any,
    rooms: rooms as any,
    changes: changes as any,
    guestMeals: guestMeals as any,
    extras: extras as any,
    bills: bills as any,
    rateCards: rateCards as any,
    deposits: deposits as any,
    settlements: settlements as any,
    openingBalances: openingBalances as any,
    lastClosedMonth: closedMonths[0] ?? null,
    ramadanMode: settingsM.ramadanMode,
    soloElectricityMultiplier: settingsM.soloElectricityMultiplier,
    soloWifiMultiplier: settingsM.soloWifiMultiplier,
    today,
  });
  console.log("\n--- Balances (running) ---", running.periodStart, "→", running.periodEnd);
  console.table(
    running.rows.map((r: any) => ({
      room: r.roomNumber,
      name: r.memberName,
      open: r.openingBalance,
      dep: r.deposits,
      util: r.utilityCost,
      extra: r.extraCost,
      cost: r.cost,
      bal: r.balance,
    })),
  );
  console.log("BALANCES SUMMARY:", running.summary);

  for (const d of bazarDates) {
    const day = computeDayTotals({
      date: d,
      members: members as any,
      changes: changes as any,
      guestMeals: guestMeals as any,
      extras: extras as any,
      rateCard: rateCardFor(rateCards as any, d),
      today,
    });
    console.log(`\n--- computeDayTotals ${d} ---`);
    const { rateCard, extraItems, ...rest } = day;
    console.log(rest);
  }

  const reg = mealRegisterForMonth({
    month,
    members: members as any,
    rooms: rooms as any,
    changes: changes as any,
    today,
  });
  console.log("\n--- register rows ---");
  console.log(reg.rows.map((r: any) => ({ name: r.name, room: r.roomNumber, full: r.fullCount, half: r.halfCount })));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
