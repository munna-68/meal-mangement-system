"use server";

import { redirect } from "next/navigation";

import { signIn, signOut } from "@/server/auth";

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextParam = String(formData.get("next") ?? "/today");

  if (!username || !password) {
    return { error: "Enter your username and password." };
  }

  try {
    const result = await signIn(username, password);
    if (!result.ok) return { error: result.error };
  } catch (error) {
    // A misconfigured SESSION_SECRET must stay loud rather than looking like a
    // wrong password; anything else is reported as a normal sign-in failure.
    if (error instanceof Error && error.message.includes("SESSION_SECRET")) {
      throw error;
    }
    return { error: "Could not sign you in right now. Try again." };
  }

  const destination =
    nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/today";
  redirect(destination);
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}
