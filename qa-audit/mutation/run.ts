/**
 * PHASE 7 — prove the audit's checks can actually fail.
 *
 * Each mutation is a deliberately introduced bug in a COPY of `src/lib/calc.ts`
 * (the original file is never touched). The runner compares the original engine
 * and the mutant over a fixed battery of scenarios and reports how many
 * independent checks notice. A mutation that nobody notices would mean the
 * audit proves nothing.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { makeScenario } from "../random/scenarios";

const SRC = resolve(process.cwd(), "src/lib/calc.ts");
const OUT = resolve(process.cwd(), "qa-audit/mutation/gen");
mkdirSync(OUT, { recursive: true });

interface Mutation {
  name: string;
  description: string;
  find: string;
  replace: string;
  /** Which invariant is supposed to notice. */
  expectCaughtBy: string;
}

const MUTATIONS: Mutation[] = [
  {
    name: "per-head-floor-instead-of-round",
    description: "extras per-head uses floor() instead of round() — a classic off-by-one",
    find: "activeMemberCount > 0 ? roundTaka(total / activeMemberCount) : 0",
    replace: "activeMemberCount > 0 ? Math.floor(total / activeMemberCount) : 0",
    expectCaughtBy: "extras shares stop summing to the pool",
  },
  {
    name: "dropped-guest-half",
    description: "a GUEST_HALF guest row is silently ignored in the month charge",
    find: `    } else {
      row.guestHalfCount += guest.count;
      row.mealAmount += (card?.guestHalfRate ?? 0) * guest.count;
    }`,
    replace: `    } else {
      row.guestHalfCount += guest.count;
    }`,
    expectCaughtBy: "the meal total falls short of the day-by-day recomputation",
  },
  {
    name: "double-counted-extra",
    description: "the extras pool counts every line item twice",
    find: "  const total = sum(\n    extras\n      .filter(",
    replace: "  const total = 2 * sum(\n    extras\n      .filter(",
    expectCaughtBy: "extras shares exceed the pool",
  },
  {
    name: "remainder-off-by-one",
    description: "the largest-remainder distribution hands out one taka too few",
    find: "  for (let i = 0; i < remainder && i < indices.length; i++) {",
    replace: "  for (let i = 0; i < remainder - 1 && i < indices.length; i++) {",
    expectCaughtBy: "utility shares no longer sum to the pool",
  },
  {
    name: "manager-fee-leaks-into-pool",
    description: "the manager's daily fee is no longer excluded from the extras pool",
    find: `          item.category !== "MANAGER_FEE" &&
          !("sourceKey" in item && typeof (item as { sourceKey?: string }).sourceKey === "string" && (item as { sourceKey?: string }).sourceKey?.startsWith("auto:manager-fee:")) &&
          isSameOrAfter(item.date, from) &&`,
    replace: `          isSameOrAfter(item.date, from) &&`,
    expectCaughtBy: "the pool contains the manager fee",
  },
  {
    name: "sticky-status-off-by-one-day",
    description: "a status change starts applying the day AFTER it was recorded",
    find: "    if (compare(change.date, date) > 0) continue;\n    if (!best || compare(change.date, best) >= 0) {",
    replace: "    if (compare(change.date, date) >= 0) continue;\n    if (!best || compare(change.date, best) > 0) {",
    expectCaughtBy: "the meal total shifts by one day per change",
  },
  {
    name: "solo-ignores-capacity",
    description: "a 1-bed room is treated as 'alone in a shared room' and billed solo",
    find: "  return !!room && room.capacity >= 2 && room.occupants <= 1;",
    replace: "  return !!room && room.capacity >= 1 && room.occupants <= 1;",
    expectCaughtBy: "a single room's khala and electricity change",
  },
  {
    name: "guest-deduction-doubled",
    description: "the 5 taka guest deduction is charged twice on the bazar slip",
    find: "    rateCard && totalGuestMeals > 0 ? totalGuestMeals * 5 : 0;",
    replace: "    rateCard && totalGuestMeals > 0 ? totalGuestMeals * 10 : 0;",
    expectCaughtBy: "the day budget no longer matches the reference",
  },
  {
    name: "manager-fee-not-deducted",
    description: "the manager's daily fee is no longer held back from the bazar cash",
    find: "  const totalBudget =\n    mealsSubtotal + extraAmount - managerFeeAmount - deductionAmount;",
    replace: "  const totalBudget =\n    mealsSubtotal + extraAmount - deductionAmount;",
    expectCaughtBy: "the day budget is 30 too high",
  },
  {
    name: "cutoff-ignores-today",
    description: "future days inside the current month are billed",
    find: "  const cutoff = compare(requested, today) < 0 ? requested : today;",
    replace: "  const cutoff = requested;",
    expectCaughtBy: "the meal count includes days that have not happened",
  },
];

async function loadMutant(name: string) {
  const file = resolve(OUT, `${name}.ts`);
  const mod = await import(pathToFileURL(file).href);
  return mod;
}

const SEEDS = [1, 2, 3, 5, 8, 10, 14, 21, 33, 56, 91, 121, 157, 191, 256, 333, 401, 499, 500];

interface Probe {
  name: string;
  run: (calc: any, s: any) => string;
}

/** Each probe reduces a whole scenario to one comparable number. */
const PROBES: Probe[] = [
  {
    name: "month total cost",
    run: (calc, s) => {
      const out: string[] = [];
      for (const month of s.months) {
        const c = calc.computeMonth({
          month,
          cutoff: `${month}-31`.slice(0, 7) === month ? undefined : undefined,
          finalize: true,
          members: s.members,
          rooms: s.rooms,
          changes: s.changes,
          guestMeals: s.guestMeals,
          extras: s.extras,
          bills: s.bills,
          rateCards: s.rateCards,
          soloElectricityMultiplier: s.soloElectricityMultiplier,
          soloWifiMultiplier: s.soloWifiMultiplier,
          today: s.today,
        });
        out.push(`${month}:${c.totals.totalCost}/${c.totals.mealAmount}/${c.totals.khalaElecWifiAmount}/${c.totals.extraAmount}`);
      }
      return out.join("|");
    },
  },
  {
    name: "per-member utility + extras shares",
    run: (calc, s) => {
      const month = s.months[s.months.length - 1];
      const c = calc.computeMonth({
        month,
        finalize: true,
        members: s.members,
        rooms: s.rooms,
        changes: s.changes,
        guestMeals: s.guestMeals,
        extras: s.extras,
        bills: s.bills,
        rateCards: s.rateCards,
        soloElectricityMultiplier: s.soloElectricityMultiplier,
        soloWifiMultiplier: s.soloWifiMultiplier,
        today: s.today,
      });
      return [...c.perMember.values()]
        .map((r: any) => `${r.khalaElecWifiAmount}/${r.extraAmount}/${r.mealAmount}`)
        .sort()
        .join("|");
    },
  },
  {
    name: "day bazar budget",
    run: (calc, s) => {
      const out: string[] = [];
      for (const month of s.months) {
        for (let d = 1; d <= 28; d += 1) {
          const date = `${month}-${String(d).padStart(2, "0")}`;
          if (date > s.today) break;
          const t = calc.computeDayTotals({
            date,
            members: s.members,
            changes: s.changes,
            guestMeals: s.guestMeals,
            extras: s.extras,
            rateCard: calc.rateCardFor(s.rateCards, date),
            today: s.today,
          });
          out.push(`${t.totalBudget}/${t.guestDeductionAmount}/${t.managerFeeAmount}`);
        }
      }
      return out.join("|");
    },
  },
  {
    name: "register full/half counts",
    run: (calc, s) => {
      const month = s.months[s.months.length - 1];
      const reg = calc.mealRegisterForMonth({
        month,
        members: s.members,
        rooms: s.rooms,
        changes: s.changes,
        today: s.today,
      });
      return reg.rows.map((r: any) => `${r.fullCount}/${r.halfCount}`).join("|");
    },
  },
  {
    name: "extras pool total and per head",
    run: (calc, s) => {
      const month = s.months[s.months.length - 1];
      const p = calc.extraPoolForRange({
        extras: s.extras,
        from: `${month}-01`,
        to: `${month}-31`,
        activeMemberCount: s.members.length,
      });
      return `${p.total}/${p.perMember}`;
    },
  },
  {
    name: "extras pool with a manager-fee row present",
    run: (calc, s) => {
      // A hand-built fixture, because the random generator never produces a
      // MANAGER_FEE row (the query layer filters them out, so the engine's own
      // guard is defence in depth and would otherwise go untested).
      const month = s.months[s.months.length - 1];
      const extras = [
        ...s.extras,
        {
          id: "legacy-manager-fee",
          date: `${month}-05`,
          label: "Manager's daily fee",
          amount: 30,
          category: "MANAGER_FEE",
          showInDailyBudget: true,
          voided: false,
        },
        {
          id: "auto-manager-fee",
          date: `${month}-05`,
          label: "Manager's daily fee",
          amount: 30,
          category: "ONE_OFF",
          showInDailyBudget: true,
          voided: false,
          sourceKey: "auto:manager-fee:legacy",
        },
      ];
      const pool = calc.extraPoolForRange({
        extras,
        from: `${month}-01`,
        to: `${month}-31`,
        activeMemberCount: Math.max(1, s.members.length),
      });
      const day = calc.computeDayTotals({
        date: `${month}-05`,
        members: s.members,
        changes: s.changes,
        guestMeals: s.guestMeals,
        extras,
        rateCard: calc.rateCardFor(s.rateCards, `${month}-05`),
        today: s.today,
      });
      return `pool=${pool.total}/perHead=${pool.perMember}/dayExtra=${day.extraAmount}/fee=${day.managerFeeAmount}/budget=${day.totalBudget}`;
    },
  },
  {
    name: "utility apportionment",
    run: (calc, s) => {
      const month = s.months[s.months.length - 1];
      const a = calc.apportionUtilities({
        members: s.members,
        rooms: s.rooms,
        bills: s.bills,
        from: `${month}-01`,
        to: `${month}-31`,
        soloElectricityMultiplier: s.soloElectricityMultiplier,
        soloWifiMultiplier: s.soloWifiMultiplier,
        today: s.today,
      });
      return [...a.byMember.values()].map((x: any) => `${x.electricity}/${x.wifi}`).sort().join("|");
    },
  },
];

async function main() {
  const original = await import(pathToFileURL(SRC).href);
  const scenarios = SEEDS.map((seed) => makeScenario(seed, { edge: seed % 10 === 0 }));
  const scenariosEdge = [1, 56, 121, 157, 191].map((seed) => makeScenario(seed, { edge: true }));
  const all = [...scenarios, ...scenariosEdge];

  const baseline = all.map((s) =>
    PROBES.map((p) => {
      try {
        return p.run(original, s);
      } catch (e) {
        return `ERR:${(e as Error).message}`;
      }
    }),
  );

  const src = readFileSync(SRC, "utf8");
  const results: Array<{ name: string; caught: number; byProbe: Record<string, number>; error?: string }> = [];

  for (const mut of MUTATIONS) {
    if (!src.includes(mut.find)) {
      results.push({ name: mut.name, caught: 0, byProbe: {}, error: "mutation anchor not found — the source has changed" });
      continue;
    }
    // The mutant lives outside src/, so its relative imports are re-pointed at
    // the real (unmodified) dates/money helpers.
    const mutated = src
      .replace(mut.find, mut.replace)
      .replace(/from "\.\/dates"/g, 'from "../../../src/lib/dates"')
      .replace(/from "\.\/money"/g, 'from "../../../src/lib/money"');
    const file = resolve(OUT, `${mut.name}.ts`);
    writeFileSync(file, mutated);
    let mod: any;
    try {
      mod = await loadMutant(mut.name);
    } catch (e) {
      results.push({ name: mut.name, caught: 0, byProbe: {}, error: `load failed: ${(e as Error).message}` });
      continue;
    }
    let caught = 0;
    const byProbe: Record<string, number> = {};
    for (let i = 0; i < all.length; i += 1) {
      for (let p = 0; p < PROBES.length; p += 1) {
        let value: string;
        try {
          value = PROBES[p].run(mod, all[i]);
        } catch (e) {
          value = `ERR:${(e as Error).message}`;
        }
        if (value !== baseline[i][p]) {
          caught += 1;
          byProbe[PROBES[p].name] = (byProbe[PROBES[p].name] ?? 0) + 1;
        }
      }
    }
    results.push({ name: mut.name, caught, byProbe });
  }

  const totalChecks = all.length * PROBES.length;
  console.log(`mutation testing: ${MUTATIONS.length} deliberate bugs, ${all.length} scenarios, ${PROBES.length} probes each (${totalChecks} comparisons per mutation)\n`);
  let uncaught = 0;
  for (const r of results) {
    const status = r.error ? "ERROR " : r.caught > 0 ? "caught" : "MISSED";
    if (r.error || r.caught === 0) uncaught += 1;
    console.log(`  [${status}] ${r.name.padEnd(34)} ${r.caught > 0 ? `${r.caught}/${totalChecks} comparisons differ` : "0 comparisons differ"}`);
    if (r.error) console.log(`      ${r.error}`);
    else if (r.caught > 0)
      console.log(`      noticed by: ${Object.entries(r.byProbe).map(([k, v]) => `${k} (${v})`).join(", ")}`);
  }
  console.log(`\n${MUTATIONS.length - uncaught}/${MUTATIONS.length} deliberate bugs were detected by the checks.`);
  if (uncaught > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
