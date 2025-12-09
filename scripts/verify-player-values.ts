/**
 * Script to verify player values are calculated correctly with historical stats
 */

import prisma from "../lib/prisma";
import { calculateSkaterValue } from "../lib/yahoo/playerValues";

async function verifyPlayerValues() {
  console.log("[Verify] Finding league and players...");
  
  // Get the first league
  const league = await prisma.league.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  if (!league) {
    console.error("[Verify] No league found");
    await prisma.$disconnect();
    process.exit(1);
  }

  // Find McDavid and MacKinnon
  const mcdavid = await prisma.player.findFirst({
    where: { name: "Connor McDavid" },
  });

  const mackinnon = await prisma.player.findFirst({
    where: { name: "Nathan MacKinnon" },
  });

  if (!mcdavid || !mackinnon) {
    console.error("[Verify] Could not find McDavid or MacKinnon in database");
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`[Verify] League: ${league.name} (${league.id})`);
  console.log(`[Verify] McDavid ID: ${mcdavid.id}`);
  console.log(`[Verify] MacKinnon ID: ${mackinnon.id}`);
  console.log("\n[Verify] Calculating values (check logs above for detailed breakdown)...\n");

  try {
    // Calculate values - this will trigger debug logging
    const mcdavidValue = await calculateSkaterValue(mcdavid.id, league.id);
    const mackinnonValue = await calculateSkaterValue(mackinnon.id, league.id);

    console.log("\n[Verify] ===== RESULTS =====");
    console.log(`[Verify] McDavid calculated value: ${mcdavidValue.toFixed(1)}`);
    console.log(`[Verify] MacKinnon calculated value: ${mackinnonValue.toFixed(1)}`);
    console.log(`[Verify] Difference: ${Math.abs(mcdavidValue - mackinnonValue).toFixed(1)}`);

    // Check stored values
    const mcdavidStored = await prisma.playerValue.findFirst({
      where: { playerId: mcdavid.id, leagueId: league.id },
    });

    const mackinnonStored = await prisma.playerValue.findFirst({
      where: { playerId: mackinnon.id, leagueId: league.id },
    });

    if (mcdavidStored) {
      console.log(`[Verify] McDavid stored value: ${mcdavidStored.score.toFixed(1)}`);
    }

    if (mackinnonStored) {
      console.log(`[Verify] MacKinnon stored value: ${mackinnonStored.score.toFixed(1)}`);
    }

  } catch (error) {
    console.error("[Verify] Error calculating values:", error);
    process.exit(1);
  }

  await prisma.$disconnect();
}

verifyPlayerValues();

