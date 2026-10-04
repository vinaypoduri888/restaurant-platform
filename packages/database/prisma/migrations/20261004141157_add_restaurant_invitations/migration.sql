-- CreateTable
CREATE TABLE "restaurant_invitations" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "restaurant_role" NOT NULL DEFAULT 'STAFF',
    "token_hash" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_invitations_token_hash_key" ON "restaurant_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "restaurant_invitations_restaurant_id_idx" ON "restaurant_invitations"("restaurant_id");

-- CreateIndex
CREATE INDEX "restaurant_invitations_expires_at_idx" ON "restaurant_invitations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_invitations_restaurant_id_email_key" ON "restaurant_invitations"("restaurant_id", "email");

-- AddForeignKey
ALTER TABLE "restaurant_invitations" ADD CONSTRAINT "restaurant_invitations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Domain invariants PostgreSQL enforces itself, not only the service that writes.
-- Prisma cannot express CHECK constraints in schema.prisma, so these are added by
-- hand; `migrate diff` still reports no drift, which is verified after applying.

-- The address is the subject of an invitation and the thing acceptance is
-- matched against. If case could vary, `Owner@x.com` and `owner@x.com` would be
-- two rows past the unique index, and an acceptance could match the wrong one.
ALTER TABLE "restaurant_invitations"
  ADD CONSTRAINT "restaurant_invitations_email_lowercase_check"
  CHECK ("email" = lower("email"));

-- An address with no @ is not an address. Deliberately a shape check and not an
-- RFC 5322 implementation: the real test of deliverability is that the
-- invitation arrives, and an over-strict pattern rejects valid addresses.
ALTER TABLE "restaurant_invitations"
  ADD CONSTRAINT "restaurant_invitations_email_shape_check"
  CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- An invitation that expires before it was created can never be accepted, so a
-- row like that is a clock or arithmetic bug rather than data.
ALTER TABLE "restaurant_invitations"
  ADD CONSTRAINT "restaurant_invitations_expiry_after_creation_check"
  CHECK ("expires_at" > "created_at");

-- 64 lowercase hex characters: exactly what SHA-256 produces. This is what
-- stops a raw token ever being written to this column by mistake — the failure
-- that would quietly turn the table into a store of working credentials.
ALTER TABLE "restaurant_invitations"
  ADD CONSTRAINT "restaurant_invitations_token_hash_shape_check"
  CHECK ("token_hash" ~ '^[0-9a-f]{64}$');
