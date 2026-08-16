import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Next.js (apps/web, apps/admin) hot-reloads modules in dev, which would
 * otherwise create a new PrismaClient — and a new connection pool — on
 * every edit. Stashing the instance on `globalThis` survives the reload.
 */
const globalForPrisma = globalThis as unknown as {
  db?: PrismaClient;
};

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.db ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.db = db;
}

export * from "../generated/prisma/client.ts";
