import styles from "./meal-register-sheet.module.css";

import type { MealStatus, RegisterRow } from "@/lib/calc";
import {
  formatBengaliMonth,
  toBengaliDigits,
  type DateKey,
  type MonthKey,
} from "@/lib/dates";

export interface MealRegisterSheetProps {
  hostelName: string;
  address: string;
  month: MonthKey;
  days: DateKey[];
  rows: RegisterRow[];
}

const bn = toBengaliDigits;

/** F / D / N codes, matching the register the mess already keeps by hand. */
const STATUS_CODE: Record<MealStatus, string> = {
  FULL: "F",
  HALF_DAY: "D",
  HALF_NIGHT: "N",
  OFF: "·",
};

const LEGEND: Array<{ code: string; label: string }> = [
  { code: "F", label: "ফুল" },
  { code: "D", label: "হাফ ডে" },
  { code: "N", label: "হাফ নাইট" },
  { code: "·", label: "বন্ধ" },
];

function dayNumber(day: DateKey): string {
  return bn(String(Number(day.slice(8, 10))));
}

/**
 * Monthly meal register — one row per member, one column per day, coded
 * F / D / N / ·, in the same shape as the mess's paper attendance register.
 * The month is split into two half-month blocks so it fits a landscape page.
 */
export function MealRegisterSheet({
  hostelName,
  address,
  month,
  days,
  rows,
}: MealRegisterSheetProps) {
  const firstHalf = days.slice(0, 15);
  const secondHalf = days.slice(15);

  return (
    <div className={styles.sheet} lang="bn">
      <div className={styles.header}>
        <div className={styles.hostel}>{hostelName}</div>
        <div className={styles.address}>{address}</div>
        <div className={styles.title}>মিলের হিসাব</div>
        <div className={styles.monthLine}>মাসিক মিল রেজিস্টার — {formatBengaliMonth(month)}</div>
        <div className={styles.legend}>
          {LEGEND.map((entry) => (
            <span key={entry.code}>
              <span className={styles.legendKey}>{entry.code}</span> = {entry.label}
            </span>
          ))}
        </div>
      </div>

      <table className={styles.table}>
        <colgroup>
          <col style={{ width: 34 }} />
          <col style={{ width: 50 }} />
          <col style={{ width: 132 }} />
          {firstHalf.map((day) => (
            <col key={day} style={{ width: 25 }} />
          ))}
          {secondHalf.map((day) => (
            <col key={day} style={{ width: 25 }} />
          ))}
          <col style={{ width: 42 }} />
          <col style={{ width: 42 }} />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>ক্রম</th>
            <th rowSpan={2}>রুম</th>
            <th rowSpan={2}>নাম</th>
            {firstHalf.map((day) => (
              <th key={day}>{dayNumber(day)}</th>
            ))}
            {secondHalf.map((day, index) => (
              <th key={day} className={index === 0 ? styles.blockStart : undefined}>
                {dayNumber(day)}
              </th>
            ))}
            <th rowSpan={2} className={styles.blockStart}>
              ফুল
            </th>
            <th rowSpan={2}>হাফ</th>
          </tr>
          <tr>
            <th colSpan={firstHalf.length}>১ – ১৫</th>
            <th colSpan={secondHalf.length}>১৬ – {dayNumber(days[days.length - 1])}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.memberId}>
              <td className={styles.idx}>{bn(index + 1)}</td>
              <td className={styles.room}>{bn(row.roomNumber)}</td>
              <td className={styles.name}>{row.name}</td>
              {row.cells.map((cell, cellIndex) => {
                if (cell.status === null) {
                  return (
                    <td
                      key={cell.day}
                      className={`${styles.blank} ${cellIndex === 15 ? styles.blockStart : ""}`}
                    >
                      –
                    </td>
                  );
                }
                const isOff = cell.status === "OFF";
                return (
                  <td
                    key={cell.day}
                    className={`${styles.code} ${isOff ? styles.codeOff : ""} ${
                      cellIndex === 15 ? styles.blockStart : ""
                    }`}
                  >
                    {STATUS_CODE[cell.status]}
                  </td>
                );
              })}
              <td className={`${styles.total} ${styles.blockStart}`}>{bn(row.fullCount)}</td>
              <td className={styles.total}>{bn(row.halfCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.footerNote}>
        সম্পূর্ণ মাসের সদস্যভিত্তিক মিলের হিসাব — ফুল ও হাফ কলাম চূড়ান্ত হিসাবের সাথে মিলবে।
      </div>
    </div>
  );
}
