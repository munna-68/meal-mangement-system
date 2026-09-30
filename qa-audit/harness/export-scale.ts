/**
 * PHASE 4J — export layout at scale: 40 members with deliberately long names.
 *
 * The three exports are rasterised from off-screen DOM at a fixed pixel width,
 * so what matters is the natural width of the rendered element. This measures it.
 */
import { Client } from "pg";

const DB = process.env.QA_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:5434/postgres";
const APP = process.env.QA_APP ?? "http://127.0.0.1:3001";
const SECRET = "qa-isolated-audit-session-secret-0123456789abcdef";

const LONG = "Abdurrahman Muhammad Abdul Wadud Chowdhury";

async function main() {
  const c = new Client({ connectionString: DB });
  await c.connect();

  // A separate month so the existing scenario is untouched.
  const month = "2026-07";
  await c.query(`delete from meal_status_changes where date::text like '2026-07-%'`);
  await c.query(`delete from deposits where date::text like '2026-07-%'`);
  await c.query(`delete from guest_meals where date::text like '2026-07-%'`);
  await c.query(`delete from extra_line_items where date::text like '2026-07-%'`);
  await c.query(`delete from utility_bills where month::text like '2026-07%'`);
  await c.query(`delete from members where name like 'QA-Bulk%'`);

  // 40 rooms, 40 members, 2 per room -> nobody is alone, so utility is even.
  await c.query(
    `insert into rooms (number, capacity, solo)
     select (100 + g)::text, 2, false from generate_series(1, 20) g
     on conflict (number) do nothing`,
  );
  const rooms = (await c.query(`select id, number from rooms order by number`)).rows;
  const ids: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const room = rooms[i % rooms.length];
    const name = i % 4 === 0 ? `${LONG} ${i}` : `QA-Bulk ${String(i + 1).padStart(2, "0")}`;
    const [row] = (
      await c.query(
        `insert into members (name, room_id, active, join_date) values ($1,$2,true,'2026-07-01') returning id`,
        [name, room.id],
      )
    ).rows;
    ids.push(row.id);
    await c.query(`insert into meal_status_changes (member_id,date,status,sehri) values ($1,'2026-07-01','FULL',false)`, [row.id]);
  }
  await c.query(`insert into utility_bills (month,type,amount) values ('2026-07-01','ELECTRICITY',600000),('2026-07-01','WIFI',15000)`);
  for (let i = 0; i < 31; i += 1) {
    const d = `2026-07-${String(i + 1).padStart(2, "0")}`;
    await c.query(
      `insert into extra_line_items (date,label,amount,category,show_in_daily_budget,is_auto,source_key)
       values ($1,'Daily recurring Extra',300,'RECURRING_DAILY',true,true,$2)`,
      [d, `auto:daily-extra:${d}`],
    );
  }
  await c.query(`insert into deposits (member_id,date,amount) select id,'2026-07-05',9000 from members where name like 'QA-Bulk%' limit 1`);
  note("seeded 40 members with long names into 2026-07");

  const [owner] = (await c.query(`select id, username, role from accounts where username='qaowner'`)).rows;
  const cookie = `meal_session=${await import("jose").then(({ SignJWT }) =>
    new SignJWT({ sub: owner.id, username: owner.username, name: "QA Owner", role: owner.role })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(SECRET)),
  )}`;

  for (const path of [`/settlement?month=${month}`, "/balances"]) {
    const html = await (await fetch(`${APP}${path}`, { headers: { cookie } })).text();
    const count = (html.match(/ledger-sheet|meal-register-sheet|balance-sheet/g) ?? []).length;
    const rows = (html.match(/<tr/g) ?? []).length;
    const longNameShown = html.includes(LONG);
    console.log(`\n${path}`);
    console.log(`   sheets rendered: ${count > 0 ? "yes" : "no"}`);
    console.log(`   <tr> elements in the HTML: ${rows}`);
    console.log(`   a 38-character member name appears in full: ${longNameShown ? "yes" : "no"}`);
    console.log(`   any CSS truncation class on a name cell: ${/truncate/.test(html) ? "yes (screen only)" : "no"}`);
  }

  console.log(`
Reading the CSS: the export sheets set a fixed pixel width and no max-width, and
the PDF button scales the rasterised canvas to fit the page in BOTH directions
(pdf-button.tsx:44). So a 40-row ledger does not overflow the page — it is
shrunk to fit, which makes the Bengali type progressively smaller and harder to
read on paper. There is no pagination and no page-break rule anywhere in the
three sheet stylesheets, so a 40-member ledger is one illegibly small page.

Next: measure the actual scale factor at 12 and at 40 members so the report can
state how much smaller the text becomes.`);

  await c.end();
}

function note(s: string) {
  console.log(s);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
