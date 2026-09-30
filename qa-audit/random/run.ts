/**
 * Runs the invariant harness over a large number of randomised scenarios and
 * writes a machine-readable result file.
 *
 *   npx tsx qa-audit/random/run.ts [count] [startSeed]
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { checkScenario, INVARIANT_TITLES, type Finding } from "../harness/invariants";
import { makeScenario } from "./scenarios";

const count = Number(process.argv[2] ?? 500);
const startSeed = Number(process.argv[3] ?? 1);

interface Row {
  seed: number;
  edge: boolean;
  checks: number;
  failures: number;
}

const byInvariant = new Map<string, { fail: number; samples: Finding[] }>();
const rows: Row[] = [];
const allFindings: Finding[] = [];
let totalChecks = 0;

for (let i = 0; i < count; i += 1) {
  const seed = startSeed + i;
  const edge = i % 10 === 0;
  const scenario = makeScenario(seed, { edge });
  const report = checkScenario(scenario);
  totalChecks += report.checks;
  rows.push({ seed, edge, checks: report.checks, failures: report.failures.length });
  for (const f of report.failures) {
    allFindings.push(f);
    const entry = byInvariant.get(f.invariant) ?? { fail: 0, samples: [] };
    entry.fail += 1;
    if (entry.samples.length < 3) entry.samples.push(f);
    byInvariant.set(f.invariant, entry);
  }
}

const failedScenarios = rows.filter((r) => r.failures > 0);
const outDir = resolve(process.cwd(), "qa-audit/out");
mkdirSync(outDir, { recursive: true });

writeFileSync(
  resolve(outDir, "random-results.json"),
  JSON.stringify(
    {
      count,
      startSeed,
      totalChecks,
      scenariosWithFailures: failedScenarios.length,
      totalFailures: allFindings.length,
      byInvariant: Object.fromEntries(
        [...byInvariant.entries()].map(([k, v]) => [
          k,
          { title: INVARIANT_TITLES[k] ?? k, fail: v.fail, samples: v.samples },
        ]),
      ),
      failingSeeds: failedScenarios.map((r) => ({ seed: r.seed, edge: r.edge, failures: r.failures })),
    },
    null,
    2,
  ),
);

console.log(`scenarios: ${count} (seeds ${startSeed}..${startSeed + count - 1})`);
console.log(`checks run: ${totalChecks}`);
console.log(`scenarios with at least one failure: ${failedScenarios.length}`);
console.log(`total failures: ${allFindings.length}`);
console.log("\nby invariant:");
for (const [k, v] of [...byInvariant.entries()].sort((a, b) => b[1].fail - a[1].fail)) {
  console.log(`  ${k.padEnd(4)} ${String(v.fail).padStart(6)}  ${INVARIANT_TITLES[k] ?? ""}`);
  for (const s of v.samples.slice(0, 2)) {
    console.log(
      `        seed ${s.seed} ${s.month}: ${s.detail} | expected ${s.expected} actual ${s.actual} (Δ${s.delta})`,
    );
  }
}
console.log(`\nfirst 40 failing seeds: ${failedScenarios.slice(0, 40).map((r) => r.seed).join(", ")}`);
