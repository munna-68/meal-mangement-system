/**
 * Triages the reference cross-check failures, so a single root cause is not
 * counted as five separate bugs. For every failing scenario it recomputes the
 * app and the reference side by side and classifies the difference.
 */
import {
  buildSettlementRows,
  computeMonth,
  type ExtraItemData,
} from "../../src/lib/calc";
import { monthEnd } from "../../src/lib/dates";
import { checkScenario } from "../harness/invariants";
import { makeScenario } from "../random/scenarios";
import { refComputeMonth, type RefMember, type RefRateCard, type RefRoom } from "../ref/reference";

const count = Number(process.argv[2] ?? 500);
const startSeed = Number(process.argv[3] ?? 1);

type Cause =
  | "extras-split-rounding"
  | "utility-pool-with-no-active-members"
  | "unexplained";
const causes = new Map<Cause, { n: number; examples: string[] }>();
const bump = (c: Cause, text: string) => {
  const e = causes.get(c) ?? { n: 0, examples: [] };
  e.n += 1;
  if (e.examples.length < 4) e.examples.push(text);
  causes.set(c, e);
};

for (let i = 0; i < count; i += 1) {
  const seed = startSeed + i;
  const edge = i % 10 === 0;
  const s = makeScenario(seed, { edge });
  const report = checkScenario(s);
  if (report.failures.length === 0) continue;

  for (const month of s.months) {
    const monthFindings = report.failures.filter(
      (x) => x.month === month || x.month.startsWith(`${month} `),
    );
    if (monthFindings.length === 0) continue;
    const app = computeMonth({
      month,
      cutoff: monthEnd(month),
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
    const rows = buildSettlementRows({
      computation: app,
      members: s.members,
      rooms: s.rooms,
      deposits: s.deposits,
      openingBalances: new Map(),
    });
    const ref = refComputeMonth(
      {
        month,
        members: s.members as RefMember[],
        rooms: s.rooms as RefRoom[],
        changes: s.changes,
        guests: s.guestMeals,
        extras: s.extras as (ExtraItemData & { sourceKey?: string | null })[],
        bills: s.bills,
        cards: s.rateCards.map(
          (c): RefRateCard => ({
            id: c.id,
            effectiveFrom: c.effectiveFrom,
            effectiveTo: c.effectiveTo,
            full: BigInt(c.fullMealRate),
            half: BigInt(c.halfMealRate),
            guestFull: BigInt(c.guestFullRate),
            guestHalf: BigInt(c.guestHalfRate),
            sehri: BigInt(c.sehriRate),
            khalaNormal: BigInt(c.khalaNormalRate),
            khalaSolo: BigInt(c.khalaSoloRate),
            managerDailyFee: BigInt(c.managerDailyFee),
            dailyExtra: BigInt(c.dailyExtraAmount),
          }),
        ),
      },
      {
        today: s.today,
        cutoff: monthEnd(month),
        finalize: true,
        soloElectricityMultiplier: s.soloElectricityMultiplier,
        soloWifiMultiplier: s.soloWifiMultiplier,
        guestDeductionApplies: false,
      },
    );

    // Extras only?
    const extrasApp = [...app.perMember.values()].reduce((t, r) => t + r.extraAmount, 0);
    const extrasRef = [...ref.perMember.values()].reduce((t, r) => t + r.extras, BigInt(0));
    const extrasOnly =
      app.totals.mealAmount === Number(ref.mealCostTotal) &&
      extrasApp !== Number(extrasRef);
    void extrasOnly;

    // Utility pool with nobody to charge?
    const nobodyActive = app.activeMemberIds.length === 0;
    const utilityGap = ref.utilityPoolTotal !== ref.utilityPoolCharged;

    if (extrasOnly) {
      bump(
        "extras-split-rounding",
        `seed ${seed} ${month}: pool ${app.extraPool.total} over ${app.activeMemberIds.length} members; Σ app ${extrasApp} vs Σ ref ${extrasRef} (Δ ${extrasApp - Number(extrasRef)})`,
      );
    } else if (nobodyActive && utilityGap) {
      bump(
        "utility-pool-with-no-active-members",
        `seed ${seed} ${month}: bill ${ref.utilityPoolTotal} with ${app.activeMemberIds.length} active members`,
      );
    } else {
      const which = [
        ...new Set(
          report.failures
            .filter((x) => x.month === month || x.month.startsWith(`${month} `))
            .map((x) => x.invariant),
        ),
      ].join(",");
      const sample = report.failures.find(
        (x) => x.month === month || x.month.startsWith(`${month} `),
      );
      bump(
        "unexplained",
        `seed ${seed} ${month}: invariants [${which}] ${sample?.detail ?? ""} | expected ${sample?.expected} actual ${sample?.actual}`,
      );
    }
  }
}

console.log(`triage over ${count} scenarios (seeds ${startSeed}..${startSeed + count - 1})\n`);
for (const [c, v] of [...causes.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${c}: ${v.n} month-instances`);
  for (const e of v.examples) console.log(`    ${e}`);
}
