import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

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
]);

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
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const rooms = pgTable("rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  number: varchar("number", { length: 32 }).notNull().unique(),
  capacity: integer("capacity").notNull(),
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
  closedAt: timestamp("closed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const messSettingsRelations = relations(messSettings, () => ({}));

export const roomsRelations = relations(rooms, ({ many }) => ({
  members: many(members),
  bazarDutyRooms: many(bazarDutyRooms),
}));

export const membersRelations = relations(members, ({ one, many }) => ({
  room: one(rooms, { fields: [members.roomId], references: [rooms.id] }),
  statusChanges: many(mealStatusChanges),
  guestMeals: many(guestMeals),
  deposits: many(deposits),
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
  monthlySettlements,
  monthCloses,
  messSettingsRelations,
  roomsRelations,
  membersRelations,
  mealStatusChangesRelations,
  guestMealsRelations,
  bazarDutiesRelations,
  bazarDutyRoomsRelations,
  depositsRelations,
  monthlySettlementsRelations,
};
