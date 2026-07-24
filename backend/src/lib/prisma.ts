import { PrismaClient } from "@prisma/client";

// Singleton pattern: in dev, a file can get re-imported/re-evaluated on
// every hot-reload, which would otherwise open a fresh Prisma connection
// pool each time. Stashing the instance on `globalThis` means we always
// reuse the same client instead of leaking connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
