-- CreateEnum
CREATE TYPE "day_of_week" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "time_zone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "operating_hours" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "day_of_week" "day_of_week" NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "opens_at" INTEGER,
    "closes_at" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operating_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operating_hours_restaurant_id_idx" ON "operating_hours"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "operating_hours_restaurant_id_day_of_week_key" ON "operating_hours"("restaurant_id", "day_of_week");

-- AddForeignKey
ALTER TABLE "operating_hours" ADD CONSTRAINT "operating_hours_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain invariants enforced by PostgreSQL, not only by the service that writes.
--
-- Prisma cannot express CHECK constraints in schema.prisma, so these are added
-- by hand. Verified with `migrate diff` afterwards: Prisma ignores them and
-- still reports no drift between the schema and the database.
ALTER TABLE "operating_hours"
  ADD CONSTRAINT "operating_hours_minute_range_check"
  CHECK (
    ("opens_at" IS NULL OR ("opens_at" >= 0 AND "opens_at" <= 1439)) AND
    ("closes_at" IS NULL OR ("closes_at" >= 0 AND "closes_at" <= 1439))
  );

-- Exactly one representation of each state: closed has no times, open has both.
-- A day can never be half-configured.
ALTER TABLE "operating_hours"
  ADD CONSTRAINT "operating_hours_closed_state_check"
  CHECK (
    ("is_closed" = true  AND "opens_at" IS NULL     AND "closes_at" IS NULL) OR
    ("is_closed" = false AND "opens_at" IS NOT NULL AND "closes_at" IS NOT NULL)
  );

-- Equal open and close times are ambiguous: a zero-length period or a full 24
-- hours? "Open 24 hours" is not a product requirement, so the ambiguity is
-- rejected rather than silently resolved.
ALTER TABLE "operating_hours"
  ADD CONSTRAINT "operating_hours_distinct_times_check"
  CHECK ("opens_at" IS NULL OR "closes_at" IS NULL OR "opens_at" <> "closes_at");
