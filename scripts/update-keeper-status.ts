import prisma from "../lib/prisma";
import { KEEPERS_2024, KEEPERS_2025 } from "../lib/keeper/keeperData2025";
import { calculateYearsRemaining, calculateKeeperRound } from "../lib/keeper/types";

async function main() {
  console.log("Updating keeper status for 2025 season...\n");
  
  const league = await prisma.league.findFirst({
    where: { leagueKey: "465.l.9080" },
    orderBy: { createdAt: 'asc' }
  });
  
  if (!league) {
    console.error("League not found!");
    return;
  }
  
  // Find which players were kept in both years (2nd year of keeping)
  const keptInBothYears = new Set<string>();
  for (const keeper2024 of KEEPERS_2024) {
    const alsoIn2025 = KEEPERS_2025.find(k => k.player === keeper2024.player);
    if (alsoIn2025) {
      keptInBothYears.add(keeper2024.player);
    }
  }
  
  console.log(`Players kept in BOTH 2024 and 2025: ${keptInBothYears.size}`);
  console.log(`Players kept ONLY in 2025: ${KEEPERS_2025.length - keptInBothYears.size}\n`);
  
  let updated = 0;
  
  for (const keeper of KEEPERS_2025) {
    // Determine keeper year (0 = first time, 1 = second time, 2 = third time)
    const isSecondYear = keptInBothYears.has(keeper.player);
    const keeperYearIndex = isSecondYear ? 1 : 0; // 0 or 1 (could be higher if we had 2023 data)
    const yearsRemaining = calculateYearsRemaining(keeperYearIndex);
    
    // For now, assume teams own all their picks (we'll update this when we have actual pick ownership data)
    const allPicks = Array.from({ length: 16 }, (_, i) => i + 1);
    const keeperRoundCost = calculateKeeperRound(keeper.round, allPicks) ?? keeper.round;
    
    // Find the player
    const player = await prisma.player.findFirst({
      where: { 
        name: { contains: keeper.player.split(" ").slice(-1)[0] } // Match by last name
      }
    });
    
    if (!player) {
      console.warn(`⚠️  Player not found: ${keeper.player}`);
      continue;
    }
    
    // Find their roster entry
    const rosterEntry = await prisma.rosterEntry.findFirst({
      where: {
        playerId: player.id,
        leagueId: league.id,
      },
      include: {
        team: true
      }
    });
    
    if (!rosterEntry) {
      console.warn(`⚠️  Roster entry not found for: ${keeper.player}`);
      continue;
    }
    
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
    console.log(`✅ ${keeper.player} (${rosterEntry.team.name})`);
    console.log(`   Original: R${keeper.round}, Year ${keeperYearIndex + 1} of keeping, Cost: R${keeperRoundCost}, ${yearsRemaining} years left\n`);
  }
  
  console.log(`\n✅ Updated ${updated} keeper records`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
