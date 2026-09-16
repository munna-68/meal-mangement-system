/**
 * Calendar dates are handled as plain "YYYY-MM-DD" strings everywhere. All
 * arithmetic goes through UTC so a server in any timezone computes the same
 * result, and "today" is resolved in the mess's own timezone rather than the
 * server's.
 */

export type DateKey = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

export const APP_TIME_ZONE = "Asia/Dhaka";

const EN_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const BN_MONTHS = [
  "জানুয়ারি",
  "ফেব্রুয়ারি",
  "মার্চ",
  "এপ্রিল",
  "মে",
  "জুন",
  "জুলাই",
  "আগস্ট",
  "সেপ্টেম্বর",
  "অক্টোবর",
  "নভেম্বর",
  "ডিসেম্বর",
];

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export function toBengaliDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

/** Today's date in the mess's timezone, as "YYYY-MM-DD". */
export function todayKey(timeZone: string = APP_TIME_ZONE): DateKey {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function currentMonthKey(timeZone: string = APP_TIME_ZONE): MonthKey {
  return todayKey(timeZone).slice(0, 7);
}

function parts(key: DateKey): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

function toUTC(key: DateKey): Date {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(date: Date): DateKey {
  return date.toISOString().slice(0, 10);
}

export function isValidDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = parts(value);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

export function isValidMonthKey(value: unknown): value is MonthKey {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = toUTC(key);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUTC(date);
}

export function addMonths(month: MonthKey, months: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  return fromUTC(date).slice(0, 7);
}

export function monthOf(key: DateKey): MonthKey {
  return key.slice(0, 7);
}

export function monthStart(month: MonthKey): DateKey {
  return `${month}-01`;
}

export function monthEnd(month: MonthKey): DateKey {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m, 0));
  return fromUTC(date);
}

export function daysInMonth(month: MonthKey): DateKey[] {
  const start = monthStart(month);
  const end = monthEnd(month);
  return eachDay(start, end);
}

export function eachDay(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = [];
  let cursor = from;
  let guard = 0;
  while (compare(cursor, to) <= 0) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
    if (++guard > 4000) break;
  }
  return out;
}

/** Lexicographic comparison is chronological for zero-padded date keys. */
export function compare(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBefore(a: DateKey, b: DateKey): boolean {
  return compare(a, b) < 0;
}

export function isAfter(a: DateKey, b: DateKey): boolean {
  return compare(a, b) > 0;
}

export function isSameOrBefore(a: DateKey, b: DateKey): boolean {
  return compare(a, b) <= 0;
}

export function isSameOrAfter(a: DateKey, b: DateKey): boolean {
  return compare(a, b) >= 0;
}

export function clampKey(value: DateKey, min: DateKey, max: DateKey): DateKey {
  if (compare(value, min) < 0) return min;
  if (compare(value, max) > 0) return max;
  return value;
}

export function formatDisplay(key: DateKey): string {
  const [y, m, d] = parts(key);
  return `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

export function formatLongDisplay(key: DateKey): string {
  const [y, m, d] = parts(key);
  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  }).format(toUTC(key));
  return `${weekday}, ${d} ${EN_MONTHS[m - 1]} ${y}`;
}

export function formatMonthDisplay(month: MonthKey): string {
  const [y, m] = month.split("-").map(Number);
  return `${EN_MONTHS[m - 1]} ${y}`;
}

export function formatMonthLongDisplay(month: MonthKey): string {
  const [y, m] = month.split("-").map(Number);
  const full = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `${full} ${y}`;
}

export function formatBengaliDate(key: DateKey): string {
  const [y, m, d] = parts(key);
  return `${toBengaliDigits(d)} ${BN_MONTHS[m - 1]} ${toBengaliDigits(y)}`;
}

/**
 * Dotted numeric date in Bengali digits — "১৭.০৯.২০২৬". This is the format the
 * mess writes in the তারিখ box on the paper slip.
 */
export function formatBengaliNumericDate(key: DateKey): string {
  const [y, m, d] = parts(key);
  return toBengaliDigits(`${d}.${m}.${y}`);
}

export function formatBengaliMonth(month: MonthKey): string {
  const [y, m] = month.split("-").map(Number);
  return `${BN_MONTHS[m - 1]} ${toBengaliDigits(y)}`;
}

/** Minutes offset of the app timezone at a given instant, for display purposes. */
export function dayOfWeek(key: DateKey): number {
  return toUTC(key).getUTCDay();
}
