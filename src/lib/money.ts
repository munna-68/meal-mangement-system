import { toBengaliDigits } from "./dates";

const TAKA = "\u09F3"; // ৳

/** Whole-taka amount with lakh-style grouping, e.g. ৳1,25,400. */
export function formatTaka(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${TAKA}${Math.abs(Math.round(amount)).toLocaleString("en-IN")}`;
}

export function formatTakaPlain(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.round(amount)).toLocaleString("en-IN")}`;
}

/** Bengali-digit variant used on the exported PDFs. */
export function formatTakaBengali(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}${TAKA}${toBengaliDigits(
    Math.abs(Math.round(amount)).toLocaleString("en-IN"),
  )}`;
}

export function formatSignedTaka(amount: number): string {
  if (amount > 0) return `+${formatTaka(amount)}`;
  return formatTaka(amount);
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Divide and round to whole taka, avoiding -0. */
export function roundTaka(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}
