import type { Metadata } from "next";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KeyRoundIcon } from "lucide-react";
import { countAccounts, getMessSettings } from "@/server/queries";
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
  let hasAccounts: boolean | null = null;

  try {
    const settings = await getMessSettings();
    if (settings) {
      hostelName = settings.hostelName;
      address = settings.address;
    }
    hasAccounts = (await countAccounts()) > 0;
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
            {hasAccounts === false ? (
              <Alert>
                <KeyRoundIcon />
                <AlertTitle>No sign-ins exist yet</AlertTitle>
                <AlertDescription className="text-xs">
                  Create the first owner account by running{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    npm run db:seed
                  </code>{" "}
                  with <code className="rounded bg-muted px-1 py-0.5">ADMIN_USERNAME</code>{" "}
                  and <code className="rounded bg-muted px-1 py-0.5">ADMIN_PASSWORD</code>{" "}
                  set in <code className="rounded bg-muted px-1 py-0.5">.env</code>. The
                  password must be at least 8 characters and not a known default.
                </AlertDescription>
              </Alert>
            ) : (
              <LoginForm next={next} />
            )}
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Every manager signs in with their own account, so each change to the
              register is recorded against a person.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
