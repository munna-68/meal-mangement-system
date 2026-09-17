import { cn } from "cn";

import styles from "./ledger-sheet.module.css";

import {
  formatBengaliMonth,
  formatBengaliNumericDate,
  toBengaliDigits,
  todayKey,
  type MonthKey,
} from "@/lib/dates";
import { formatTakaBengali } from "@/lib/money";

export interface LedgerRowView {
  memberId: string;
  roomNumber: string;
  memberName: string;
  fullMealCount: number;
  halfMealCount: number;
  sehriCount: number;
  guestFullCount: number;
  guestHalfCount: number;
  khalaElecWifiAmount: number;
  extraAmount: number;
  totalCost: number;
  openingBalance: number;
  newDeposits: number;
  availableBalance: number;
  closingBalance: number;
}

export function LedgerSheet({
  hostelName,
  address,
  month,
  previousMonthLabel,
  rows,
  ramadanMode,
}: {
  hostelName: string;
  address: string;
  month: MonthKey;
  previousMonthLabel: string;
  rows: LedgerRowView[];
  ramadanMode: boolean;
}) {
  const bn = toBengaliDigits;
  const totals = {
    cost: rows.reduce((total, row) => total + row.totalCost, 0),
    deposits: rows.reduce((total, row) => total + row.newDeposits, 0),
    available: rows.reduce((total, row) => total + row.availableBalance, 0),
    closing: rows.reduce((total, row) => total + row.closingBalance, 0),
  };

  return (
    <div className={styles.sheet} lang="bn">
      <div className={styles.header}>
        <div className={styles.hostel}>{hostelName}</div>
        <div className={styles.address}>{address}</div>
        <div className={styles.title}>মাসিক হিসাব — মিল ও খরচ</div>
      </div>

      <div className={styles.period}>
        <span>
          মাস: <strong>{formatBengaliMonth(month)}</strong>
        </span>
        <span>
          সদস্য সংখ্যা: <strong>{bn(rows.length)}</strong>
        </span>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>রুম নং</th>
            <th>নাম</th>
            <th>ফুল মিল</th>
            <th>হাফ মিল</th>
            {ramadanMode ? <th>সেহরি</th> : null}
            <th>গেস্ট ফুল</th>
            <th>গেস্ট হাফ</th>
            <th>
              খালা + ওয়াইফাই
              <br />
              + বিদ্যুৎ
            </th>
            <th>এক্সট্রা</th>
            <th>খরচ</th>
            <th>
              {previousMonthLabel}
              <br />
              জমা
            </th>
            <th>নতুন জমা</th>
            <th>জমার পর</th>
            <th>এ মাসের জমা</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.memberId}>
              <td>{bn(row.roomNumber)}</td>
              <td className={styles.name}>{row.memberName}</td>
              <td>{bn(row.fullMealCount)}</td>
              <td>{bn(row.halfMealCount)}</td>
              {ramadanMode ? <td>{bn(row.sehriCount)}</td> : null}
              <td>{bn(row.guestFullCount)}</td>
              <td>{bn(row.guestHalfCount)}</td>
              <td className={styles.numeric}>
                {formatTakaBengali(row.khalaElecWifiAmount)}
              </td>
              <td className={styles.numeric}>{formatTakaBengali(row.extraAmount)}</td>
              <td className={styles.numeric}>{formatTakaBengali(row.totalCost)}</td>
              <td
                className={cn(
                  styles.numeric,
                  row.openingBalance < 0 && styles.negative,
                )}
              >
                {formatTakaBengali(row.openingBalance)}
              </td>
              <td className={styles.numeric}>{formatTakaBengali(row.newDeposits)}</td>
              <td
                className={cn(
                  styles.numeric,
                  row.availableBalance < 0 && styles.negative,
                )}
              >
                {formatTakaBengali(row.availableBalance)}
              </td>
              <td
                className={cn(styles.numeric, row.closingBalance < 0 && styles.negative)}
              >
                {formatTakaBengali(row.closingBalance)}
              </td>
            </tr>
          ))}
          <tr className={styles.totalRow}>
            <td colSpan={ramadanMode ? 9 : 8}>সর্বমোট</td>
            <td className={styles.numeric}>{formatTakaBengali(totals.cost)}</td>
            <td />
            <td className={styles.numeric}>{formatTakaBengali(totals.deposits)}</td>
            <td className={styles.numeric}>{formatTakaBengali(totals.available)}</td>
            <td
              className={cn(styles.numeric, totals.closing < 0 && styles.negative)}
            >
              {formatTakaBengali(totals.closing)}
            </td>
          </tr>
        </tbody>
      </table>

      <div className={styles.footer}>
        <span>তারিখ: {formatBengaliNumericDate(todayKey())}</span>
      </div>
      <div className={styles.legend}>
        ঋণাত্মক (লাল) সংখ্যা মানে সদস্যের জমা খরচের চেয়ে কম — টাকা বাকি আছে।
      </div>
    </div>
  );
}
