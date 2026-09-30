/**
 * Cross-page consistency table for the OWNER'S OWN current data (the QA
 * snapshot of the development database, read-only).
 *
 * Reproduces every place each figure appears, using the app's real functions,
 * so the report can state "page X shows N" for the data the owner is looking at.
 */
import { Client } from "pg";

import {
  buildSettlementRows,
  computeDayTotals,
  computeMonth,
  computeRunningBalances,
  extraPoolForRange,
  mealRegisterForMonth,
  rateCardFor,
} from "../../src/lib/calc";
import { closedMonthSet, openingBalancesFor } from "../../src/lib/locks";
import { monthOf, monthStart, monthEnd, todayKey } from "../../src/lib/dates";
import { formatTaka } from "../../src/lib/money";

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
            m.leave_date::text as "leaveDate", r.number as "roomNumber", r.capacity as "roomCapacity"
     from members m join rooms r on r.id=m.room_id order by m.name`,
  );
  const changes = await many(`select member_id as "memberId", date::text as date, status, sehri from meal_status_changes order by date`);
  const guestMeals = await many(`select member_id as "memberId", date::text as date, type, count from guest_meals order by date`);
  const extras = await many(
    `select id, date::text as date, label, amount, category, show_in_daily_budget as "showInDailyBudget",
            voided, is_auto as "isAuto", source_key as "sourceKey"
     from extra_line_items where category <> 'MANAGER_FEE' and coalesce(source_key,'') not like 'auto:manager-fee:%' order by date`,
  );
  const bills = (await many(`select month::text as month, type, amount from utility_bills`)).map((r: any) => ({ ...r, month: monthOf(r.month) }));
  const deposits = await many(`select member_id as "memberId", date::text as date, amount from deposits`);
  const settlements: any[] = [];
  const openingBalances: any[] = [];
  const closedMonths: string[] = [];
  const bazarDates = (await many(`select date::text as date from daily_bazar_records`)).map((r: any) => r.date);
  await client.query("COMMIT");
  await client.end();

  const today = todayKey();
  const month = monthOf(today);
  const soloElec = settings.solo_electricity_multiplier;
  const soloWifi = settings.solo_wifi_multiplier;

  const comp = computeMonth({
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
    soloElectricityMultiplier: soloElec,
    soloWifiMultiplier: soloWifi,
    today,
  });
  const rows = buildSettlementRows({
    computation: comp,
    members: members as any,
    rooms: rooms as any,
    deposits: deposits as any,
    openingBalances: openingBalancesFor({
      month,
      closedMonths: closedMonthSet(closedMonths),
      settlements,
      openingBalances,
    }),
  });
  const running = computeRunningBalances({
    members: members as any,
    rooms: rooms as any,
    changes: changes as any,
    guestMeals: guestMeals as any,
    extras: extras as any,
    bills: bills as any,
    rateCards: rateCards as any,
    deposits: deposits as any,
    settlements,
    openingBalances,
    lastClosedMonth: null,
    soloElectricityMultiplier: soloElec,
    soloWifiMultiplier: soloWifi,
    today,
  });
  const pool = extraPoolForRange({
    extras: extras as any,
    from: monthStart(month),
    to: comp.cutoff,
    activeMemberIds: comp.activeMemberIds,
  });

  // The Extras page's own formulas, copied verbatim from
  // src/app/(app)/extras/page.tsx (lines 127-172).
  const safeExtras = extras as any[];
  const monthExtras = safeExtras.filter((e) => monthOf(e.date) === month && !e.voided);
  const recurringTotal = monthExtras.filter((e) => e.isAuto).reduce((t, e) => t + e.amount, 0);
  const manualTotal = monthExtras.filter((e) => !e.isAuto).reduce((t, e) => t + e.amount, 0);
  const boarderCount = comp.activeMemberIds.length;
  const extrasPageTotal = recurringTotal + manualTotal;
  const extrasPagePerHead = boarderCount > 0 ? Math.round(extrasPageTotal / boarderCount) : 0;

  const elecBill = bills.filter((b) => b.month === month && b.type === "ELECTRICITY").reduce((t, b) => t + b.amount, 0);
  const wifiBill = bills.filter((b) => b.month === month && b.type === "WIFI").reduce((t, b) => t + b.amount, 0);
  const khalaComputed = [...comp.perMember.values()].reduce((t, r) => t + r.khalaAmount, 0);
  const utilityPageTotal = elecBill + wifiBill + khalaComputed;
  const utilityPagePerHead = boarderCount > 0 ? Math.round(utilityPageTotal / boarderCount) : 0;

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
  const day = bazarDates.length
    ? computeDayTotals({
        date: bazarDates[0],
        members: members as any,
        changes: changes as any,
        guestMeals: guestMeals as any,
        extras: extras as any,
        rateCard: rateCardFor(rateCards as any, bazarDates[0]),
        today,
      })
    : null;
  const reg = mealRegisterForMonth({
    month,
    members: members as any,
    rooms: rooms as any,
    changes: changes as any,
    today,
  });

  const out = {
    today,
    month,
    meters: {
      "Meal cost today (Meal Status card)": day ? day.mealsSubtotal : null,
      "Bazar budget (Today page + slip)": day ? day.totalBudget : null,
      "guest deduction applied on the bazar slip": day ? day.guestDeductionAmount : null,
      "manager fee held back from bazar cash": day ? day.managerFeeAmount : null,
      "Settlement: sum of member meal charges": comp.totals.mealAmount,
      "Settlement: Khala+Wifi+Electricity column total": sum((r) => r.khalaElecWifiAmount),
      "Settlement: Extras share column total": sum((r) => r.extraAmount),
      "Settlement: Total cost column total": sum((r) => r.totalCost),
      "Settlement: closing balance total": sum((r) => r.closingBalance),
      "Extras & Bills: extras pool total": extrasPageTotal,
      "Extras & Bills: extras per head": extrasPagePerHead,
      "Extras & Bills: utility pool total": utilityPageTotal,
      "Extras & Bills: utility per head (FLAT)": utilityPagePerHead,
      "engine: extras pool total": pool.total,
      "engine: extras per member": pool.perMember,
      "Balances: utility cost total": running.summary.utilityCost,
      "Balances: extra cost total": running.summary.extraCost,
      "Balances: accrued cost total": running.summary.cost,
      "Balances: Mess float": running.summary.balance,
      "Pool: electricity entered": elecBill,
      "Pool: wifi entered": wifiBill,
      "Pool: khala (computed from the rate card)": khalaComputed,
      "Pool: utility total (electricity + wifi + khala)": elecBill + wifiBill + khalaComputed,
      "Distinct per-member utility shares actually charged": [
        ...new Set(rows.map((r) => r.khalaElecWifiAmount)),
      ],
      "Register: total full days": reg.rows.reduce((t, r) => t + r.fullCount, 0),
      "Settlement: total full days": comp.totals.fullMealCount,
      "Register: total half days": reg.rows.reduce((t, r) => t + r.halfCount, 0),
      "Settlement: total half days": comp.totals.halfMealCount,
      "Settlement: guest full / half": `${comp.totals.guestFullCount} / ${comp.totals.guestHalfCount}`,
    },
  };
  console.log(JSON.stringify(out, null, 2));
  void formatTaka;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
