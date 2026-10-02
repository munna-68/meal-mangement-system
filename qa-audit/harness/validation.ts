/**
 * PHASE 4M — input validation matrix, driven through the REAL action files.
 *
 * The action modules are copied verbatim from `src/server/actions/*`; only three
 * things are rewritten so the module can run outside a Next request:
 *   - the `"use server"` directive is dropped,
 *   - `requireSession()` is replaced by a stub returning a fake signed-in owner,
 *   - the database is replaced by a recorder that captures what the action
 *     WOULD have written.
 *
 * The zod schemas, the month-lock calls and every money expression are the
 * original text, so a pass here means the real action accepts the input.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GEN = resolve(process.cwd(), "qa-audit/mutation/validation");
mkdirSync(GEN, { recursive: true });

/** Every write the actions could make, captured instead of executed. */
export interface Recorder {
  inserts: string[];
  updates: string[];
  deletes: string[];
  audits: string[];
  reset(): void;
}

function stubbedSource(file: string): string {
  let src = readFileSync(file, "utf8");
  src = src.replace(/^\s*"use server";\s*$/m, "");
  // imports that only exist inside a Next request
  src = src.replace(/import \{ refresh \} from "next\/cache";\n?/g, "");
  src = src.replace(/import \{ requireSession \} from "@\/server\/auth";\n?/g, "");
  src = src.replace(/import \{ db, type Executor \} from "@\/db";\n?/g, "");
  src = src.replace(/import \{ db \} from "@\/db";\n?/g, "");
  src = src.replace(/import \{ recordAudit \} from "@\/server\/audit";\n?/g, "");
  src = src.replace(/import \{ monthLockError, monthKeyLockError \} from "@\/server\/month-lock";\n?/g, "");
  src = src.replace(/import \{ monthLockError \} from "@\/server\/month-lock";\n?/g, "");
  src = src.replace(/import \{ openingMonthError \} from "@\/server\/opening-guard";\n?/g, "");
  src = src.replace(/import \{ getMemberNames \} from "@\/server\/queries";\n?/g, "");
  src = src.replace(/import \{ getMemberHistoryLosses \} from "@\/server\/queries";\n?/g, "");
  src = src.replace(/import \{ ensureAutoExtrasForDate[^\n]*\n?/g, "");
  src = src.replace(/import \{ ensureAutoExtrasForMonth \} from "@\/server\/auto-extras";\n?/g, "");
  src = src.replace(/import \{ getRateCards, loadLedgerSnapshot \} from "@\/server\/queries";\n?/g, "");
  src = src.replace(/import \{ getRateCards \} from "@\/server\/queries";\n?/g, "");
  src = src.replace(/import \{ loadLedgerSnapshot \} from "@\/server\/queries";\n?/g, "");
  src = src.replace(/import \{ getMemberSettlements[^\n]*\n?/g, "");
  src = src.replace(/import \{[^}]*insertAutoExtraRows[^}]*\} from "@\/server\/auto-extras";\n?/g, "");
  src = src.replace(/import \{ getAccounts[^\n]*\n?/g, "");

  const prelude = `
import { z } from "zod";
const __recorder = (globalThis as any).__qaRecorder as Recorder;
const requireSession = async () => ({
  accountId: "00000000-0000-0000-0000-0000000000aa",
  username: "qaowner",
  displayName: "QA Owner",
  role: "OWNER" as const,
});
const refresh = () => {};
const recordAudit = async (e: any) => { __recorder.audits.push(e.action); };
const monthLockError = async (_d: any) => null;
const monthKeyLockError = async (_m: any) => null;
const openingMonthError = async (_m: any) => null;
const getMemberNames = async (ids: string[]) => new Map(ids.map((i) => [i, "QA-A"]));
const getRateCards = async () => ([] as any[]);
const ensureAutoExtrasForMonth = async (_m: string) => {};
// A snapshot complete enough for computeRunningBalances to run for real, which
// is what createDeduction's overdraft guard depends on. Member "x" deposited
// 1,000 and has no meals, extras or bills, so its live balance is exactly 1,000
// — which makes the overdraft boundary a known quantity for the cases below.
const loadLedgerSnapshot = async () => ({
  members: [{ id: "x", name: "QA-A", roomId: "r1", active: true, joinDate: "2026-09-01", leaveDate: null }],
  rooms: [{ id: "r1", number: "A1", capacity: 3, solo: false }],
  changes: [],
  guestMeals: [],
  extras: [],
  bills: [],
  khalaPayments: [],
  rateCards: [],
  deposits: [{ memberId: "x", date: "2026-09-10", amount: 1000 }],
  deductions: [],
  settlements: [],
  openingBalances: [],
  lastClosedMonth: null,
  today: "2026-09-30",
  currentMonth: "2026-09",
  // Gate off, so the fixtures price exactly as they always have.
  confirmedBazarDates: [],
  settings: { soloElectricityMultiplier: 2, soloWifiMultiplier: 1, ramadanMode: false, mealChargeGateStarts: null },
});
const insertAutoExtraRows = async () => 0;
const pendingAutoExtraRows = () => [];
const autoExtraRowsFor = () => [];
const dailyExtraSourceKey = (d: string) => "auto:daily-extra:" + d;
const managerFeeSourceKey = (d: string) => "auto:manager-fee:" + d;
const setAutoExtraVoided = async () => {};
const getMemberHistoryLosses = async () => new Map();
const todayKey = () => "2026-09-30";
/** A chainable no-op that records the write. */
const __mk = (kind: "inserts" | "updates" | "deletes") => new Proxy(function (): any { return __mk(kind); }, {
  get(_t, prop) {
    if (prop === Symbol.iterator) return function* () { return undefined; };
    if (prop === "values") return (v: any) => { __recorder[kind].push("values " + JSON.stringify(v).slice(0, 120)); return __mk(kind); };
    if (prop === "set") return (v: any) => { __recorder[kind].push("set " + JSON.stringify(v).slice(0, 120)); return __mk(kind); };
    if (prop === "where") return () => __mk(kind);
    if (prop === "onConflictDoUpdate" || prop === "onConflictDoNothing") return () => __mk(kind);
    if (prop === "returning" || prop === "limit") return () => __mk(kind);
    if (prop === "for") return () => __mk(kind);
    if (prop === "from") return () => __mk(kind);
    if (prop === "then") return undefined;
    return __mk(kind);
  },
  apply() { return undefined; },
});
const db: any = { insert: (t: any) => __mk("inserts"), update: (t: any) => __mk("updates"), delete: (t: any) => __mk("deletes"), select: () => __mk("inserts"), transaction: async (fn: any) => fn(db) };
const pool: any = db;
`;
  return src + "\n" + prelude;
}

async function loadAction(file: string) {
  const out = resolve(GEN, file.replace(/[^a-z0-9]/gi, "_") + ".ts");
  writeFileSync(out, stubbedSource(file));
  return import(pathToFileURL(out).href);
}

const recorder: Recorder = {
  inserts: [],
  updates: [],
  deletes: [],
  audits: [],
  reset() {
    this.inserts = [];
    this.updates = [];
    this.deletes = [];
    this.audits = [];
  },
};
(globalThis as any).__qaRecorder = recorder;

interface Case {
  action: string;
  label: string;
  input: unknown;
  /** What the case is proving. */
  expect: "REJECTED" | "ACCEPTED";
}

let passed = 0;
const failures: string[] = [];
function verdict(label: string, expect: "REJECTED" | "ACCEPTED", result: { ok: boolean }, wrote: boolean) {
  const accepted = result.ok;
  const wroteSomething = wrote;
  const good =
    expect === "REJECTED" ? accepted === false : accepted === true && wroteSomething === true;
  if (good) passed += 1;
  else
    failures.push(
      `${label}: expected ${expect} — action returned ok=${accepted}${wroteSomething ? " and WROTE to the database" : " and wrote nothing"}`,
    );
  console.log(
    `  ${good ? "PASS" : "FAIL"}  ${label.padEnd(46)} ok=${String(accepted).padEnd(5)} wrote=${String(wroteSomething).padEnd(5)} ${result.ok ? "" : (result as any).error ?? ""}`,
  );
}

async function main() {
  const ledger = await loadAction(resolve(process.cwd(), "src/server/actions/ledger.ts"));
  const rates = await loadAction(resolve(process.cwd(), "src/server/actions/rates.ts"));
  const meals = await loadAction(resolve(process.cwd(), "src/server/actions/meals.ts"));
  const bazar = await loadAction(resolve(process.cwd(), "src/server/actions/bazar.ts"));
  const opening = await loadAction(resolve(process.cwd(), "src/server/actions/opening.ts"));
  const people = await loadAction(resolve(process.cwd(), "src/server/actions/people.ts"));

  console.log("\n=== EXTRA amount (createExtra) ===");
  const extraCases: Case[] = [
    { action: "createExtra", label: "empty amount", input: { date: "2026-08-20", label: "p", amount: "", category: "ONE_OFF", showInDailyBudget: false }, expect: "REJECTED" },
    { action: "createExtra", label: "zero", input: { date: "2026-08-20", label: "p", amount: 0, category: "ONE_OFF", showInDailyBudget: false }, expect: "ACCEPTED" },
    { action: "createExtra", label: "negative -250", input: { date: "2026-08-20", label: "p", amount: -250, category: "ONE_OFF", showInDailyBudget: false }, expect: "REJECTED" },
    { action: "createExtra", label: "decimal 0.5", input: { date: "2026-08-20", label: "p", amount: 0.5, category: "ONE_OFF", showInDailyBudget: false }, expect: "REJECTED" },
    { action: "createExtra", label: "decimal 0.005", input: { date: "2026-08-20", label: "p", amount: 0.005, category: "ONE_OFF", showInDailyBudget: false }, expect: "REJECTED" },
    { action: "createExtra", label: "pasted comma string '1,200'", input: { date: "2026-08-20", label: "p", amount: "1,200", category: "ONE_OFF", showInDailyBudget: false }, expect: "ACCEPTED" },
    { action: "createExtra", label: "spaces ' 1000 '", input: { date: "2026-08-20", label: "p", amount: " 1000 ", category: "ONE_OFF", showInDailyBudget: false }, expect: "ACCEPTED" },
    { action: "createExtra", label: "Bengali digits '১৫০০'", input: { date: "2026-08-20", label: "p", amount: "১৫০০", category: "ONE_OFF", showInDailyBudget: false }, expect: "REJECTED" },
    { action: "createExtra", label: "text 'abc'", input: { date: "2026-08-20", label: "p", amount: "abc", category: "ONE_OFF", showInDailyBudget: false }, expect: "REJECTED" },
    { action: "createExtra", label: "scientific '1e6'", input: { date: "2026-08-20", label: "p", amount: "1e6", category: "ONE_OFF", showInDailyBudget: false }, expect: "ACCEPTED" },
    { action: "createExtra", label: "max int 2147483647", input: { date: "2026-08-20", label: "p", amount: 2147483647, category: "ONE_OFF", showInDailyBudget: false }, expect: "ACCEPTED" },
    { action: "createExtra", label: "over int 9999999999", input: { date: "2026-08-20", label: "p", amount: 9999999999, category: "ONE_OFF", showInDailyBudget: false }, expect: "ACCEPTED" },
    { action: "createExtra", label: "crore 100000000", input: { date: "2026-08-20", label: "p", amount: 100000000, category: "ONE_OFF", showInDailyBudget: false }, expect: "ACCEPTED" },
    { action: "createExtra", label: "blank label", input: { date: "2026-08-20", label: "   ", amount: 100, category: "ONE_OFF", showInDailyBudget: false }, expect: "REJECTED" },
    { action: "createExtra", label: "bad date 2026-13-45", input: { date: "2026-13-45", label: "p", amount: 100, category: "ONE_OFF", showInDailyBudget: false }, expect: "REJECTED" },
    { action: "createExtra", label: "future date 2026-12-01", input: { date: "2026-12-01", label: "p", amount: 100, category: "ONE_OFF", showInDailyBudget: false }, expect: "ACCEPTED" },
    { action: "createExtra", label: "bad category", input: { date: "2026-08-20", label: "p", amount: 100, category: "NOPE", showInDailyBudget: false }, expect: "REJECTED" },
  ];
  for (const c of extraCases) {
    recorder.reset();
    const r = await ledger.createExtra(c.input as any);
    verdict(c.label, c.expect, r as any, recorder.inserts.length + recorder.audits.length > 0);
  }

  console.log("\n=== UTILITY BILL amount (saveUtilityBill) ===");
  const billCases: Case[] = [
    { action: "saveUtilityBill", label: "zero", input: { month: "2026-08", type: "ELECTRICITY", amount: 0 }, expect: "ACCEPTED" },
    { action: "saveUtilityBill", label: "negative", input: { month: "2026-08", type: "ELECTRICITY", amount: -1 }, expect: "REJECTED" },
    { action: "saveUtilityBill", label: "decimal", input: { month: "2026-08", type: "ELECTRICITY", amount: 1.5 }, expect: "REJECTED" },
    { action: "saveUtilityBill", label: "Bengali digits", input: { month: "2026-08", type: "ELECTRICITY", amount: "৳১,৫০০" }, expect: "REJECTED" },
    { action: "saveUtilityBill", label: "comma string", input: { month: "2026-08", type: "ELECTRICITY", amount: "6,00,000" }, expect: "REJECTED" },
    { action: "saveUtilityBill", label: "over int max", input: { month: "2026-08", type: "ELECTRICITY", amount: 9999999999 }, expect: "ACCEPTED" },
    { action: "saveUtilityBill", label: "bad month '2026-13'", input: { month: "2026-13", type: "ELECTRICITY", amount: 100 }, expect: "REJECTED" },
    { action: "saveUtilityBill", label: "unknown type", input: { month: "2026-08", type: "GAS", amount: 100 }, expect: "REJECTED" },
    { action: "saveUtilityBill", label: "KHALA type accepted", input: { month: "2026-08", type: "KHALA", amount: 1500 }, expect: "ACCEPTED" },
  ];
  for (const c of billCases) {
    recorder.reset();
    const r = await ledger.saveUtilityBill(c.input as any);
    verdict(c.label, c.expect, r as any, recorder.inserts.length + recorder.audits.length > 0);
  }

  console.log("\n=== DEPOSIT amount (createDeposit) ===");
  const depCases: Case[] = [
    { action: "createDeposit", label: "zero", input: { memberId: "x", date: "2026-08-20", amount: 0 }, expect: "REJECTED" },
    { action: "createDeposit", label: "negative", input: { memberId: "x", date: "2026-08-20", amount: -500 }, expect: "REJECTED" },
    { action: "createDeposit", label: "decimal", input: { memberId: "x", date: "2026-08-20", amount: 100.5 }, expect: "REJECTED" },
    { action: "createDeposit", label: "Bengali digits", input: { memberId: "x", date: "2026-08-20", amount: "১৫০০" }, expect: "REJECTED" },
    { action: "createDeposit", label: "crore", input: { memberId: "x", date: "2026-08-20", amount: 100000000 }, expect: "ACCEPTED" },
    { action: "createDeposit", label: "no memberId", input: { date: "2026-08-20", amount: 100 }, expect: "REJECTED" },
    { action: "createDeposit", label: "notes too long (301)", input: { memberId: "x", date: "2026-08-20", amount: 100, notes: "n".repeat(301) }, expect: "REJECTED" },
  ];
  for (const c of depCases) {
    recorder.reset();
    const r = await ledger.createDeposit(c.input as any);
    verdict(c.label, c.expect, r as any, recorder.inserts.length + recorder.audits.length > 0);
  }

  console.log("\n=== DEDUCTION amount (createDeduction) ===");
  // Member "x" is stubbed with a live balance of exactly 1,000.
  const dedCases: Case[] = [
    { action: "createDeduction", label: "zero", input: { memberId: "x", date: "2026-09-20", amount: 0 }, expect: "REJECTED" },
    { action: "createDeduction", label: "negative", input: { memberId: "x", date: "2026-09-20", amount: -500 }, expect: "REJECTED" },
    { action: "createDeduction", label: "decimal", input: { memberId: "x", date: "2026-09-20", amount: 100.5 }, expect: "REJECTED" },
    { action: "createDeduction", label: "exactly the balance (1,000)", input: { memberId: "x", date: "2026-09-20", amount: 1000 }, expect: "ACCEPTED" },
    { action: "createDeduction", label: "one taka over the balance (1,001)", input: { memberId: "x", date: "2026-09-20", amount: 1001 }, expect: "REJECTED" },
    { action: "createDeduction", label: "far over the balance (99,000)", input: { memberId: "x", date: "2026-09-20", amount: 99000 }, expect: "REJECTED" },
    { action: "createDeduction", label: "no memberId", input: { date: "2026-09-20", amount: 100 }, expect: "REJECTED" },
    { action: "createDeduction", label: "notes too long (301)", input: { memberId: "x", date: "2026-09-20", amount: 100, notes: "n".repeat(301) }, expect: "REJECTED" },
  ];
  for (const c of dedCases) {
    recorder.reset();
    const r = await ledger.createDeduction(c.input as any);
    verdict(c.label, c.expect, r as any, recorder.inserts.length + recorder.audits.length > 0);
  }

  console.log("\n=== GUEST COUNT (setGuestMeal) ===");
  const guestCases: Case[] = [
    { action: "setGuestMeal", label: "count 0 (means 'remove')", input: { memberId: "x", date: "2026-08-20", type: "GUEST_FULL", count: 0 }, expect: "ACCEPTED" },
    { action: "setGuestMeal", label: "count -1", input: { memberId: "x", date: "2026-08-20", type: "GUEST_FULL", count: -1 }, expect: "REJECTED" },
    { action: "setGuestMeal", label: "count 20 (the maximum)", input: { memberId: "x", date: "2026-08-20", type: "GUEST_FULL", count: 20 }, expect: "ACCEPTED" },
    { action: "setGuestMeal", label: "count 21 (one over)", input: { memberId: "x", date: "2026-08-20", type: "GUEST_FULL", count: 21 }, expect: "REJECTED" },
    { action: "setGuestMeal", label: "count 1.5", input: { memberId: "x", date: "2026-08-20", type: "GUEST_FULL", count: 1.5 }, expect: "REJECTED" },
    { action: "setGuestMeal", label: "bad type", input: { memberId: "x", date: "2026-08-20", type: "GUEST_HALF_PINT", count: 1 }, expect: "REJECTED" },
  ];
  for (const c of guestCases) {
    recorder.reset();
    const r = await meals.setGuestMeal(c.input as any);
    verdict(c.label, c.expect, r as any, recorder.inserts.length + recorder.audits.length > 0);
  }

  console.log("\n=== RATE CARD fields (createRateCard) ===");
  const base = {
    label: "p",
    effectiveFrom: "2026-08-20",
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
  const rateCases: Case[] = [
    { action: "createRateCard", label: "all normal", input: base, expect: "ACCEPTED" },
    { action: "createRateCard", label: "zero full rate", input: { ...base, fullMealRate: 0 }, expect: "ACCEPTED" },
    { action: "createRateCard", label: "negative manager fee", input: { ...base, managerDailyFee: -1 }, expect: "REJECTED" },
    { action: "createRateCard", label: "decimal full rate", input: { ...base, fullMealRate: 60.5 }, expect: "REJECTED" },
    { action: "createRateCard", label: "half > full", input: { ...base, fullMealRate: 35, halfMealRate: 60 }, expect: "ACCEPTED" },
    { action: "createRateCard", label: "khala solo < normal", input: { ...base, khalaNormalRate: 400, khalaSoloRate: 300 }, expect: "ACCEPTED" },
    { action: "createRateCard", label: "bad effective date", input: { ...base, effectiveFrom: "2026-02-30" }, expect: "REJECTED" },
    { action: "createRateCard", label: "huge 2147483647", input: { ...base, fullMealRate: 2147483647 }, expect: "ACCEPTED" },
  ];
  for (const c of rateCases) {
    recorder.reset();
    const r = await rates.createRateCard(c.input as any);
    verdict(c.label, c.expect, r as any, recorder.inserts.length + recorder.audits.length > 0);
  }

  console.log("\n=== BAZAR record (saveBazarRecord) ===");
  const bazarCases: Case[] = [
    { action: "saveBazarRecord", label: "normal", input: { date: "2026-08-20", deductionAmount: 0, advanceGiven: 1000 }, expect: "ACCEPTED" },
    { action: "saveBazarRecord", label: "future date", input: { date: "2026-12-01", deductionAmount: 0, advanceGiven: 0 }, expect: "REJECTED" },
    { action: "saveBazarRecord", label: "negative deduction", input: { date: "2026-08-20", deductionAmount: -50, advanceGiven: 0 }, expect: "REJECTED" },
    { action: "saveBazarRecord", label: "decimal deduction", input: { date: "2026-08-20", deductionAmount: 10.5, advanceGiven: 0 }, expect: "REJECTED" },
    { action: "saveBazarRecord", label: "deduction with no reason", input: { date: "2026-08-20", deductionAmount: 50, advanceGiven: 0 }, expect: "REJECTED" },
    { action: "saveBazarRecord", label: "negative advance", input: { date: "2026-08-20", deductionAmount: 0, advanceGiven: -100 }, expect: "REJECTED" },
    { action: "saveBazarRecord", label: "reason over 300 chars", input: { date: "2026-08-20", deductionAmount: 50, deductionReason: "r".repeat(301), advanceGiven: 0 }, expect: "REJECTED" },
  ];
  for (const c of bazarCases) {
    recorder.reset();
    const r = await bazar.saveBazarRecord(c.input as any);
    verdict(c.label, c.expect, r as any, recorder.inserts.length + recorder.audits.length > 0);
  }

  console.log("\n=== OPENING BALANCE (setOpeningBalance) — the one field that may be negative ===");
  const openCases: Case[] = [
    { action: "setOpeningBalance", label: "positive 500", input: { memberId: "x", month: "2026-08", amount: 500 }, expect: "ACCEPTED" },
    { action: "setOpeningBalance", label: "negative -500 (member already owes)", input: { memberId: "x", month: "2026-08", amount: -500 }, expect: "ACCEPTED" },
    { action: "setOpeningBalance", label: "decimal 100.5", input: { memberId: "x", month: "2026-08", amount: 100.5 }, expect: "REJECTED" },
    { action: "setOpeningBalance", label: "bad month", input: { memberId: "x", month: "2026-13", amount: 100 }, expect: "REJECTED" },
  ];
  for (const c of openCases) {
    recorder.reset();
    const r = await opening.setOpeningBalance(c.input as any);
    verdict(c.label, c.expect, r as any, recorder.inserts.length + recorder.audits.length > 0);
  }

  console.log("\n=== ROOM capacity (createRoom) ===");
  const roomCases: Case[] = [
    { action: "createRoom", label: "capacity 2 normal", input: { number: "301", capacity: 2, solo: false }, expect: "ACCEPTED" },
    { action: "createRoom", label: "capacity 0", input: { number: "302", capacity: 0, solo: false }, expect: "REJECTED" },
    { action: "createRoom", label: "capacity 11 (over max)", input: { number: "303", capacity: 11, solo: false }, expect: "REJECTED" },
    { action: "createRoom", label: "capacity -2", input: { number: "304", capacity: -2, solo: false }, expect: "REJECTED" },
    { action: "createRoom", label: "capacity 0.5", input: { number: "305", capacity: 0.5, solo: false }, expect: "REJECTED" },
    { action: "createRoom", label: "solo flag on a single", input: { number: "306", capacity: 1, solo: true }, expect: "REJECTED" },
    { action: "createRoom", label: "blank number", input: { number: "  ", capacity: 2, solo: false }, expect: "REJECTED" },
    { action: "createRoom", label: "number 33 chars", input: { number: "x".repeat(33), capacity: 2, solo: false }, expect: "REJECTED" },
  ];
  for (const c of roomCases) {
    recorder.reset();
    const r = await people.createRoom(c.input as any);
    verdict(c.label, c.expect, r as any, recorder.inserts.length + recorder.audits.length > 0);
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  x ${f}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
