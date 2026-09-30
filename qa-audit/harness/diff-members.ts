/**
 * Side-by-side per-member comparison of the app and the reference for one
 * scenario, so a disagreement can be attributed to a specific column.
 */
import {
  computeMonth,
  type ExtraItemData,
} from "../../src/lib/calc";
import { monthEnd } from "../../src/lib/dates";
import { makeScenario } from "../random/scenarios";
import { refComputeMonth, type RefRateCard, type RefRoom } from "../ref/reference";

const seed = Number(process.argv[2] ?? 3);
const edge = process.argv[3] === "edge";
const s = makeScenario(seed, { edge });

for (const month of s.months) {
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
  const ref = refComputeMonth(
    {
      month,
      members: s.members,
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

  const appRows = [...app.perMember.values()];
  const refRows = [...ref.perMember.values()];
  const nameOf = new Map(s.members.map((m) => [m.id, m.name]));
  console.log(`\n=== ${month} === solo app ${app.activeMemberIds.length} ref ${ref.activeIds.length}`);
  console.log(
    ["member", "mealA", "mealR", "khalaA", "khalaR", "elecA", "elecR", "wifiA", "wifiR", "extraA", "extraR", "costA", "costR"]
      .join("\t"),
  );
  for (const a of appRows) {
    const r = refRows.find((x) => x.memberId === a.memberId)!;
    console.log(
      [
        (nameOf.get(a.memberId) ?? a.memberId).slice(0, 16),
        a.mealAmount, Number(r.mealCost),
        a.khalaAmount, Number(r.khala),
        a.electricityAmount, Number(r.electricity),
        a.wifiAmount, Number(r.wifi),
        a.extraAmount, Number(r.extras),
        a.totalCost, Number(r.totalCost),
      ].join("\t"),
    );
  }
  const t = (fn: (x: (typeof appRows)[number]) => number) => appRows.reduce((s, x) => s + fn(x), 0);
  console.log("totals", {
    appCost: t((x) => x.totalCost),
    refCost: Number(ref.totalCost),
    appUtility: t((x) => x.khalaElecWifiAmount),
    refUtility: Number(ref.utilityPoolCharged),
    appExtras: t((x) => x.extraAmount),
    refExtras: Number([...ref.perMember.values()].reduce((a, b) => a + b.extras, BigInt(0))),
  });
  console.log("bills", JSON.stringify(s.bills), "mult", s.soloElectricityMultiplier, s.soloWifiMultiplier);
  console.log("rooms", JSON.stringify(s.rooms));
  console.log("members", s.members.map((m) => `${m.id}@${m.roomId}[${m.joinDate}..${m.leaveDate ?? "-"}]`).join(" "));
}
