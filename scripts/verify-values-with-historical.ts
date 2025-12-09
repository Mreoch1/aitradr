/**
 * Verify player values are using historical stats correctly
 */

import prisma from "../lib/prisma";
import { ensureLeaguePlayerValues } from "../lib/yahoo/playerValues";

async function verifyValues() {
  console.log("[Verify] Finding league...");
  
  // Get the first league
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!league) {
    console.error("[Verify] No league found");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[Verify] League: ${league.name} (${league.id})`);
  console.log(`[Verify] Recalculating player values with historical stats...\n`);

  try {
    // This will trigger debug logging for McDavid and MacKinnon
    await ensureLeaguePlayerValues(league.id);
    
    console.log("\n[Verify] ✅ Values recalculated!");
    console.log("[Verify] Check the logs above for detailed breakdowns of McDavid and MacKinnon.");
    console.log("[Verify] You should see historical stats being blended with current season stats.");

  } catch (error) {
    console.error("[Verify] ❌ Error:", error);
    process.exit(1);
  }

  await prisma.$disconnect();
}

verifyValues();

