/**
 * Test script to verify historical stats JSON loading works correctly
 */

import { ensureLeaguePlayerValues } from "../lib/yahoo/playerValues";
import prisma from "../lib/prisma";

async function testHistoricalStatsLoad() {
  console.log("[Test] Testing historical stats loading...");
  
  // Get the first league
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!league) {
    console.error("[Test] No league found in database");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[Test] Found league: ${league.name} (${league.id})`);
  console.log(`[Test] Recalculating player values with historical stats...`);

  try {
    await ensureLeaguePlayerValues(league.id);
    console.log("[Test] ✅ Value calculation completed successfully!");
    
    // Check a few specific players
    const mcdavid = await prisma.player.findFirst({
      where: { name: "Connor McDavid" },
      include: { playerValues: { where: { leagueId: league.id } } }
    });
    
    const mackinnon = await prisma.player.findFirst({
      where: { name: "Nathan MacKinnon" },
      include: { playerValues: { where: { leagueId: league.id } } }
    });

    if (mcdavid) {
      const value = mcdavid.playerValues[0]?.score || 0;
      console.log(`[Test] McDavid value: ${value.toFixed(1)}`);
    }

    if (mackinnon) {
      const value = mackinnon.playerValues[0]?.score || 0;
      console.log(`[Test] MacKinnon value: ${value.toFixed(1)}`);
    }

  } catch (error) {
    console.error("[Test] ❌ Error:", error);
    process.exit(1);
  }

  await prisma.$disconnect();
}

testHistoricalStatsLoad();

