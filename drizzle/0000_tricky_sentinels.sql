CREATE TYPE "public"."extra_category" AS ENUM('RECURRING_DAILY', 'ONE_OFF', 'MANAGER_FEE', 'FEAST', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."guest_meal_type" AS ENUM('GUEST_FULL', 'GUEST_HALF');--> statement-breakpoint
CREATE TYPE "public"."meal_status" AS ENUM('FULL', 'HALF_DAY', 'HALF_NIGHT', 'OFF');--> statement-breakpoint
CREATE TYPE "public"."utility_type" AS ENUM('ELECTRICITY', 'WIFI');--> statement-breakpoint
CREATE TABLE "bazar_duties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"khala_did_shopping" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bazar_duties_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "bazar_duty_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bazar_duty_id" uuid NOT NULL,
	"room_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_bazar_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"full_meal_count" integer DEFAULT 0 NOT NULL,
	"full_meal_amount" integer DEFAULT 0 NOT NULL,
	"half_meal_count" integer DEFAULT 0 NOT NULL,
	"half_meal_amount" integer DEFAULT 0 NOT NULL,
	"guest_full_count" integer DEFAULT 0 NOT NULL,
	"guest_full_amount" integer DEFAULT 0 NOT NULL,
	"guest_half_count" integer DEFAULT 0 NOT NULL,
	"guest_half_amount" integer DEFAULT 0 NOT NULL,
	"extra_amount" integer DEFAULT 0 NOT NULL,
	"total_budget" integer DEFAULT 0 NOT NULL,
	"deduction_amount" integer DEFAULT 0 NOT NULL,
	"deduction_reason" text,
	"advance_given" integer DEFAULT 0 NOT NULL,
	"actual_expense" integer DEFAULT 0 NOT NULL,
	"change_returned" integer DEFAULT 0 NOT NULL,
	"menu_night" text,
	"menu_morning" text,
	"menu_noon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_bazar_records_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extra_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL,
	"amount" integer NOT NULL,
	"category" "extra_category" DEFAULT 'ONE_OFF' NOT NULL,
	"show_in_daily_budget" boolean DEFAULT false NOT NULL,
	"is_auto" boolean DEFAULT false NOT NULL,
	"source_key" varchar(80),
	"voided" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extra_line_items_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE "guest_meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" "guest_meal_type" NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "meal_status" NOT NULL,
	"sehri" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"room_id" uuid NOT NULL,
	"phone" varchar(40),
	"blood_group" varchar(8),
	"active" boolean DEFAULT true NOT NULL,
	"join_date" date NOT NULL,
	"leave_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mess_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"hostel_name" text NOT NULL,
	"address" text NOT NULL,
	"ramadan_mode" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "month_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"notes" text,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "month_closes_month_unique" UNIQUE("month")
);
--> statement-breakpoint
CREATE TABLE "monthly_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"member_id" uuid NOT NULL,
	"room_number" varchar(32) NOT NULL,
	"member_name" text NOT NULL,
	"full_meal_count" integer DEFAULT 0 NOT NULL,
	"half_meal_count" integer DEFAULT 0 NOT NULL,
	"sehri_count" integer DEFAULT 0 NOT NULL,
	"guest_full_count" integer DEFAULT 0 NOT NULL,
	"guest_half_count" integer DEFAULT 0 NOT NULL,
	"meal_amount" integer DEFAULT 0 NOT NULL,
	"khala_amount" integer DEFAULT 0 NOT NULL,
	"electricity_amount" integer DEFAULT 0 NOT NULL,
	"wifi_amount" integer DEFAULT 0 NOT NULL,
	"khala_elec_wifi_amount" integer DEFAULT 0 NOT NULL,
	"extra_amount" integer DEFAULT 0 NOT NULL,
	"total_cost" integer DEFAULT 0 NOT NULL,
	"opening_balance" integer DEFAULT 0 NOT NULL,
	"new_deposits" integer DEFAULT 0 NOT NULL,
	"available_balance" integer DEFAULT 0 NOT NULL,
	"closing_balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"full_meal_rate" integer NOT NULL,
	"half_meal_rate" integer NOT NULL,
	"guest_full_rate" integer NOT NULL,
	"guest_half_rate" integer NOT NULL,
	"sehri_rate" integer DEFAULT 0 NOT NULL,
	"feast_flat_charge" integer DEFAULT 0 NOT NULL,
	"khala_normal_rate" integer NOT NULL,
	"khala_solo_rate" integer NOT NULL,
	"manager_daily_fee" integer NOT NULL,
	"daily_extra_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(32) NOT NULL,
	"capacity" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "utility_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"type" "utility_type" NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bazar_duty_rooms" ADD CONSTRAINT "bazar_duty_rooms_bazar_duty_id_bazar_duties_id_fk" FOREIGN KEY ("bazar_duty_id") REFERENCES "public"."bazar_duties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bazar_duty_rooms" ADD CONSTRAINT "bazar_duty_rooms_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_meals" ADD CONSTRAINT "guest_meals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_status_changes" ADD CONSTRAINT "meal_status_changes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_settlements" ADD CONSTRAINT "monthly_settlements_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bazar_duty_rooms_uq" ON "bazar_duty_rooms" USING btree ("bazar_duty_id","room_id");--> statement-breakpoint
CREATE INDEX "bazar_duty_rooms_room_idx" ON "bazar_duty_rooms" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "deposits_member_idx" ON "deposits" USING btree ("member_id","date");--> statement-breakpoint
CREATE INDEX "extra_line_items_date_idx" ON "extra_line_items" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_meals_member_date_type_uq" ON "guest_meals" USING btree ("member_id","date","type");--> statement-breakpoint
CREATE INDEX "guest_meals_date_idx" ON "guest_meals" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "meal_status_changes_member_date_uq" ON "meal_status_changes" USING btree ("member_id","date");--> statement-breakpoint
CREATE INDEX "meal_status_changes_date_idx" ON "meal_status_changes" USING btree ("date");--> statement-breakpoint
CREATE INDEX "members_room_idx" ON "members" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_settlements_month_member_uq" ON "monthly_settlements" USING btree ("month","member_id");--> statement-breakpoint
CREATE INDEX "monthly_settlements_month_idx" ON "monthly_settlements" USING btree ("month");--> statement-breakpoint
CREATE INDEX "rate_cards_effective_from_idx" ON "rate_cards" USING btree ("effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "utility_bills_month_type_uq" ON "utility_bills" USING btree ("month","type");