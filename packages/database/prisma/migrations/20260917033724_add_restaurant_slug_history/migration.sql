-- CreateTable
CREATE TABLE "restaurant_slugs" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_slugs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_slugs_slug_key" ON "restaurant_slugs"("slug");

-- CreateIndex
CREATE INDEX "restaurant_slugs_restaurant_id_idx" ON "restaurant_slugs"("restaurant_id");

-- AddForeignKey
ALTER TABLE "restaurant_slugs" ADD CONSTRAINT "restaurant_slugs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: every restaurant that already exists must have its current slug
-- registered here.
--
-- This is not cosmetic. The whole point of this table is that its UNIQUE index
-- makes "a slug belongs to one restaurant forever" a database guarantee. An
-- unregistered current slug is a hole in that guarantee: another restaurant
-- could claim it, because nothing in this table would object.
--
-- Ids are 32 hex characters rather than a cuid because SQL cannot generate a
-- cuid. It matches the shape already used for server-generated media ids, and
-- nothing parses an id.
-- ---------------------------------------------------------------------------
INSERT INTO "restaurant_slugs" ("id", "restaurant_id", "slug", "created_at")
SELECT replace(gen_random_uuid()::text, '-', ''), "id", "slug", "created_at"
  FROM "restaurants";

-- ---------------------------------------------------------------------------
-- The slug alphabet, enforced by PostgreSQL.
--
-- `@repo/validation`'s `slugSchema` already rejects anything else, and every
-- slug is written through it. This is the second barrier: a slug becomes a URL
-- path segment, so a value containing a slash, a dot-dot or a percent escape
-- is the input that turns into path traversal or an open redirect. Refusing the
-- shape outright is stronger than trusting every future write path to validate.
--
-- Prisma cannot express CHECK constraints in schema.prisma, so these are added
-- by hand; `migrate diff` is run afterwards to confirm no drift is introduced.
-- ---------------------------------------------------------------------------
ALTER TABLE "restaurant_slugs"
  ADD CONSTRAINT "restaurant_slugs_slug_alphabet_check"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "restaurants"
  ADD CONSTRAINT "restaurants_slug_alphabet_check"
  CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
