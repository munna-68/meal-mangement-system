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
  const pin = String(formData.get("pin") ?? "").trim();
  const nextParam = String(formData.get("next") ?? "/today");

  if (!pin) {
    return { error: "Enter the PIN to continue." };
  }

  const ok = await signIn(pin);
  if (!ok) {
    return { error: "That PIN is not correct." };
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
