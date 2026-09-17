-- CreateEnum
CREATE TYPE "media_purpose" AS ENUM ('LOGO', 'BANNER');

-- CreateTable
CREATE TABLE "restaurant_media" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "purpose" "media_purpose" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_media_restaurant_id_idx" ON "restaurant_media"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_media_restaurant_id_purpose_key" ON "restaurant_media"("restaurant_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_media_storage_key_key" ON "restaurant_media"("storage_key");

-- AddForeignKey
ALTER TABLE "restaurant_media" ADD CONSTRAINT "restaurant_media_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain invariants PostgreSQL enforces itself, not only the service that writes.
-- Prisma cannot express CHECK constraints in schema.prisma, so these are added by
-- hand; `migrate diff` still reports no drift, which is verified after applying.

-- A zero-byte or negative-size "image" is not an image.
ALTER TABLE "restaurant_media"
  ADD CONSTRAINT "restaurant_media_size_positive_check"
  CHECK ("size_bytes" > 0);

-- Dimensions are read from the file header, so a non-positive value means the
-- header was misparsed rather than that the image is tiny. Refusing it here
-- stops a bad decode reaching the frontend, which uses these to reserve layout.
ALTER TABLE "restaurant_media"
  ADD CONSTRAINT "restaurant_media_dimensions_positive_check"
  CHECK ("width" > 0 AND "height" > 0);

-- Keys are server-generated under a per-restaurant, per-media prefix. Requiring
-- that prefix at the database level means a row can never point at an object
-- outside its own tenant's namespace, whatever wrote it.
--
-- Expressed with LIKE rather than by reassembling the key from split_part():
-- the segment index is easy to get off by one, and getting it wrong rejects
-- every valid row. Restaurant and media ids are cuids, so they contain no LIKE
-- wildcards to escape.
ALTER TABLE "restaurant_media"
  ADD CONSTRAINT "restaurant_media_key_prefix_check"
  CHECK ("storage_key" LIKE 'restaurants/' || "restaurant_id" || '/media/' || "id" || '/%');
