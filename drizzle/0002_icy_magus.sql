CREATE TYPE "public"."account_role" AS ENUM('OWNER', 'MANAGER');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(60) NOT NULL,
	"display_name" text NOT NULL,
	"role" "account_role" DEFAULT 'MANAGER' NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"actor_name" text NOT NULL,
	"action" varchar(60) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" text,
	"summary" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(60) NOT NULL,
	"succeeded" boolean NOT NULL,
	"reason" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "month_closes" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "month_closes" ADD COLUMN "register_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "login_attempts_username_idx" ON "login_attempts" USING btree ("username","created_at");--> statement-breakpoint
ALTER TABLE "month_closes" ADD CONSTRAINT "month_closes_closed_by_accounts_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;