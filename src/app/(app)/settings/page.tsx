import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/server/auth";
import { getSettingsOrDefaults } from "@/server/queries";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Mess Settings" };

export default async function SettingsPage() {
  await requireSession();
  const settings = await getSettingsOrDefaults();

  return (
    <>
      <PageHeader
        title="Mess Settings"
        description="Who the mess is, and which tracking modes are on."
      />
      <SettingsClient
        hostelName={settings.hostelName}
        address={settings.address}
        ramadanMode={settings.ramadanMode}
      />
    </>
  );
}
