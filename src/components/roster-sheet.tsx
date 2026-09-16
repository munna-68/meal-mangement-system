import styles from "./roster-sheet.module.css";

import {
  dayParts,
  formatBengaliMonth,
  toBengaliDigits,
  type MonthKey,
} from "@/lib/dates";

export interface RosterSheetRow {
  date: string;
  roomNumbers: string[];
  khalaDidShopping: boolean;
  note: string | null;
}

export interface RosterSheetProps {
  hostelName: string;
  address: string;
  month: MonthKey;
  rows: RosterSheetRow[];
}

const bn = toBengaliDigits;

/**
 * The month's bazar duty list as a tall portrait sheet, so it stays readable
 * when it is shared into the group chat and opened on a phone.
 */
export function RosterSheet({
  hostelName,
  address,
  month,
  rows,
}: RosterSheetProps) {
  return (
    <div className={styles.sheet} lang="bn">
      <div className={styles.header}>
        <div className={styles.hostel}>{hostelName}</div>
        <div className={styles.address}>{address}</div>
        <div className={styles.title}>বাজারের ডিউটি</div>
        <div className={styles.monthLine}>{formatBengaliMonth(month)}</div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>তারিখ</th>
            <th>বার</th>
            <th>রুম / বাজারকারী</th>
            <th>নোট</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { day, weekday } = dayParts(row.date);
            return (
              <tr
                key={row.date}
                className={row.khalaDidShopping ? styles.khala : undefined}
              >
                <td className={styles.date}>{bn(day)}</td>
                <td className={styles.day}>{weekday}</td>
                <td className={styles.rooms}>
                  {row.khalaDidShopping
                    ? "খালা বাজার করেছে"
                    : row.roomNumbers.length > 0
                      ? row.roomNumbers.map((room) => `রুম ${bn(room)}`).join(" + ")
                      : "—"}
                </td>
                <td className={styles.note}>{row.note ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={styles.footerNote}>
        মাসের বাজারের ডিউটি তালিকা — পরিবর্তন হলে নতুন তালিকা নিন।
      </div>
    </div>
  );
}
