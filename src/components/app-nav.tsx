"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Banknote,
  CalendarDays,
  Calculator,
  ClipboardList,
  FileSpreadsheet,
  LogOutIcon,
  MenuIcon,
  ReceiptText,
  Settings,
  Tags,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { cn } from "cn";

import { logoutAction } from "@/app/login/actions";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  primary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/today",
    label: "Today's Bazar",
    short: "Bazar",
    icon: Calculator,
    primary: true,
  },
  {
    href: "/meals",
    label: "Meal Status",
    short: "Meals",
    icon: ClipboardList,
    primary: true,
  },
  {
    href: "/balances",
    label: "Balances",
    short: "Balances",
    icon: Wallet,
    primary: true,
  },
  { href: "/settlement", label: "Settlement", short: "Settlement", icon: FileSpreadsheet },
  { href: "/members", label: "Members & Rooms", short: "Members", icon: UsersRound },
  { href: "/roster", label: "Bazar Roster", short: "Roster", icon: CalendarDays },
  { href: "/deposits", label: "Deposits", short: "Deposits", icon: Banknote },
  { href: "/extras", label: "Extras & Bills", short: "Extras", icon: ReceiptText },
  { href: "/rates", label: "Rate Card", short: "Rates", icon: Tags },
  { href: "/settings", label: "Mess Settings", short: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/today") return pathname === "/" || pathname.startsWith("/today") || pathname.startsWith("/bazar");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The full screen list, opened from the header on small screens. */
function AllScreensSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle>All screens</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate to any screen in the mess register.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-1 px-4 pb-6">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onOpenChange(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Opens the full screen list. This sits in the header rather than the bottom
 * bar so the bottom bar can carry Lock, which is used far more often than the
 * four screens that do not fit there.
 */
export function MobileMenuButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="All screens"
        onClick={() => setOpen(true)}
      >
        <MenuIcon />
      </Button>
      <AllScreensSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const primary = NAV_ITEMS.filter((item) => item.primary);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <div className="grid grid-cols-4">
        {primary.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" />
              {item.short}
            </Link>
          );
        })}

        <form action={logoutAction} className="contents">
          <button
            type="submit"
            className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground"
          >
            <LogOutIcon className="size-5" />
            Lock
          </button>
        </form>
      </div>
    </nav>
  );
}
