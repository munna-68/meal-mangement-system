/**
 * Security probes that need a session cookie but no browser interaction.
 *
 * Mints a JWT the same way `src/lib/session.ts` does, then walks the app with
 * curl-equivalent requests to answer:
 *   - can a token for a non-existent / deactivated account still be used?
 *   - does the proxy trust the token even when the account is gone?
 *   - is any secret reachable from the client bundle?
 *
 * Nothing here writes to the database except where a test explicitly says so,
 * and every write happens in the isolated QA database on port 5434.
 */
import { Client } from "pg";
import { SignJWT } from "jose";

const APP = process.env.QA_APP ?? "http://127.0.0.1:3001";
const DB = process.env.QA_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:5434/postgres";
const SECRET = "qa-isolated-audit-session-secret-0123456789abcdef";

async function token(sub: string, role: string, username = "qaowner", name = "QA Owner") {
  return new SignJWT({ sub, username, name, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(SECRET));
}

async function get(path: string, cookie?: string) {
  const res = await fetch(`${APP}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
  const body = await res.text();
  return { status: res.status, location: res.headers.get("location"), body };
}

async function main() {
  const db = new Client({ connectionString: DB });
  await db.connect();
  const [owner] = (await db.query(`select id, username, role from accounts where username='qaowner'`)).rows;

  console.log("=== N1. token for an account that does not exist ===");
  const ghost = await token("00000000-0000-0000-0000-000000000000", "OWNER");
  const g1 = await get("/settlement?month=2026-09", `meal_session=${ghost}`);
  const g2 = await get("/login", `meal_session=${ghost}`);
  console.log(`  /settlement -> ${g1.status} ${g1.location ?? ""}`);
  console.log(`  /login      -> ${g2.status} ${g2.location ?? ""}`);
  console.log(
    g1.status === 307 && g2.status === 307 && String(g2.location).includes("/today")
      ? "  RESULT: REDIRECT LOOP — proxy trusts the token, requireSession() rejects the account"
      : "  RESULT: no loop",
  );

  console.log("\n=== N2. token for an account that exists but is deactivated ===");
  await db.query(`update accounts set active=false where username='qaowner'`);
  const live = await token(owner.id, owner.role);
  const d1 = await get("/settlement?month=2026-09", `meal_session=${live}`);
  const d2 = await get("/login", `meal_session=${live}`);
  console.log(`  /settlement -> ${d1.status} ${d1.location ?? ""}`);
  console.log(`  /login      -> ${d2.status} ${d2.location ?? ""}`);
  await db.query(`update accounts set active=true where username='qaowner'`);

  console.log("\n=== N3. token signed with the WRONG key ===");
  const forged = await new SignJWT({ sub: owner.id, username: "qaowner", name: "QA Owner", role: "OWNER" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode("not-the-real-secret-at-all-000000000000"));
  const f = await get("/settlement?month=2026-09", `meal_session=${forged}`);
  console.log(`  /settlement -> ${f.status} ${f.location ?? ""}  ${f.status === 307 ? "REJECTED (good)" : "ACCEPTED (bad)"}`);

  console.log("\n=== N4. role escalation: a MANAGER token claiming to be OWNER ===");
  const [mgr] = (await db.query(`select id from accounts where username='qamanager'`)).rows;
  const escalated = await token(mgr.id, "OWNER", "qamanager", "QA Manager");
  const e = await get("/settings", `meal_session=${escalated}`);
  const hasPanel = e.body.includes("Accounts") || e.body.includes("sign-in");
  console.log(`  /settings as forged-OWNER -> ${e.status}; account panel present: ${hasPanel}`);
  console.log(
    hasPanel ? "  RESULT: UI shows the panel" : "  RESULT: UI hides it (server action would still refuse)",
  );

  console.log("\n=== N5. every route, no cookie ===");
  const routes = [
    "/", "/today", "/meals", "/balances", "/settlement", "/settlement?month=2026-08",
    "/extras", "/deposits", "/members", "/roster", "/rates", "/settings", "/audit",
    "/login", "/api/health", "/api/session", "/_next/static/chunks/app/layout.js",
  ];
  for (const r of routes) {
    const res = await get(r);
    const leaks = /৳|QA-A|QA-B|Electricity|Mess float/i.test(res.body);
    console.log(`  ${r.padEnd(42)} ${String(res.status).padEnd(4)} leak=${leaks ? "YES" : "no"}`);
  }

  console.log("\n=== N6. does the client bundle leak any secret? ===");
  const layout = await get("/_next/static/chunks/app/layout.js");
  const login = await get("/login");
  const chunkUrls = [...login.body.matchAll(/\/_next\/static\/chunks\/[a-zA-Z0-9._-]+\.js/g)].map((m) => m[0]);
  const needles = ["SESSION_SECRET", "DATABASE_URL", "ADMIN_PIN", "ADMIN_PASSWORD", SECRET, "127.0.0.1:5434", "qa-audit-password"];
  let found = false;
  for (const url of new Set(chunkUrls)) {
    const js = await get(url);
    for (const needle of needles) {
      if (js.body.includes(needle)) {
        console.log(`  LEAK: ${needle} found in ${url}`);
        found = true;
      }
    }
  }
  // Also check the server-rendered HTML of every page.
  for (const r of routes) {
    const res = await get(r);
    for (const needle of needles) {
      if (res.body.includes(needle)) {
        console.log(`  LEAK: ${needle} found in HTML of ${r}`);
        found = true;
      }
    }
  }
  console.log(found ? "  RESULT: a secret is reachable from the client" : "  RESULT: no secret found in any client chunk or HTML response");
  void layout;

  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
