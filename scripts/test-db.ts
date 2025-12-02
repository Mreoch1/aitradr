import "dotenv/config";
import { PrismaClient } from "../lib/prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    const count = await prisma.user.count();
    console.log("User count:", count);
  } catch (err) {
    console.error("Prisma test error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

