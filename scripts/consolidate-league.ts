import prisma from "../lib/prisma";

async function main() {
  console.log("Consolidating duplicate league records for atfh2...\n");
  
  const leagues = await prisma.league.findMany({
    where: {
      OR: [
        { leagueKey: "465.l.9080" },
        { leagueKey: "465.1.9080" },
      ],
    },
    include: {
      _count: {
        select: { teams: true, draftPickValues: true }
      }
    },
    orderBy: { createdAt: 'asc' }
  });
  
  if (leagues.length <= 1) {
    console.log("Only one league record found, no consolidation needed.");
    return;
  }
  
  console.log(`Found ${leagues.length} duplicate league records`);
  
  // Keep the one with the most teams (or first created as fallback)
  const primaryLeague = leagues.reduce((best, current) => {
    if (current._count.teams > best._count.teams) return current;
    if (current._count.teams === best._count.teams && current.createdAt < best.createdAt) return current;
    return best;
  });
  
  const duplicates = leagues.filter(l => l.id !== primaryLeague.id);
  
  console.log(`\nPrimary League (keeping): ${primaryLeague.id}`);
  console.log(`  leagueKey: ${primaryLeague.leagueKey}`);
  console.log(`  teams: ${primaryLeague._count.teams}`);
  console.log(`  draft pick values: ${primaryLeague._count.draftPickValues}`);
  
  // Delete all duplicate league records (cascade will handle dependent records)
  for (const duplicate of duplicates) {
    console.log(`\nDeleting duplicate: ${duplicate.id}`);
    console.log(`  userId: ${duplicate.userId}`);
    console.log(`  teams: ${duplicate._count.teams}`);
    
    await prisma.league.delete({
      where: { id: duplicate.id }
    });
    console.log(`  ✅ Deleted`);
  }
  
  console.log("\n✅ Consolidation complete!");
  console.log(`Remaining league: ${primaryLeague.id}`);
  
  // Show final draft pick values
  const finalPickValues = await prisma.draftPickValue.findMany({
    where: { leagueId: primaryLeague.id },
    orderBy: { round: 'asc' }
  });
  
  console.log("\nFinal Draft Pick Values:");
  finalPickValues.forEach(pv => {
    console.log(`  R${pv.round}: ${pv.score.toFixed(1)}`);
  });
  
  console.log("\n⚠️ NOTE: Users who had deleted league records will need to re-sync.");
  console.log("The app will automatically sync them to the primary league on next load.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
