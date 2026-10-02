ALTER TABLE "mess_settings" ADD COLUMN "meal_charge_gate_starts" date;
--> statement-breakpoint
-- Start the gate on the mess's own today, never earlier. CURRENT_DATE would be
-- the *database*'s today, which on Neon is UTC and therefore still yesterday
-- between 18:00 and midnight in Dhaka -- quietly gating a day the members have
-- already been billed for. Every day before this one must stay charged, or a
-- month of already-billed meals would silently become a refund.
UPDATE "mess_settings"
   SET "meal_charge_gate_starts" = (now() AT TIME ZONE 'Asia/Dhaka')::date
 WHERE "meal_charge_gate_starts" IS NULL;