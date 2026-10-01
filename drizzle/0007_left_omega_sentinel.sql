CREATE TABLE "deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"notes" text,
	"idempotency_key" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deductions" ADD CONSTRAINT "deductions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deductions_member_idx" ON "deductions" USING btree ("member_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "deductions_idempotency_key_uq" ON "deductions" USING btree ("idempotency_key");