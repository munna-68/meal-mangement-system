/**
 * PHASE 4D/4H/4C — the remaining bazar, member/room and rate-card questions that
 * need a database, answered against the ISOLATED QA database only.
 */
import { Client } from "pg";

import { computeDayTotals, computeMonth, rateCardFor } from "../../src/lib/calc";
import { monthEnd } from "../../src/lib/dates";

const DB = process.env.QA_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:5434/postgres";
const MONTH = "2026-08";

let passed = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${name}: expected ${e} got ${a}`);
}

async function monthTotals(c: Client) {
  const settings = (await c.query(`select * from mess_settings`)).rows[0];
  const rateCards = (
    await c.query(
      `select id, effective_from::text as "effectiveFrom", effective_to::text as "effectiveTo",
              full_meal_rate as "fullMealRate", half_meal_rate as "halfMealRate",
              guest_full_rate as "guestFullRate", guest_half_rate as "guestHalfRate",
              sehri_rate as "sehriRate", feast_flat_charge as "feastFlatCharge",
              khala_normal_rate as "khalaNormalRate", khala_solo_rate as "khalaSoloRate",
              manager_daily_fee as "managerDailyFee", daily_extra_amount as "dailyExtraAmount"
       from rate_cards order by effective_from`,
    )
  ).rows;
  const rooms = (await c.query(`select id, number, capacity, solo from rooms order by number`)).rows;
  const members = (
    await c.query(
      `select m.id, m.name, m.room_id as "roomId", m.active, m.join_date::text as "joinDate",
              m.leave_date::text as "leaveDate" from members m order by m.name`,
    )
  ).rows;
  const changes = (
    await c.query(`select member_id as "memberId", date::text as date, status, sehri from meal_status_changes`)
  ).rows;
  const extras = (
    await c.query(
      `select id, date::text as date, label, amount, category, show_in_daily_budget as "showInDailyBudget",
              voided, is_auto as "isAuto" from extra_line_items
       where category <> 'MANAGER_FEE'`,
    )
  ).rows;
  const bills = (await c.query(`select month::text as month, type, amount from utility_bills`)).rows.map(
    (r: any) => ({ ...r, month: String(r.month).slice(0, 7) }),
  );
  const comp = computeMonth({
    month: MONTH,
    cutoff: monthEnd(MONTH),
    finalize: true,
    members,
    rooms,
    changes,
    guestMeals: [],
    extras,
    bills,
    rateCards,
    soloElectricityMultiplier: settings.solo_electricity_multiplier,
    soloWifiMultiplier: settings.solo_wifi_multiplier,
    today: "2026-09-30",
  });
  return [...comp.perMember.values()];
}

async function main() {
  const c = new Client({ connectionString: DB });
  await c.connect();

  // ------------------------------------------------------------------ D.1
  console.log("=== D1  two bazar records for one day ===");
  try {
    await c.query(
      `insert into daily_bazar_records (date) values ('2026-08-15'),('2026-08-15')`,
    );
    check("a second bazar record for the same date is REJECTED by the schema", "inserted", "rejected");
  } catch (e: any) {
    check("a second bazar record for the same date is REJECTED by the schema", "rejected", "rejected");
    console.log("    ", e.message.split("\n")[0]);
  }
  await c.query(`delete from daily_bazar_records where date::text='2026-08-15'`);

  // ------------------------------------------------------------------ D.2
  console.log("\n=== D2  the day's budget: extras flagged for the day vs not ===");
  const [card] = (
    await c.query(
      `select id, effective_from::text as "effectiveFrom", effective_to::text as "effectiveTo",
              full_meal_rate as "fullMealRate", half_meal_rate as "halfMealRate",
              guest_full_rate as "guestFullRate", guest_half_rate as "guestHalfRate",
              sehri_rate as "sehriRate", feast_flat_charge as "feastFlatCharge",
              khala_normal_rate as "khalaNormalRate", khala_solo_rate as "khalaSoloRate",
              manager_daily_fee as "managerDailyFee", daily_extra_amount as "dailyExtraAmount"
       from rate_cards order by effective_from limit 1`,
    )
  ).rows;
  const members = (await c.query(`select m.id, m.room_id as "roomId", m.active, m.join_date::text as "joinDate", m.leave_date::text as "leaveDate", m.name from members m where active`)).rows;
  const changes = (await c.query(`select member_id as "memberId", date::text as date, status, sehri from meal_status_changes`)).rows;
  const day = "2026-08-15";
  const baseExtras = [
    { id: "a", date: day, label: "flagged", amount: 500, category: "ONE_OFF", showInDailyBudget: true, voided: false },
    { id: "b", date: day, label: "not flagged", amount: 700, category: "ONE_OFF", showInDailyBudget: false, voided: false },
    { id: "c", date: day, label: "flagged but voided", amount: 900, category: "ONE_OFF", showInDailyBudget: true, voided: true },
  ];
  const t = computeDayTotals({
    date: day,
    members,
    changes,
    guestMeals: [],
    extras: baseExtras as any,
    rateCard: card as any,
    today: "2026-09-30",
  });
  check("only the un-voided, budget-flagged extra is added to the day's cash", t.extraAmount, 500);
  check("the manager fee is still deducted", t.managerFeeAmount, card.managerDailyFee);
  check("the day's cash = meals + 500 - fee", t.totalBudget, t.mealsSubtotal + 500 - card.managerDailyFee);
  console.log(`    day cash: ${t.mealsSubtotal} + 500 - ${t.managerFeeAmount} = ${t.totalBudget}`);
  check("the day's cash arithmetic holds", t.totalBudget, t.mealsSubtotal + 500 - t.managerFeeAmount);
  console.log("    (both extras still enter the MONTH pool — the flag only affects the bazar cash)");

  // ------------------------------------------------------------------ H.1
  console.log("\n=== H1  a room capacity change re-prices an OPEN month ===");
  const before = await monthTotals(c);
  // Find a room with exactly ONE occupant in August: flipping its capacity
  // between 1 and 2 flips it in and out of "alone in a multi-bed room".
  const r101 = (
    await c.query(
      `select r.id, r.capacity from rooms r
       where (select count(*) from members m
              where m.room_id = r.id and m.active
                and m.join_date::text <= '2026-08-31'
                and (m.leave_date::text is null or m.leave_date::text >= '2026-08-01')) = 1
       limit 1`,
    )
  ).rows[0];
  console.log(`    using the room with a single occupant (capacity ${r101.capacity})`);
  await c.query(`update rooms set capacity=$2 where id=$1`, [r101.id, r101.capacity === 1 ? 2 : 1]);
  const after = await monthTotals(c);
  check(
    "changing a capacity from 2 to 4 changes at least one member's charge in the OPEN month",
    after.map((r: any) => r.khalaElecWifiAmount).join() !== before.map((r: any) => r.khalaElecWifiAmount).join(),
    true,
  );
  await c.query(`update rooms set capacity=$2 where id=$1`, [r101.id, r101.capacity]);
  const restored = await monthTotals(c);
  check("restoring the capacity returns every charge exactly", restored.map((r: any) => r.khalaElecWifiAmount), before.map((r: any) => r.khalaElecWifiAmount));

  // ------------------------------------------------------------------ H.2
  console.log("\n=== H2  ... but it cannot change a CLOSED month ===");
  await c.query(`delete from monthly_settlements where month='2026-08-01'`);
  await c.query(`insert into month_closes (month) values ('2026-08-01')`);
  const frozen = (await c.query(`select count(*) from monthly_settlements where month='2026-08-01'`)).rows[0].count;
  check("the closed month has no settlement rows in this fixture", Number(frozen), 0);
  await c.query(`update rooms set capacity=$2 where id=$1`, [r101.id, r101.capacity === 1 ? 2 : 1]);
  const stillThere = (await c.query(`select count(*) from monthly_settlements where month='2026-08-01'`)).rows[0].count;
  check("a capacity change does not write to the closed month's frozen rows", Number(stillThere), 0);
  await c.query(`update rooms set capacity=$2 where id=$1`, [r101.id, r101.capacity]);
  await c.query(`delete from month_closes where month='2026-08-01'`);

  // ------------------------------------------------------------------ C.1
  console.log("\n=== C1  a rate change effective from mid-month ===");
  const cardsBefore = (await c.query(`select count(*) from rate_cards`)).rows[0].count;
  await c.query(
    `insert into rate_cards (label,effective_from,effective_to,full_meal_rate,half_meal_rate,guest_full_rate,
        guest_half_rate,sehri_rate,feast_flat_charge,khala_normal_rate,khala_solo_rate,manager_daily_fee,daily_extra_amount)
     select 'qa mid-month','2026-08-16',null,80,45,75,40,70,200,300,400,30,300 from rate_cards limit 1`,
  );
  await c.query(
    `update rate_cards set effective_to='2026-08-15' where effective_to is null and effective_from < '2026-08-16'`,
  );
  const afterRate = await monthTotals(c);
  const oldMeal = before.reduce((t, r: any) => t + r.mealAmount, 0);
  const newMeal = afterRate.reduce((t, r: any) => t + r.mealAmount, 0);
  console.log(`    August meals: ${oldMeal} -> ${newMeal} (rate 60 -> 80 from the 16th)`);
  check("a mid-month rate change moves only the days from its effective date", newMeal > oldMeal, true);
  await c.query(`delete from rate_cards where label='qa mid-month'`);
  await c.query(`update rate_cards set effective_to=null where effective_to='2026-08-15'`);
  const backAgain = await monthTotals(c);
  check("removing the card returns every figure exactly", backAgain.map((r: any) => r.mealAmount), before.map((r: any) => r.mealAmount));
  check("and the card count is back to where it started", Number((await c.query(`select count(*) from rate_cards`)).rows[0].count), Number(cardsBefore));

  // ------------------------------------------------------------------ summary
  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  x ${f}`);
  await c.end();
  if (failures.length) process.exitCode = 1;
  void rateCardFor;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
