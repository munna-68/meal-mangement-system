"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-result";

/**
 * Runs a server action from a client component with a pending flag and a
 * consistent error surface. Any failed action is shown as a toast so a missed
 * return value never looks like success.
 */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(
    action: () => Promise<ActionResult>,
    options?: { onSuccess?: () => void; successMessage?: string },
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) {
          toast.success(
            result.message ?? options?.successMessage ?? "Saved",
          );
          options?.onSuccess?.();
        } else {
          const message = result.error ?? "Something went wrong";
          setError(message);
          toast.error(message);
        }
      } catch (thrown) {
        const message =
          thrown instanceof Error ? thrown.message : "Something went wrong";
        setError(message);
        toast.error(message);
      }
    });
  }

  return { run, pending, error, setError };
}
