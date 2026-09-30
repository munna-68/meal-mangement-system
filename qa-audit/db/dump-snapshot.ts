/**
 * Read-only dump of the QA snapshot database. Connects to the *copy* on 5433.
 * Every statement is a SELECT; nothing is ever written.
 */
import { Client } from "pg";

const URL = process.env.QA_SNAPSHOT_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/postgres";

async function main() {
  const client = new Client({ connectionString: URL });
  await client.connect();
  const only = process.argv[2];
  const q = async (label: string, sql: string) => {
    if (only && !label.toLowerCase().includes(only.toLowerCase())) return;
    const res = await client.query(sql);
    console.log(`\n===== ${label} =====`);
    console.log(JSON.stringify(res.rows, null, 1));
  };

  await client.query("BEGIN READ ONLY");

  await q("tables", `select table_name from information_schema.tables where table_schema='public' order by 1`);
  await q(
    "mess_settings",
    `select * from mess_settings`,
  );
  await q(
    "rate_cards",
    `select id, label, effective_from, effective_to, full_meal_rate, half_meal_rate,
            guest_full_rate, guest_half_rate, sehri_rate, feast_flat_charge,
            khala_normal_rate, khala_solo_rate, manager_daily_fee, daily_extra_amount
     from rate_cards order by effective_from`,
  );
  await q(
    "rooms",
    `select id, number, capacity, solo, notes from rooms order by number`,
  );
  await q(
    "members",
    `select id, name, room_id, phone, blood_group, active, join_date, leave_date, notes from members order by name`,
  );
  await q(
    "members_with_room",
    `select m.name, r.number as room, r.capacity, r.solo, m.active, m.join_date, m.leave_date
     from members m join rooms r on r.id=m.room_id order by r.number, m.name`,
  );
  await q(
    "status_change_counts",
    `select member_id, count(*) as n, min(date) as first, max(date) as last from meal_status_changes group by 1 order by 1`,
  );
  await q(
    "status_changes_all",
    `select c.member_id, m.name, c.date, c.status, c.sehri from meal_status_changes c
     join members m on m.id=c.member_id order by c.date, m.name`,
  );
  await q("guest_meals", `select g.member_id, m.name, g.date, g.type, g.count from guest_meals g join members m on m.id=g.member_id order by g.date`);
  await q(
    "utility_bills",
    `select month, type, amount from utility_bills order by month, type`,
  );
  await q(
    "deposits",
    `select d.member_id, m.name, d.date, d.amount, d.notes from deposits d join members m on m.id=d.member_id order by d.date, m.name`,
  );
  await q(
    "opening_balances",
    `select o.member_id, m.name, o.month, o.amount, o.notes from opening_balances o join members m on m.id=o.member_id order by o.month, m.name`,
  );
  await q(
    "extras_manual",
    `select date, label, amount, category, show_in_daily_budget, is_auto, source_key, voided
     from extra_line_items where is_auto = false order by date, created_at`,
  );
  await q(
    "extras_auto_summary",
    `select date, label, amount, category, show_in_daily_budget, source_key, voided, count(*)
     from extra_line_items where is_auto = true group by 1,2,3,4,5,6,7 order by date`,
  );
  await q(
    "extras_auto_daily_range",
    `select min(date) as first, max(date) as last, count(*) as rows,
            count(*) filter (where voided) as voided,
            sum(amount) as total
     from extra_line_items where is_auto = true`,
  );
  await q("bazar_records", `select * from daily_bazar_records order by date`);
  await q("month_closes", `select month, notes, closed_at, closed_by, register_snapshot is not null as has_register from month_closes order by month`);
  await q(
    "monthly_settlements",
    `select month, room_number, member_name, full_meal_count, half_meal_count, sehri_count,
            guest_full_count, guest_half_count, meal_amount, khala_amount, electricity_amount,
            wifi_amount, khala_elec_wifi_amount, extra_amount, total_cost,
            opening_balance, new_deposits, available_balance, closing_balance
     from monthly_settlements order by month, room_number, member_name`,
  );
  await q(
    "settlement_totals",
    `select month, sum(meal_amount) meal, sum(khala_amount) khala, sum(electricity_amount) elec,
            sum(wifi_amount) wifi, sum(khala_elec_wifi_amount) kw, sum(extra_amount) extra,
            sum(total_cost) cost, sum(closing_balance) closing, count(*) n
     from monthly_settlements group by month order by month`,
  );
  await q("accounts", `select id, username, display_name, role, active, created_at from accounts order by username`);
  await q("audit_log", `select actor_name, action, entity_type, entity_id, summary, created_at from audit_log order by created_at`);
  await q("login_attempts", `select username, succeeded, reason, created_at from login_attempts order by created_at`);

  await client.query("COMMIT");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
