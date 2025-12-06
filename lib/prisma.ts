import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Configure WebSocket for Neon
neonConfig.webSocketConstructor = ws;

function getPrismaClient() {
  if (globalThis.prisma) return globalThis.prisma;

  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set. Please configure it in Vercel environment variables.");
  }

  // Use PrismaNeon with a config object, not a Pool instance
  const adapter = new PrismaNeon({ connectionString });

  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

  if (process.env.NODE_ENV === "development") {
    globalThis.prisma = client;
  }

  return client;
}

// Standard Next.js + Prisma singleton pattern
// In development: reuse global client to avoid connection exhaustion
// In production (serverless): new client per request (no global reuse needed)
const prisma = globalThis.prisma ?? getPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

export { prisma };
export default prisma;
