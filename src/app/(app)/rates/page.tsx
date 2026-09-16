import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/server/auth";
import { getRateCards } from "@/server/queries";
import { RatesClient, type RateCardView } from "./rates-client";

export const metadata: Metadata = { title: "Rate Card" };

export default async function RatesPage() {
  await requireSession();
  const cards = await getRateCards();

  const views: RateCardView[] = cards.map((card) => ({
    id: card.id,
    label: card.label,
    effectiveFrom: card.effectiveFrom,
    effectiveTo: card.effectiveTo,
    fullMealRate: card.fullMealRate,
    halfMealRate: card.halfMealRate,
    guestFullRate: card.guestFullRate,
    guestHalfRate: card.guestHalfRate,
    sehriRate: card.sehriRate,
    feastFlatCharge: card.feastFlatCharge,
    khalaNormalRate: card.khalaNormalRate,
    khalaSoloRate: card.khalaSoloRate,
    managerDailyFee: card.managerDailyFee,
    dailyExtraAmount: card.dailyExtraAmount,
  }));

  return (
    <>
      <PageHeader
        title="Rate Card"
        description="The prices everything is computed from. Changes are versioned by effective date."
      />
      <RatesClient cards={views} />
    </>
  );
}
