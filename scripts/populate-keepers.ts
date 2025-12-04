import prisma from "../lib/prisma";
import { toFixedSafe } from "../lib/utils/numberFormat";
import { KEEPERS_2024, KEEPERS_2025 } from "../lib/keeper/keeperData2025";
import { calculateYearsRemaining, calculateKeeperRound } from "../lib/keeper/types";

async function main() {
  console.log("Populating keepers (ignoring team changes from trades)...\n");
  
  const league = await prisma.league.findFirst({
    where: { leagueKey: "465.l.9080" },
    orderBy: { createdAt: 'asc' }
  });
  
  if (!league) {
    console.error("League not found!");
    return;
  }
  
  // Clear all keeper flags first
  await prisma.rosterEntry.updateMany({
    where: { leagueId: league.id },
    data: {
      isKeeper: false,
      originalDraftRound: null,
      keeperYearIndex: null,
      yearsRemaining: null,
      keeperRoundCost: null,
    }
  });
  console.log("Cleared all keeper flags\n");
  
  // Find which players were kept in both years (by name only)
  const keptInBothYears = new Set<string>();
  for (const keeper2024 of KEEPERS_2024) {
    const alsoIn2025 = KEEPERS_2025.find(k => k.player === keeper2024.player);
    if (alsoIn2025) {
      keptInBothYears.add(keeper2024.player);
    }
  }
  
  console.log(`Players kept in BOTH years: ${keptInBothYears.size}\n`);
  
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
          where: { leagueId: league.id },
          include: { team: true }
        }
      }
    });
    
    if (!player) {
      console.warn(`❌ Player not found: ${keeper.player}`);
      continue;
    }
    
    if (player.rosterEntries.length === 0) {
      console.warn(`❌ ${keeper.player} not on any roster (dropped?)`);
      continue;
    }
    
    // Use CURRENT team (not draft team, since players get traded)
    const rosterEntry = player.rosterEntries[0];
    const currentTeam = rosterEntry.team;
    
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
    const draftTeamNote = keeper.team !== currentTeam.name ? ` (was drafted by ${keeper.team})` : '';
    console.log(`✅ ${keeper.player} → ${currentTeam.name}${draftTeamNote}`);
    console.log(`   R${keeper.round}, Year ${keeperYearIndex + 1}, ${yearsRemaining} yrs left, Cost R${keeperRoundCost}\n`);
  }
  
  console.log(`✅ Updated ${updated} keeper records out of ${KEEPERS_2025.length}`);
  
  // Show Mooninites keepers specifically
  console.log("\n===== MOONINITES KEEPERS =====");
  const mooninites = await prisma.team.findFirst({
    where: { 
      leagueId: league.id,
      name: "Mooninites"
    },
    include: {
      rosterEntries: {
        where: { isKeeper: true },
        include: { player: true }
      }
    }
  });
  
  if (mooninites) {
    mooninites.rosterEntries.forEach(entry => {
      console.log(`  ${entry.player.name} (R${entry.originalDraftRound}, Year ${(entry.keeperYearIndex ?? 0) + 1}, ${entry.yearsRemaining} yrs left)`);
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
