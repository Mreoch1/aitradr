import prisma from "../lib/prisma";

async function main() {
  console.log("Checking for duplicate league records...\n");
  
  const leagues = await prisma.league.findMany({
    where: {
      OR: [
        { leagueKey: "465.l.9080" },
        { leagueKey: "465.1.9080" },
      ],
    },
    include: {
      _count: {
        select: {
          teams: true,
          draftPickValues: true,
        }
      }
    },
    orderBy: { createdAt: 'asc' }
  });
  
  console.log(`Found ${leagues.length} league records for atfh2:\n`);
  
  for (const league of leagues) {
    console.log(`League ID: ${league.id}`);
    console.log(`  leagueKey: ${league.leagueKey}`);
    console.log(`  userId: ${league.userId}`);
    console.log(`  name: ${league.name}`);
    console.log(`  teams: ${league._count.teams}`);
    console.log(`  draft pick values: ${league._count.draftPickValues}`);
    console.log(`  createdAt: ${league.createdAt.toISOString()}`);
    console.log(`  updatedAt: ${league.updatedAt.toISOString()}`);
    console.log("");
    
    // Show draft pick values for this league
    const pickValues = await prisma.draftPickValue.findMany({
      where: { leagueId: league.id },
      orderBy: { round: 'asc' }
    });
    
    console.log(`  Draft Pick Values:`);
    pickValues.forEach(pv => {
      console.log(`    R${pv.round}: ${pv.score.toFixed(1)}`);
    });
    console.log("\n---\n");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
