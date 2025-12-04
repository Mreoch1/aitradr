import prisma from "../lib/prisma";
import { toFixedSafe } from "../lib/utils/numberFormat";
import { KEEPERS_2024, KEEPERS_2025 } from "../lib/keeper/keeperData2025";
import { calculateYearsRemaining, calculateKeeperRound } from "../lib/keeper/types";

async function main() {
  console.log("Clearing all keeper flags and repopulating...\n");
  
  const league = await prisma.league.findFirst({
    where: { leagueKey: "465.l.9080" },
    orderBy: { createdAt: 'asc' }
  });
  
  if (!league) {
    console.error("League not found!");
    return;
  }
  
  // Step 1: Clear ALL keeper flags
  const cleared = await prisma.rosterEntry.updateMany({
    where: { leagueId: league.id },
    data: {
      isKeeper: false,
      originalDraftRound: null,
      keeperYearIndex: null,
      yearsRemaining: null,
      keeperRoundCost: null,
    }
  });
  console.log(`Cleared ${cleared.count} roster entries\n`);
  
  // Step 2: Find which players were kept in both years
  const keptInBothYears = new Set<string>();
  for (const keeper2024 of KEEPERS_2024) {
    const alsoIn2025 = KEEPERS_2025.find(k => k.player === keeper2024.player && k.team === keeper2024.team);
    if (alsoIn2025) {
      keptInBothYears.add(`${keeper2024.player}|${keeper2024.team}`);
    }
  }
  
  console.log(`Players kept in BOTH years: ${keptInBothYears.size}\n`);
  
  // Step 3: Populate ONLY 2025 keepers
  let updated = 0;
  
  for (const keeper of KEEPERS_2025) {
    // Determine keeper year
    const keeperKey = `${keeper.player}|${keeper.team}`;
    const isSecondYear = keptInBothYears.has(keeperKey);
    const keeperYearIndex = isSecondYear ? 1 : 0;
    const yearsRemaining = calculateYearsRemaining(keeperYearIndex);
    
    // Find the player by FULL name (not just last name to avoid Logan vs Tage Thompson confusion)
    const player = await prisma.player.findFirst({
      where: { 
        name: { contains: keeper.player, mode: 'insensitive' }
      }
    });
    
    if (!player) {
      console.warn(`⚠️  Player not found: ${keeper.player}`);
      continue;
    }
    
    // Find their roster entry on the CORRECT team
    const teams = await prisma.team.findMany({
      where: { leagueId: league.id },
      include: { rosterEntries: { where: { playerId: player.id } } }
    });
    
    let foundTeam = null;
    for (const team of teams) {
      if (team.rosterEntries.length > 0 && 
          (team.name.includes(keeper.team) || keeper.team.includes(team.name.substring(0, 5)))) {
        foundTeam = team;
        break;
      }
    }
    
    if (!foundTeam || foundTeam.rosterEntries.length === 0) {
      console.warn(`⚠️  Could not find ${keeper.player} on team ${keeper.team}`);
      continue;
    }
    
    const rosterEntry = foundTeam.rosterEntries[0];
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
    console.log(`✅ ${keeper.player} → ${foundTeam.name}`);
    console.log(`   R${keeper.round}, Year ${keeperYearIndex + 1}, ${yearsRemaining} yrs left, Cost R${keeperRoundCost}\n`);
  }
  
  console.log(`✅ Updated ${updated} keeper records (should be 29)`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
