import styles from "./bazar-slip.module.css";

import type { DayTotals, RoomDayRow } from "@/lib/calc";
import {
  formatBengaliDate,
  toBengaliDigits,
  type DateKey,
} from "@/lib/dates";
import { formatTakaBengali } from "@/lib/money";

export interface BazarSlipProps {
  hostelName: string;
  address: string;
  date: DateKey;
  dutyRoomNumbers: string[];
  khalaDidShopping: boolean;
  rooms: RoomDayRow[];
  totals: DayTotals;
  deductionReason: string | null;
  advanceGiven: number;
  actualExpense: number;
  changeReturned: number;
  menuNight: string | null;
  menuMorning: string | null;
  menuNoon: string | null;
  ramadanMode: boolean;
}

const bn = toBengaliDigits;

function Money({ amount }: { amount: number }) {
  return <span className={styles.summaryAmount}>{formatTakaBengali(amount)}</span>;
}

export function BazarSlip({
  hostelName,
  address,
  date,
  dutyRoomNumbers,
  khalaDidShopping,
  rooms,
  totals,
  deductionReason,
  advanceGiven,
  actualExpense,
  changeReturned,
  menuNight,
  menuMorning,
  menuNoon,
  ramadanMode,
}: BazarSlipProps) {
  const dutyLabel =
    dutyRoomNumbers.length > 0
      ? dutyRoomNumbers.map((room) => `রুম ${bn(room)}`).join(" + ")
      : "নির্ধারিত হয়নি";

  const showSehri = ramadanMode && totals.sehriCount > 0;

  return (
    <div className={styles.slip} lang="bn">
      <div className={styles.header}>
        <div className={styles.hostel}>{hostelName}</div>
        <div className={styles.address}>{address}</div>
        <div className={styles.title}>মিলের হিসাব</div>
      </div>

      <div className={styles.metaRow}>
        <span>
          তারিখ: <span className={styles.metaStrong}>{formatBengaliDate(date)}</span>
        </span>
        <span>
          বাজারদার: <span className={styles.metaStrong}>{dutyLabel}</span>
        </span>
      </div>
      {khalaDidShopping ? (
        <div className={styles.metaRow}>
          <span className={styles.deductionReason}>খালা বাজার করেছে</span>
        </div>
      ) : null}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>রুম</th>
            <th>ফুল</th>
            <th>হাফ</th>
            <th>গেস্ট</th>
            {showSehri ? <th>সেহরি</th> : null}
            <th>মোট</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr key={room.roomId}>
              <td className={styles.room}>{bn(room.roomNumber)}</td>
              <td>{bn(room.fullCount)}</td>
              <td>{bn(room.halfCount)}</td>
              <td>{bn(room.guestFullCount + room.guestHalfCount)}</td>
              {showSehri ? <td>{bn(room.sehriCount)}</td> : null}
              <td>{bn(room.totalMeals)}</td>
            </tr>
          ))}
          <tr>
            <td className={styles.room}>সর্বমোট</td>
            <td>{bn(totals.fullCount)}</td>
            <td>{bn(totals.halfCount)}</td>
            <td>{bn(totals.guestFullCount + totals.guestHalfCount)}</td>
            {showSehri ? <td>{bn(totals.sehriCount)}</td> : null}
            <td>
              {bn(
                totals.fullCount +
                  totals.halfCount +
                  totals.guestFullCount +
                  totals.guestHalfCount,
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <div className={styles.summary}>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>ফুল মিল (Full Meal)</span>
          <span className={styles.summaryLabel}>
            {bn(totals.fullCount)} × {bn(totals.rateCard?.fullMealRate ?? 0)}
          </span>
          <Money amount={totals.fullAmount} />
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>হাফ মিল (Half Meal)</span>
          <span className={styles.summaryLabel}>
            {bn(totals.halfCount)} × {bn(totals.rateCard?.halfMealRate ?? 0)}
          </span>
          <Money amount={totals.halfAmount} />
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>গেস্ট ফুল মিল</span>
          <span className={styles.summaryLabel}>
            {bn(totals.guestFullCount)} × {bn(totals.rateCard?.guestFullRate ?? 0)}
          </span>
          <Money amount={totals.guestFullAmount} />
        </div>
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>গেস্ট হাফ মিল</span>
          <span className={styles.summaryLabel}>
            {bn(totals.guestHalfCount)} × {bn(totals.rateCard?.guestHalfRate ?? 0)}
          </span>
          <Money amount={totals.guestHalfAmount} />
        </div>
        {showSehri ? (
          <div className={styles.summaryRow}>
            <span className={styles.summaryLabel}>সেহরি</span>
            <span className={styles.summaryLabel}>
              {bn(totals.sehriCount)} × {bn(totals.rateCard?.sehriRate ?? 0)}
            </span>
            <Money amount={totals.sehriAmount} />
          </div>
        ) : null}
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>এক্সট্রা (Extra)</span>
          <span className={styles.summaryLabel} />
          <Money amount={totals.extraAmount} />
        </div>
        {totals.deductionAmount > 0 ? (
          <div className={`${styles.summaryRow} ${styles.deduction}`}>
            <span className={styles.summaryLabel}>
              বাদ (Deduction)
              {deductionReason ? (
                <span className={styles.deductionReason}> — {deductionReason}</span>
              ) : null}
            </span>
            <span className={styles.summaryLabel} />
            <span className={styles.summaryAmount}>
              −{formatTakaBengali(totals.deductionAmount)}
            </span>
          </div>
        ) : null}
      </div>

      <div className={styles.totalRow}>
        <span>মোট টাকা (Total)</span>
        <span>{formatTakaBengali(totals.totalBudget)}</span>
      </div>

      <div className={styles.cash}>
        <div className={styles.cashRow}>
          <span>বাজারের খরচ (Market Expense)</span>
          <span>{formatTakaBengali(actualExpense)}</span>
        </div>
        <div className={styles.cashRow}>
          <span>অগ্রিম দেওয়া (Given / Advance)</span>
          <span>{formatTakaBengali(advanceGiven)}</span>
        </div>
        <div className={`${styles.cashRow} ${styles.cashStrong}`}>
          <span>ফেরত (Returned)</span>
          <span>{formatTakaBengali(changeReturned)}</span>
        </div>
      </div>

      <div className={styles.menu}>
        <div className={styles.menuTitle}>মেনু (Menu)</div>
        <div className={styles.menuLine}>
          <span className={styles.menuLabel}>রাত</span>
          <span className={styles.menuValue}>{menuNight ?? ""}</span>
        </div>
        <div className={styles.menuLine}>
          <span className={styles.menuLabel}>সকাল</span>
          <span className={styles.menuValue}>{menuMorning ?? ""}</span>
        </div>
        <div className={styles.menuLine}>
          <span className={styles.menuLabel}>দুপুর</span>
          <span className={styles.menuValue}>{menuNoon ?? ""}</span>
        </div>
      </div>

      <div className={styles.footerNote}>
        বাজেট নির্ধারিত রেট অনুযায়ী — প্রকৃত খরচ আলাদাভাবে হিসাব করা হয়।
      </div>
    </div>
  );
}
