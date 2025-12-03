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

const connectionString = process.env.DATABASE_URL as string;

function getPrismaClient() {
  if (globalThis.prisma) return globalThis.prisma;

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

const prisma = getPrismaClient();

export default prisma;
