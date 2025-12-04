import "dotenv/config";
import { toFixedSafe } from "../lib/utils/numberFormat";
import prisma from "../lib/prisma";

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

