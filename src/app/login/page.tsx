import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getMessSettings } from "@/server/queries";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const rawNext = searchParams.next;
  const next =
    typeof rawNext === "string" && rawNext.startsWith("/") ? rawNext : "/today";

  let hostelName = "Hostel Meal Manager";
  let address = "";
  try {
    const settings = await getMessSettings();
    if (settings) {
      hostelName = settings.hostelName;
      address = settings.address;
    }
  } catch {
    // The database may not be reachable yet; the login screen still works.
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl leading-snug">{hostelName}</CardTitle>
            {address ? (
              <CardDescription className="text-balance">{address}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <LoginForm next={next} />
            <p className="mt-4 text-center text-xs text-muted-foreground">
              One shared Manager PIN protects the register. Members do not sign in.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
