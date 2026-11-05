import type { ReactNode } from "react";
import Link from "next/link";
import { UtensilsCrossedIcon } from "lucide-react";

import { DesktopNav, MobileMenuButton, MobileNav } from "@/components/app-nav";
import { LogoutButton } from "@/components/logout-button";
import { requireSession } from "@/server/auth";
import { getSettingsOrDefaults } from "@/server/queries";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSession();
  const settings = await getSettingsOrDefaults();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/today" className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
              >
                <UtensilsCrossedIcon className="size-4.5" />
              </span>
              <span className="min-w-0">
              <p className="truncate font-heading text-sm font-semibold leading-tight sm:text-base">
                {settings.hostelName}
              </p>
              <p className="truncate text-[11px] leading-tight text-muted-foreground sm:text-xs">
                {settings.address}
              </p>
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {settings.ramadanMode ? (
              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                Ramadan
              </span>
            ) : null}
            <span
              className="hidden max-w-32 truncate text-xs text-muted-foreground sm:inline"
              title={`Signed in as ${user.username} (${user.role.toLowerCase()})`}
            >
              {user.displayName}
            </span>
            <MobileMenuButton />
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-4 lg:pb-8">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20">
            <DesktopNav />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <MobileNav />
    </div>
  );
}
