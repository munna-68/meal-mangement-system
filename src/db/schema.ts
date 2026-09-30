import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import type { RegisterSnapshot } from "@/lib/calc";

/** A member ate both meal-times that day. */
export const mealStatusEnum = pgEnum("meal_status", [
  "FULL",
  "HALF_DAY",
  "HALF_NIGHT",
  "OFF",
]);

export const guestMealTypeEnum = pgEnum("guest_meal_type", [
  "GUEST_FULL",
  "GUEST_HALF",
]);

export const extraCategoryEnum = pgEnum("extra_category", [
  "RECURRING_DAILY",
  "ONE_OFF",
  "MANAGER_FEE",
  "FEAST",
  "OTHER",
]);

export const utilityTypeEnum = pgEnum("utility_type", [
  "ELECTRICITY",
  "WIFI",
  "KHALA",
]);

/**
 * OWNER can manage accounts; MANAGER can run the mess ledger. Both may write
 * money data, and every such write is attributed to the signed-in account.
 */
export const accountRoleEnum = pgEnum("account_role", ["OWNER", "MANAGER"]);

/**
 * Every calendar date in the system is stored as a `date` column in `string`
 * mode, so it round-trips as a plain "YYYY-MM-DD" value and never shifts a day
 * because of a timezone.
 */
const dateColumn = (name: string) => date(name, { mode: "string" });
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Single-row configuration table. */
export const messSettings = pgTable("mess_settings", {
  id: integer("id").primaryKey().default(1),
  hostelName: text("hostel_name").notNull(),
  address: text("address").notNull(),
  ramadanMode: boolean("ramadan_mode").notNull().default(false),
  /**
   * Multiples of the per-head utility share charged to a member who is alone in
   * a multi-bed room. The mess doubles electricity but not wifi for them, and
   * wants to be able to change either without a code change.
   */
  soloElectricityMultiplier: integer("solo_electricity_multiplier")
    .notNull()
    .default(2),
  soloWifiMultiplier: integer("solo_wifi_multiplier").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A person who can sign in and change the ledger. Replaces the single shared
 * PIN, so every write can be attributed to somebody.
 */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stored lower-cased; the login lookup lower-cases what the user typed. */
  username: varchar("username", { length: 60 }).notNull().unique(),
  displayName: text("display_name").notNull(),
  role: accountRoleEnum("role").notNull().default("MANAGER"),
  /** `scrypt:<salt>:<hash>`, see `src/lib/password.ts`. */
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Append-only record of who changed what money-related data and when.
 * `actorName` is denormalised so the trail survives an account being removed.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    actorName: text("actor_name").notNull(),
    action: varchar("action", { length: 60 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
  ],
);

/** Login history, used for throttling and for spotting attempted break-ins. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: varchar("username", { length: 60 }).notNull(),
    succeeded: boolean("succeeded").notNull(),
    reason: varchar("reason", { length: 40 }),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_username_idx").on(t.username, t.createdAt)],
);

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: varchar("number", { length: 32 }).notNull().unique(),
  capacity: integer("capacity").notNull(),
  /**
   * A "special" room: a multi-bed room that is let out to a single person, so
   * that one person carries the whole room. Recorded rather than guessed, so
   * the room keeps its identity in the roster, reports and exports instead of
   * looking like an ordinary double/triple.
   *
   * It only ever describes the arrangement, never overrides who is actually
   * living there: the solo Khala rate and solo utility share still apply while
   * the room holds at most one person, and it becomes an ordinary shared room
   * again as soon as a second person moves in. See `isSoloInSharedRoom`.
   */
  solo: boolean("solo").notNull().default(false),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "restrict" }),
    phone: varchar("phone", { length: 40 }),
    bloodGroup: varchar("blood_group", { length: 8 }),
    active: boolean("active").notNull().default(true),
    joinDate: dateColumn("join_date").notNull(),
    leaveDate: dateColumn("leave_date"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("members_room_idx").on(t.roomId)],
);

export const rateCards = pgTable(
  "rate_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label"),
    effectiveFrom: dateColumn("effective_from").notNull(),
    effectiveTo: dateColumn("effective_to"),
    fullMealRate: integer("full_meal_rate").notNull(),
    halfMealRate: integer("half_meal_rate").notNull(),
    guestFullRate: integer("guest_full_rate").notNull(),
    guestHalfRate: integer("guest_half_rate").notNull(),
    sehriRate: integer("sehri_rate").notNull().default(0),
    feastFlatCharge: integer("feast_flat_charge").notNull().default(0),
    khalaNormalRate: integer("khala_normal_rate").notNull(),
    khalaSoloRate: integer("khala_solo_rate").notNull(),
    managerDailyFee: integer("manager_daily_fee").notNull(),
    dailyExtraAmount: integer("daily_extra_amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("rate_cards_effective_from_idx").on(t.effectiveFrom)],
);

/**
 * A *change* of meal status, not a per-day row. The status in force on any
 * given day is the most recent change dated on or before that day, which is
 * what makes status sticky without losing history.
 */
export const mealStatusChanges = pgTable(
  "meal_status_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    date: dateColumn("date").notNull(),
    status: mealStatusEnum("status").notNull(),
    sehri: boolean("sehri").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("meal_status_changes_member_date_uq").on(t.memberId, t.date),
    index("meal_status_changes_date_idx").on(t.date),
  ],
);

export const guestMeals = pgTable(
  "guest_meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    date: dateColumn("date").notNull(),
    type: guestMealTypeEnum("type").notNull(),
    count: integer("count").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("guest_meals_member_date_type_uq").on(
      t.memberId,
      t.date,
      t.type,
    ),
    index("guest_meals_date_idx").on(t.date),
  ],
);

export const bazarDuties = pgTable("bazar_duties", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: dateColumn("date").notNull().unique(),
  khalaDidShopping: boolean("khala_did_shopping").notNull().default(false),
  note: text("note"),
  createdAt: createdAt(),
});

export const bazarDutyRooms = pgTable(
  "bazar_duty_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bazarDutyId: uuid("bazar_duty_id")
      .notNull()
      .references(() => bazarDuties.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("bazar_duty_rooms_uq").on(t.bazarDutyId, t.roomId),
    index("bazar_duty_rooms_room_idx").on(t.roomId),
  ],
);

/**
 * Operational petty-cash record for one day. The stored counts/amounts are a
 * snapshot of what the engine computed when the record was last saved; the UI
 * always displays freshly computed figures, and the PDF is generated from those.
 */
export const dailyBazarRecords = pgTable("daily_bazar_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: dateColumn("date").notNull().unique(),
  fullMealCount: integer("full_meal_count").notNull().default(0),
  fullMealAmount: integer("full_meal_amount").notNull().default(0),
  halfMealCount: integer("half_meal_count").notNull().default(0),
  halfMealAmount: integer("half_meal_amount").notNull().default(0),
  guestFullCount: integer("guest_full_count").notNull().default(0),
  guestFullAmount: integer("guest_full_amount").notNull().default(0),
  guestHalfCount: integer("guest_half_count").notNull().default(0),
  guestHalfAmount: integer("guest_half_amount").notNull().default(0),
  extraAmount: integer("extra_amount").notNull().default(0),
  totalBudget: integer("total_budget").notNull().default(0),
  deductionAmount: integer("deduction_amount").notNull().default(0),
  deductionReason: text("deduction_reason"),
  advanceGiven: integer("advance_given").notNull().default(0),
  actualExpense: integer("actual_expense").notNull().default(0),
  changeReturned: integer("change_returned").notNull().default(0),
  menuNight: text("menu_night"),
  menuMorning: text("menu_morning"),
  menuNoon: text("menu_noon"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One pool of shared costs. The recurring daily amount and the manager's fee
 * are materialised as rows here (identified by `sourceKey`) so that they
 * accumulate into the month-end pool, and can be voided for a single day.
 */
export const extraLineItems = pgTable(
  "extra_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: dateColumn("date").notNull(),
    label: text("label").notNull(),
    amount: integer("amount").notNull(),
    category: extraCategoryEnum("category").notNull().default("ONE_OFF"),
    showInDailyBudget: boolean("show_in_daily_budget")
      .notNull()
      .default(false),
    isAuto: boolean("is_auto").notNull().default(false),
    sourceKey: varchar("source_key", { length: 80 }).unique(),
    voided: boolean("voided").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("extra_line_items_date_idx").on(t.date)],
);

export const utilityBills = pgTable(
  "utility_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: dateColumn("month").notNull(),
    type: utilityTypeEnum("type").notNull(),
    amount: integer("amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("utility_bills_month_type_uq").on(t.month, t.type)],
);

export const deposits = pgTable(
  "deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    date: dateColumn("date").notNull(),
    amount: integer("amount").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("deposits_member_idx").on(t.memberId, t.date)],
);

/**
 * A manager-declared opening balance for a member for a specific month — the
 * position they started that month with ("balance as at the 1st").
 *
 * Normally a month's opening is not typed at all: it is the previous closed
 * month's closing balance, carried forward automatically. This table exists
 * only for the case where there is nothing to carry — the very first month the
 * mess tracks, or a month whose predecessor was never closed — so each
 * member's real starting position can be seeded once. Once a month is closed,
 * its opening is final and lives in `monthly_settlements`.
 *
 * `amount` is signed: positive means the member started in credit, negative
 * means they already owed the mess. This matches the ledger convention
 * `balance = opening + deposits − cost`, where a negative balance is a debt.
 */
export const openingBalances = pgTable(
  "opening_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: dateColumn("month").notNull(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull().default(0),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("opening_balances_month_member_uq").on(t.month, t.memberId),
    index("opening_balances_member_idx").on(t.memberId),
  ],
);

/** Immutable, materialised month-end result for one member. */
export const monthlySettlements = pgTable(
  "monthly_settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    month: dateColumn("month").notNull(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "restrict" }),
    roomNumber: varchar("room_number", { length: 32 }).notNull(),
    memberName: text("member_name").notNull(),
    fullMealCount: integer("full_meal_count").notNull().default(0),
    halfMealCount: integer("half_meal_count").notNull().default(0),
    sehriCount: integer("sehri_count").notNull().default(0),
    guestFullCount: integer("guest_full_count").notNull().default(0),
    guestHalfCount: integer("guest_half_count").notNull().default(0),
    mealAmount: integer("meal_amount").notNull().default(0),
    khalaAmount: integer("khala_amount").notNull().default(0),
    electricityAmount: integer("electricity_amount").notNull().default(0),
    wifiAmount: integer("wifi_amount").notNull().default(0),
    khalaElecWifiAmount: integer("khala_elec_wifi_amount")
      .notNull()
      .default(0),
    extraAmount: integer("extra_amount").notNull().default(0),
    totalCost: integer("total_cost").notNull().default(0),
    openingBalance: integer("opening_balance").notNull().default(0),
    newDeposits: integer("new_deposits").notNull().default(0),
    availableBalance: integer("available_balance").notNull().default(0),
    closingBalance: integer("closing_balance").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("monthly_settlements_month_member_uq").on(t.month, t.memberId),
    index("monthly_settlements_month_idx").on(t.month),
  ],
);

export const monthCloses = pgTable("month_closes", {
  id: uuid("id").primaryKey().defaultRandom(),
  month: dateColumn("month").notNull().unique(),
  notes: text("notes"),
  /** Which account closed the month, for the audit trail. */
  closedBy: uuid("closed_by").references(() => accounts.id, {
    onDelete: "set null",
  }),
  /**
   * The frozen meal register (one row per member, one cell per day) exactly as
   * it stood when the month was closed. The closed-month screen and both of its
   * PDFs read this instead of recomputing, so they can never drift apart.
   */
  registerSnapshot: jsonb("register_snapshot").$type<RegisterSnapshot | null>(),
  closedAt: timestamp("closed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messSettingsRelations = relations(messSettings, () => ({}));

export const accountsRelations = relations(accounts, ({ many }) => ({
  auditEntries: many(auditLog),
  closedMonths: many(monthCloses),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  account: one(accounts, {
    fields: [auditLog.accountId],
    references: [accounts.id],
  }),
}));

export const monthClosesRelations = relations(monthCloses, ({ one }) => ({
  closedByAccount: one(accounts, {
    fields: [monthCloses.closedBy],
    references: [accounts.id],
  }),
}));

export const roomsRelations = relations(rooms, ({ many }) => ({
  members: many(members),
  bazarDutyRooms: many(bazarDutyRooms),
}));

export const membersRelations = relations(members, ({ one, many }) => ({
  room: one(rooms, { fields: [members.roomId], references: [rooms.id] }),
  statusChanges: many(mealStatusChanges),
  guestMeals: many(guestMeals),
  deposits: many(deposits),
  openingBalances: many(openingBalances),
  settlements: many(monthlySettlements),
}));

export const mealStatusChangesRelations = relations(
  mealStatusChanges,
  ({ one }) => ({
    member: one(members, {
      fields: [mealStatusChanges.memberId],
      references: [members.id],
    }),
  }),
);

export const guestMealsRelations = relations(guestMeals, ({ one }) => ({
  member: one(members, {
    fields: [guestMeals.memberId],
    references: [members.id],
  }),
}));

export const bazarDutiesRelations = relations(bazarDuties, ({ many }) => ({
  rooms: many(bazarDutyRooms),
}));

export const bazarDutyRoomsRelations = relations(bazarDutyRooms, ({ one }) => ({
  duty: one(bazarDuties, {
    fields: [bazarDutyRooms.bazarDutyId],
    references: [bazarDuties.id],
  }),
  room: one(rooms, {
    fields: [bazarDutyRooms.roomId],
    references: [rooms.id],
  }),
}));

export const depositsRelations = relations(deposits, ({ one }) => ({
  member: one(members, {
    fields: [deposits.memberId],
    references: [members.id],
  }),
}));

export const openingBalancesRelations = relations(
  openingBalances,
  ({ one }) => ({
    member: one(members, {
      fields: [openingBalances.memberId],
      references: [members.id],
    }),
  }),
);

export const monthlySettlementsRelations = relations(
  monthlySettlements,
  ({ one }) => ({
    member: one(members, {
      fields: [monthlySettlements.memberId],
      references: [members.id],
    }),
  }),
);

export const schema = {
  messSettings,
  accounts,
  auditLog,
  loginAttempts,
  rooms,
  members,
  rateCards,
  mealStatusChanges,
  guestMeals,
  bazarDuties,
  bazarDutyRooms,
  dailyBazarRecords,
  extraLineItems,
  utilityBills,
  deposits,
  openingBalances,
  monthlySettlements,
  monthCloses,
  messSettingsRelations,
  accountsRelations,
  auditLogRelations,
  monthClosesRelations,
  roomsRelations,
  membersRelations,
  mealStatusChangesRelations,
  guestMealsRelations,
  bazarDutiesRelations,
  bazarDutyRoomsRelations,
  depositsRelations,
  openingBalancesRelations,
  monthlySettlementsRelations,
};
