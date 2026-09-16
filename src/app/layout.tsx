import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { Toaster } from "@/components/ui/sonner";
import { cn } from "cn";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Hostel Meal Manager",
    template: "%s · Hostel Meal Manager",
  },
  description: "Mess accounting for a hostel: meals, bazar, bills and settlement.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(geistSans.variable, geistMono.variable, "h-full antialiased")}
    >
      {/*
        Browser extensions (ColorZilla and friends) inject attributes such as
        `cz-shortcut-listen` into <body> before React hydrates, which trips a
        hydration mismatch that has nothing to do with this app.
      */}
      <body className="min-h-full bg-background" suppressHydrationWarning>
        {children}
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
