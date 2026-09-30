/**
 * Seeds the ISOLATED QA database with a controlled, hand-checkable scenario.
 *
 * The isolated database is qa-audit/.pglite-qa on port 5434. Nothing here ever
 * touches the development database.
 *
 * The scenario is deliberately small enough to check by hand on paper:
 *
 *   Rooms: 101 (cap 2, shared), 102 (cap 2, shared), 205 (cap 1)
 *   Members: A, B in 101; C, D in 102; E alone in 205
 *   July and August are finished; September is the current month.
 */
import { Client } from "pg";

const URL = process.env.QA_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:5434/postgres";

async function main() {
  const c = new Client({ connectionString: URL });
  await c.connect();

  const wipe = [
    "month_closes",
    "monthly_settlements",
    "opening_balances",
    "deposits",
    "utility_bills",
    "extra_line_items",
    "guest_meals",
    "meal_status_changes",
    "daily_bazar_records",
    "bazar_duty_rooms",
    "bazar_duties",
    "members",
    "rooms",
    "rate_cards",
    "mess_settings",
    "audit_log",
    "login_attempts",
  ];
  for (const t of wipe) await c.query(`delete from ${t}`);

  await c.query(
    `insert into mess_settings (id, hostel_name, address, ramadan_mode, solo_electricity_multiplier, solo_wifi_multiplier)
     values (1, 'QA TEST HOSTEL', 'QA TEST ADDRESS', false, 2, 1)`,
  );

  const cards: Array<[string, string, string | null, number[]]> = [
    [
      "QA card A (from 2026-07-01)",
      "2026-07-01",
      null,
      [60, 35, 75, 40, 70, 200, 300, 400, 30, 300],
    ],
  ];
  for (const [label, from, to, v] of cards) {
    await c.query(
      `insert into rate_cards (label, effective_from, effective_to, full_meal_rate, half_meal_rate,
        guest_full_rate, guest_half_rate, sehri_rate, feast_flat_charge, khala_normal_rate,
        khala_solo_rate, manager_daily_fee, daily_extra_amount)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [label, from, to, ...v],
    );
  }

  const rooms: Array<[string, number, boolean]> = [
    ["101", 2, false],
    ["102", 2, false],
    ["205", 1, false],
  ];
  const roomId: Record<string, string> = {};
  for (const [num, cap, solo] of rooms) {
    const r = await c.query(
      `insert into rooms (number, capacity, solo) values ($1,$2,$3) returning id`,
      [num, cap, solo],
    );
    roomId[num] = r.rows[0].id;
  }

  const people: Array<[string, string, string, string | null]> = [
    // name, room, join, leave
    ["QA-A", "101", "2026-07-01", null],
    ["QA-B", "101", "2026-07-01", null],
    ["QA-C", "102", "2026-07-01", null],
    ["QA-D", "102", "2026-07-01", null],
    // QA-E joins LATE in September — the classic case that must be prorated.
    ["QA-E", "205", "2026-09-20", null],
  ];
  const memberId: Record<string, string> = {};
  for (const [name, room, join, leave] of people) {
    const r = await c.query(
      `insert into members (name, room_id, active, join_date, leave_date)
       values ($1,$2,$3,$4,$5) returning id`,
      [name, roomId[room], leave === null, join, leave],
    );
    memberId[name] = r.rows[0].id;
  }

  // Statuses: everyone FULL for July and August. In September:
  //   A FULL, B HALF_DAY from the 1st, C OFF from the 1st,
  //   D HALF_NIGHT from the 1st, E joins late (2026-09-20) and is FULL.
  const statusRows: Array<[string, string, string]> = [];
  for (const name of ["QA-A", "QA-B", "QA-C", "QA-D"]) {
    statusRows.push([memberId[name], "2026-07-01", "FULL"]);
  }
  statusRows.push([memberId["QA-A"], "2026-09-01", "FULL"]);
  statusRows.push([memberId["QA-B"], "2026-09-01", "HALF_DAY"]);
  statusRows.push([memberId["QA-C"], "2026-09-01", "OFF"]);
  statusRows.push([memberId["QA-D"], "2026-09-01", "HALF_NIGHT"]);
  statusRows.push([memberId["QA-E"], "2026-09-20", "FULL"]);
  // A member who LEFT on the 3rd of September and is therefore present 3 days.
  const leaver = await c.query(
    `insert into members (name, room_id, active, join_date, leave_date)
     values ('QA-F',$1,false,'2026-07-01','2026-09-03') returning id`,
    [roomId["102"]],
  );
  memberId["QA-F"] = leaver.rows[0].id;
  statusRows.push([memberId["QA-F"], "2026-07-01", "FULL"]);
  for (const [id, date, status] of statusRows) {
    await c.query(
      `insert into meal_status_changes (member_id, date, status, sehri) values ($1,$2,$3,false)`,
      [id, date, status],
    );
  }

  // Guest meals: 1 full guest on 2026-09-10 for A, 2 half guests for D.
  await c.query(
    `insert into guest_meals (member_id, date, type, count) values ($1,'2026-09-10','GUEST_FULL',1)`,
    [memberId["QA-A"]],
  );
  await c.query(
    `insert into guest_meals (member_id, date, type, count) values ($1,'2026-09-11','GUEST_HALF',2)`,
    [memberId["QA-D"]],
  );

  // Utility bills, deliberately awkward so the splits cannot divide evenly.
  await c.query(
    `insert into utility_bills (month, type, amount) values
       ('2026-07-01','ELECTRICITY',6301), ('2026-07-01','WIFI',1001),
       ('2026-08-01','ELECTRICITY',5000),  ('2026-08-01','WIFI',999),
       ('2026-09-01','ELECTRICITY',6301),  ('2026-09-01','WIFI',1001)`,
  );

  // Confirmed bazar days in September, each with its auto recurring extra.
  const bazarDays = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-10", "2026-09-11", "2026-09-12"];
  for (const d of bazarDays) {
    await c.query(
      `insert into daily_bazar_records (date, full_meal_count, full_meal_amount, half_meal_count,
        half_meal_amount, guest_full_count, guest_full_amount, guest_half_count, guest_half_amount,
        extra_amount, total_budget, deduction_amount, advance_given, actual_expense, change_returned)
       values ($1,0,0,0,0,0,0,0,0,300,0,0,0,0,0)`,
      [d],
    );
    await c.query(
      `insert into extra_line_items (date, label, amount, category, show_in_daily_budget, is_auto, source_key)
       values ($1,'Daily recurring Extra',300,'RECURRING_DAILY',true,true,$2)`,
      [d, `auto:daily-extra:${d}`],
    );
  }
  // A manual extra that does not divide evenly: 1,237 over 5 members.
  await c.query(
    `insert into extra_line_items (date, label, amount, category, show_in_daily_budget, is_auto)
     values ('2026-09-15','QA fridge repair',1237,'ONE_OFF',false,false)`,
  );
  // July and August recurring extras, 3 days each.
  for (const d of ["2026-07-05", "2026-07-06", "2026-07-07", "2026-08-05", "2026-08-06"]) {
    await c.query(
      `insert into extra_line_items (date, label, amount, category, show_in_daily_budget, is_auto, source_key)
       values ($1,'Daily recurring Extra',300,'RECURRING_DAILY',true,true,$2)`,
      [d, `auto:daily-extra:${d}`],
    );
  }

  // Deposits, including one that spans into September and one zero.
  await c.query(
    `insert into deposits (member_id, date, amount, notes) values
       ($1,'2026-07-03',5000,'july'),
       ($2,'2026-07-03',3000,'july'),
       ($3,'2026-08-03',4000,'august'),
       ($4,'2026-08-20',0,'zero deposit'),
       ($5,'2026-09-05',2500,'september')`,
    [memberId["QA-A"], memberId["QA-B"], memberId["QA-C"], memberId["QA-D"], memberId["QA-E"]],
  );

  // An opening balance for the very first month.
  await c.query(
    `insert into opening_balances (month, member_id, amount, notes) values ('2026-07-01',$1,-500,'QA opening')`,
    [memberId["QA-B"]],
  );

  const summary = await c.query(
    `select
       (select count(*) from rooms) rooms,
       (select count(*) from members) members,
       (select count(*) from meal_status_changes) changes,
       (select count(*) from guest_meals) guests,
       (select count(*) from extra_line_items) extras,
       (select count(*) from utility_bills) bills,
       (select count(*) from deposits) deposits,
       (select count(*) from daily_bazar_records) bazars,
       (select count(*) from month_closes) closes`,
  );
  console.log("[qa-seed] QA database seeded:", summary.rows[0]);
  console.log("[qa-seed] member ids:", memberId);
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
