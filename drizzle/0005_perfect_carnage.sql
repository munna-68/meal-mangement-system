-- The KHALA value was added to the enum by hand on databases that already
-- existed, so this has to be safe to run against a database that already has
-- it as well as a fresh one.
DO $$ BEGIN
  ALTER TYPE "public"."utility_type" ADD VALUE 'KHALA';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "idempotency_key" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_idempotency_key_uq" ON "deposits" USING btree ("idempotency_key");