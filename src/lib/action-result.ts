export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export const OK: ActionResult = { ok: true };

export function fail(error: string): ActionResult {
  return { ok: false, error };
}

export function ok(message?: string): ActionResult {
  return message ? { ok: true, message } : { ok: true };
}

export function firstIssue(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: { message?: string }[] }).issues;
    if (issues && issues.length > 0 && issues[0].message) {
      return issues[0].message;
    }
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
