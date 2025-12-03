import prisma from "../lib/prisma";

async function main() {
  console.log("Checking actual stat names in database...\n");
  
  const league = await prisma.league.findFirst({
    where: { leagueKey: "465.l.9080" },
    orderBy: { createdAt: 'asc' }
  });
  
  if (!league) {
    console.error("League not found!");
    return;
  }
  
  // Get a sample player (Nick Suzuki)
  const player = await prisma.player.findFirst({
    where: { name: { contains: "Suzuki" } },
    include: {
      playerStats: {
        where: { leagueId: league.id },
        orderBy: { statName: 'asc' }
      }
    }
  });
  
  if (!player) {
    console.error("Player not found!");
    return;
  }
  
  console.log(`Stats for ${player.name}:\n`);
  player.playerStats.forEach(stat => {
    console.log(`  "${stat.statName}": ${stat.value}`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
