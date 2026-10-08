import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/server/auth";
import { getAccounts, getSettingsOrDefaults } from "@/server/queries";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Mess Settings" };

export default async function SettingsPage() {
  const user = await requireSession();
  const [settings, accounts] = await Promise.all([
    getSettingsOrDefaults(),
    getAccounts(),
  ]);

  return (
    <>
      <PageHeader
        title="Mess Settings"
        description="Who the mess is, which tracking modes are on, and who can sign in."
      />
      <SettingsClient
        hostelName={settings.hostelName}
        address={settings.address}
        ramadanMode={settings.ramadanMode}
        soloElectricityMultiplier={settings.soloElectricityMultiplier}
        soloWifiMultiplier={settings.soloWifiMultiplier}
        stickyGuestMealsFrom={settings.stickyGuestMealsFrom}
        accounts={accounts.map((account) => ({
          id: account.id,
          username: account.username,
          displayName: account.displayName,
          role: account.role,
          active: account.active,
          locked: account.locked,
          lockedUntil: account.lockedUntil ? account.lockedUntil.toISOString() : null,
          failedAttempts: account.failedAttempts,
          lastLoginAt: account.lastLoginAt ? account.lastLoginAt.toISOString() : null,
        }))}
        canManageAccounts={user.role === "OWNER"}
        currentAccountId={user.accountId}
      />
    </>
  );
}
