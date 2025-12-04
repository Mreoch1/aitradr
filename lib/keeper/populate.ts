/**
 * Keeper data population from hardcoded 2024-2025 draft history
 * Automatically populates keeper flags, years remaining, etc.
 */

import prisma from "@/lib/prisma";
import { KEEPERS_2024, KEEPERS_2025 } from "./keeperData2025";
import { calculateYearsRemaining, calculateKeeperRound } from "./types";

/**
 * Populate keeper data for a league from hardcoded keeper list
 * Can be called from API endpoints or during sync
 */
export async function populateKeeperData(leagueId: string): Promise<number> {
  console.log("[Populate Keepers] Starting for league:", leagueId);
  
  // Clear all existing keeper flags
  await prisma.rosterEntry.updateMany({
    where: { leagueId },
    data: {
      isKeeper: false,
      originalDraftRound: null,
      keeperYearIndex: null,
      yearsRemaining: null,
      keeperRoundCost: null,
    }
  });
  
  console.log("[Populate Keepers] Cleared all keeper flags");
  
  // Find which players were kept in both years
  const keptInBothYears = new Set<string>();
  for (const keeper2024 of KEEPERS_2024) {
    const alsoIn2025 = KEEPERS_2025.find(k => k.player === keeper2024.player);
    if (alsoIn2025) {
      keptInBothYears.add(keeper2024.player);
    }
  }
  
  console.log(`[Populate Keepers] Players kept in both years: ${keptInBothYears.size}`);
  
  let updated = 0;
  
  for (const keeper of KEEPERS_2025) {
    // Determine keeper year
    const isSecondYear = keptInBothYears.has(keeper.player);
    const keeperYearIndex = isSecondYear ? 1 : 0;
    const yearsRemaining = calculateYearsRemaining(keeperYearIndex);
    
    // Find the player by FULL name
    const player = await prisma.player.findFirst({
      where: { 
        name: { contains: keeper.player, mode: 'insensitive' }
      },
      include: {
        rosterEntries: {
          where: { leagueId },
          include: { team: true }
        }
      }
    });
    
    if (!player) {
      console.warn(`[Populate Keepers] Player not found: ${keeper.player}`);
      continue;
    }
    
    if (player.rosterEntries.length === 0) {
      console.warn(`[Populate Keepers] ${keeper.player} not on any roster`);
      continue;
    }
    
    // Use CURRENT team (not draft team, since players get traded)
    const rosterEntry = player.rosterEntries[0];
    
    const allPicks = Array.from({ length: 16 }, (_, i) => i + 1);
    const keeperRoundCost = calculateKeeperRound(keeper.round, allPicks) ?? keeper.round;
    
    // Update keeper status
    await prisma.rosterEntry.update({
      where: { id: rosterEntry.id },
      data: {
        isKeeper: true,
        originalDraftRound: keeper.round,
        keeperYearIndex: keeperYearIndex,
        yearsRemaining: yearsRemaining,
        keeperRoundCost: keeperRoundCost,
      }
    });
    
    updated++;
    console.log(`[Populate Keepers] ✅ ${keeper.player} (R${keeper.round}, Year ${keeperYearIndex + 1}, ${yearsRemaining} yrs)`);
  }
  
  console.log(`[Populate Keepers] Successfully updated ${updated} keeper records`);
  return updated;
}

