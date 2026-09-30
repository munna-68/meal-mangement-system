import { z } from "zod";

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

/**
 * A money field typed by a human.
 *
 * Accepts what people actually type for taka — plain digits, Bengali digits, a
 * `৳` sign, and lakh grouping (`1,20,000`) — because that is the format every
 * printed sheet and handwritten book uses. An empty box is refused rather than
 * silently becoming ৳0, which is what `z.coerce.number()` does on its own.
 */
export function takaAmount(min = 0) {
  return z
    .preprocess(
      (value) =>
        typeof value === "string" && value.trim() === ""
          ? Number.NaN
          : normaliseTakaInput(value),
      z.coerce.number("Enter an amount, for example 1500").int("Whole taka only"),
    )
    .refine((value) => Number.isInteger(value) && value >= min, min === 0
      ? "Whole taka only, and it cannot be negative"
      : `Whole taka only, and it cannot be less than ${min}`);
}

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Strips the taka sign and grouping, and rewrites Bengali digits as ASCII. */
export function normaliseTakaInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const ascii = Array.from(value)
    .map((char) => {
      const index = BENGALI_DIGITS.indexOf(char);
      return index === -1 ? char : String(index);
    })
    .join("")
    .replace(/[৳\s,]/g, "");
  if (ascii === "") return Number.NaN;
  const parsed = Number(ascii);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * The one message a manager sees for a rejected field. Anything a validation
 * library produced internally ("expected int, received number") is replaced by
 * something that names the problem in words.
 */
export function firstIssue(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: { message?: string }[] }).issues;
    if (issues && issues.length > 0 && issues[0].message) {
      const message = issues[0].message;
      if (!message.startsWith("Invalid input:")) return message;
    }
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
