import styles from "./balance-sheet.module.css";

import {
  formatBengaliDate,
  toBengaliDigits,
  type DateKey,
} from "@/lib/dates";
import { formatTakaBengali } from "@/lib/money";

export interface BalanceSheetRow {
  memberId: string;
  roomNumber: string;
  memberName: string;
  openingBalance: number;
  deposits: number;
  cost: number;
  balance: number;
}

export interface BalanceSheetProps {
  hostelName: string;
  address: string;
  periodStart: DateKey;
  periodEnd: DateKey;
  /** The day the sheet was produced, shown so a shared copy is never stale. */
  generatedOn: DateKey;
  rows: BalanceSheetRow[];
  summary: {
    balance: number;
    deposits: number;
    cost: number;
    openingBalance: number;
    membersInDeficit: number;
    totalDeficit: number;
  };
}

const bn = toBengaliDigits;

/**
 * The running balance position as a tall portrait sheet. Each member shows
 * whether they are in deficit or in credit, so a screenshot of this is enough
 * to answer "who owes what right now".
 */
export function BalanceSheet({
  hostelName,
  address,
  periodStart,
  periodEnd,
  generatedOn,
  rows,
  summary,
}: BalanceSheetProps) {
  const totals = rows.reduce(
    (acc, row) => ({
      opening: acc.opening + row.openingBalance,
      deposits: acc.deposits + row.deposits,
      cost: acc.cost + row.cost,
      balance: acc.balance + row.balance,
    }),
    { opening: 0, deposits: 0, cost: 0, balance: 0 },
  );

  return (
    <div className={styles.sheet} lang="bn">
      <div className={styles.header}>
        <div className={styles.hostel}>{hostelName}</div>
        <div className={styles.address}>{address}</div>
        <div className={styles.title}>ব্যালেন্স হিসাব</div>
        <div className={styles.periodLine}>
          {formatBengaliDate(periodStart)} — {formatBengaliDate(periodEnd)}
        </div>
        <div className={styles.generatedLine}>
          তারিখ: {formatBengaliDate(generatedOn)}
        </div>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryCell}>
          <div className={styles.summaryLabel}>মেস ব্যালেন্স</div>
          <div
            className={`${styles.summaryValue} ${
              summary.balance < 0 ? styles.negative : styles.positive
            }`}
          >
            {formatTakaBengali(summary.balance)}
          </div>
        </div>
        <div className={styles.summaryCell}>
          <div className={styles.summaryLabel}>জমা</div>
          <div className={styles.summaryValue}>
            {formatTakaBengali(summary.deposits)}
          </div>
        </div>
        <div className={styles.summaryCell}>
          <div className={styles.summaryLabel}>খরচ</div>
          <div className={styles.summaryValue}>
            {formatTakaBengali(summary.cost)}
          </div>
        </div>
        <div className={styles.summaryCell}>
          <div className={styles.summaryLabel}>পূর্বের ব্যালেন্স</div>
          <div className={styles.summaryValue}>
            {formatTakaBengali(summary.openingBalance)}
          </div>
        </div>
      </div>

      {summary.membersInDeficit > 0 ? (
        <div className={styles.alertLine}>
          {bn(summary.membersInDeficit)} জন সদস্যের ব্যালেন্স ঋণাত্মক — মোট{" "}
          {formatTakaBengali(summary.totalDeficit)} বাকি
        </div>
      ) : (
        <div className={styles.summaryCell} style={{ marginTop: 10 }}>
          <div className={styles.summaryLabel}>সবাই পরিশোধে আছে</div>
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>রুম</th>
            <th>নাম</th>
            <th>পূর্বের</th>
            <th>জমা</th>
            <th>খরচ</th>
            <th>ব্যালেন্স</th>
            <th>অবস্থা</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const negative = row.balance < 0;
            return (
              <tr
                key={row.memberId}
                className={negative ? styles.deficit : undefined}
              >
                <td className={styles.room}>{bn(row.roomNumber)}</td>
                <td>{row.memberName}</td>
                <td className={styles.num}>{formatTakaBengali(row.openingBalance)}</td>
                <td className={styles.num}>{formatTakaBengali(row.deposits)}</td>
                <td className={styles.num}>{formatTakaBengali(row.cost)}</td>
                <td className={`${styles.num} ${styles.balance}`}>
                  {formatTakaBengali(row.balance)}
                </td>
                <td className={styles.status}>
                  {negative ? "ঋণ" : "জমা"}
                </td>
              </tr>
            );
          })}
          <tr className={styles.totalRow}>
            <td colSpan={2}>মোট</td>
            <td className={styles.num}>{formatTakaBengali(totals.opening)}</td>
            <td className={styles.num}>{formatTakaBengali(totals.deposits)}</td>
            <td className={styles.num}>{formatTakaBengali(totals.cost)}</td>
            <td className={`${styles.num} ${styles.balance}`}>
              {formatTakaBengali(totals.balance)}
            </td>
            <td />
          </tr>
        </tbody>
      </table>

      <div className={styles.spacer} />

      <div className={styles.footerNote}>
        ব্যালেন্স = পূর্বের ব্যালেন্স + জমা − এখন পর্যন্ত খরচ।
      </div>
    </div>
  );
}
