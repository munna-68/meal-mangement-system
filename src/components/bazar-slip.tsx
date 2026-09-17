import styles from "./bazar-slip.module.css";

import type { DayTotals, RoomDayRow } from "@/lib/calc";
import {
  formatBengaliNumericDate,
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
  ramadanMode: boolean;
}

const bn = toBengaliDigits;

/**
 * The daily bazar slip, laid out to match the mess's paper form: the room grid
 * on the left (রাত / দুপুর per room, guests noted as "২+১") and the money box on
 * the right. There is deliberately no menu section.
 */
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
  ramadanMode,
}: BazarSlipProps) {
  const dutyLabel =
    dutyRoomNumbers.length > 0
      ? dutyRoomNumbers.map((room) => `রুম ${bn(room)}`).join(" + ")
      : "নির্ধারিত হয়নি";

  const showSehri = ramadanMode && totals.sehriCount > 0;
  const rate = totals.rateCard;
  const grandGuestFull = rooms.reduce(
    (total, room) => total + room.guestFullCount,
    0,
  );
  const grandGuestHalf = rooms.reduce(
    (total, room) => total + room.guestHalfCount,
    0,
  );

  return (
    <div className={styles.slip} lang="bn">
      <div className={styles.header}>
        <div className={styles.hostel}>{hostelName}</div>
        <div className={styles.address}>{address}</div>
        <div className={styles.title}>মিলের হিসাব</div>
      </div>

      <div className={styles.metaRow}>
        <span>
          তারিখ:{" "}
          <span className={styles.metaStrong}>
            {formatBengaliNumericDate(date)}
          </span>
        </span>
        <span>
          বাজারকারী রুম নং:{" "}
          <span className={styles.metaStrong}>{dutyLabel}</span>
        </span>
      </div>

      <div className={styles.body}>
        <table className={styles.roomTable}>
          <thead>
            <tr>
              <th>ক্রম নং</th>
              <th>রাত</th>
              <th>দুপুর</th>
              <th className={styles.guestCol}>গেস্ট ফুল</th>
              <th className={styles.guestCol}>গেস্ট হাফ</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.roomId} className={styles.roomRow}>
                <td className={styles.roomNo}>{bn(room.roomNumber)}</td>
                <td className={styles.mealCount}>{bn(room.nightCount)}</td>
                <td className={styles.mealCount}>{bn(room.noonCount)}</td>
                <td className={styles.guestCell}>
                  {room.guestFullCount > 0 ? bn(room.guestFullCount) : "—"}
                </td>
                <td className={styles.guestCell}>
                  {room.guestHalfCount > 0 ? bn(room.guestHalfCount) : "—"}
                </td>
              </tr>
            ))}
            <tr className={styles.filler} aria-hidden>
              <td />
              <td />
              <td />
              <td className={styles.guestCell} />
              <td className={styles.guestCell} />
            </tr>
            <tr className={styles.grandTotal}>
              <td>মোট</td>
              <td className={styles.mealCount}>{bn(totals.nightCount)}</td>
              <td className={styles.mealCount}>{bn(totals.noonCount)}</td>
              <td className={styles.guestCell}>{bn(grandGuestFull)}</td>
              <td className={styles.guestCell}>{bn(grandGuestHalf)}</td>
            </tr>
          </tbody>
        </table>

        <div className={styles.moneyCol}>
          <div className={styles.moneyBox}>
            <div className={styles.moneyRow}>
              <span className={styles.moneyLabel}>ফুল মিল</span>
              <span className={styles.moneyFormula}>
                {bn(totals.fullCount)} × {bn(rate?.fullMealRate ?? 0)} =
              </span>
              <span className={styles.moneyAmount}>
                {formatTakaBengali(totals.fullAmount)}
              </span>
            </div>

            <div className={styles.moneyRow}>
              <span className={styles.moneyLabel}>হাফ মিল</span>
              <span className={styles.moneyFormula}>
                {bn(totals.halfCount)} × {bn(rate?.halfMealRate ?? 0)} =
              </span>
              <span className={styles.moneyAmount}>
                {formatTakaBengali(totals.halfAmount)}
              </span>
            </div>

            <div className={styles.moneyRow}>
              <span className={styles.moneyLabel}>গেস্ট ফুল মিল</span>
              <span className={styles.moneyFormula}>
                {bn(totals.guestFullCount)} × {bn(rate?.guestFullRate ?? 0)} =
              </span>
              <span className={styles.moneyAmount}>
                {formatTakaBengali(totals.guestFullAmount)}
              </span>
            </div>

            <div className={styles.moneyRow}>
              <span className={styles.moneyLabel}>গেস্ট হাফ</span>
              <span className={styles.moneyFormula}>
                {bn(totals.guestHalfCount)} × {bn(rate?.guestHalfRate ?? 0)} =
              </span>
              <span className={styles.moneyAmount}>
                {formatTakaBengali(totals.guestHalfAmount)}
              </span>
            </div>

            {showSehri ? (
              <div className={styles.moneyRow}>
                <span className={styles.moneyLabel}>সেহরি</span>
                <span className={styles.moneyFormula}>
                  {bn(totals.sehriCount)} × {bn(rate?.sehriRate ?? 0)} =
                </span>
                <span className={styles.moneyAmount}>
                  {formatTakaBengali(totals.sehriAmount)}
                </span>
              </div>
            ) : null}

            <div className={styles.moneyDivider} />

            {totals.extraItems.length > 0 ? (
              totals.extraItems.map((item) => (
                <div className={styles.moneyRow} key={item.id}>
                  <span className={styles.moneyLabel}>
                    {item.category === "RECURRING_DAILY"
                      ? "দৈনিক অতিরিক্ত"
                      : item.category === "MANAGER_FEE"
                        ? "ম্যানেজারের দৈনিক ফি"
                        : item.label}
                  </span>
                  <span className={styles.moneyFormula} />
                  <span className={styles.moneyAmount}>
                    +{formatTakaBengali(item.amount)}
                  </span>
                </div>
              ))
            ) : (
              <div className={styles.moneyRow}>
                <span className={styles.moneyLabel}>অতিরিক্ত</span>
                <span className={styles.moneyFormula} />
                <span className={styles.moneyAmount}>
                  +{formatTakaBengali(0)}
                </span>
              </div>
            )}

            {totals.deductionAmount > 0 ? (
              <div className={`${styles.moneyRow} ${styles.deductionRow}`}>
                <span className={styles.moneyLabel}>
                  বাদ
                  {deductionReason ? ` — ${deductionReason}` : ""}
                </span>
                <span className={styles.moneyFormula} />
                <span className={styles.moneyAmount}>
                  −{formatTakaBengali(totals.deductionAmount)}
                </span>
              </div>
            ) : null}

            <div className={`${styles.moneyRow} ${styles.moneyTotal}`}>
              <span className={styles.moneyLabel}>মোট টাকা =</span>
              <span className={styles.moneyFormula} />
              <span className={styles.moneyAmount}>
                {formatTakaBengali(totals.totalBudget)}
              </span>
            </div>
          </div>

          <div className={styles.cashBox}>
            <div className={styles.moneyRow}>
              <span className={styles.moneyLabel}>বাজার খরচ</span>
              <span className={styles.moneyAmount}>
                {formatTakaBengali(actualExpense)}
              </span>
            </div>

            <div className={styles.moneyRow}>
              <span className={styles.moneyLabel}>প্রদত্ত টাকা</span>
              <span className={styles.moneyAmount}>
                {formatTakaBengali(advanceGiven)}
              </span>
            </div>

            <div className={styles.moneyRow}>
              <span className={styles.moneyLabel}>ফেরত টাকা</span>
              <span className={styles.moneyAmount}>
                {formatTakaBengali(changeReturned)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {khalaDidShopping ? (
        <div className={styles.footerNote}>
          <span className={styles.khalaNote}>খালা বাজার করেছে।</span>
        </div>
      ) : null}

      <div className={styles.footerNote}>
        বাজেট নির্ধারিত রেট অনুযায়ী — প্রকৃত খরচ আলাদাভাবে হিসাব করা হয়।
      </div>
    </div>
  );
}
