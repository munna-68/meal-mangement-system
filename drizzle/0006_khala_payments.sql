-- Khala is collected in instalments over the month, not billed in one go on a
-- date, so each payment is stored as its own dated row. A member only carries
-- what has actually been handed over.
CREATE TABLE "khala_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"notes" text,
	"idempotency_key" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "khala_payments_date_idx" ON "khala_payments" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "khala_payments_idempotency_key_uq" ON "khala_payments" USING btree ("idempotency_key");