/**
 * Script to initialize or update draft pick values for a league.
 * 
 * Usage: tsx scripts/init-draft-pick-values.ts <leagueKey>
 * Example: tsx scripts/init-draft-pick-values.ts 465.l.9080
 */

import { prisma } from "../lib/prisma";

// Hard-coded draft pick values (descending scale from round 1 to 16)
const DRAFT_PICK_VALUES: Record<number, number> = {
  1: 80,
  2: 70,
  3: 62,
  4: 55,
  5: 48,
  6: 42,
  7: 37,
  8: 32,
  9: 28,
  10: 24,
  11: 20,
  12: 16,
  13: 12,
  14: 9,
  15: 6,
  16: 4,
};

async function initDraftPickValues(leagueKey: string) {
  console.log(`Initializing draft pick values for league: ${leagueKey}`);

  // Normalize league key (handle both 'l' and '1' formats)
  const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
  const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');

  // Find the league
  const league = await prisma.league.findFirst({
    where: {
      OR: [
        { leagueKey: normalizedLeagueKey },
        { leagueKey: reverseNormalizedKey },
        { leagueKey: leagueKey },
      ],
    },
  });

  if (!league) {
    console.error(`League not found: ${leagueKey}`);
    console.error("Available leagues:");
    const allLeagues = await prisma.league.findMany({
      select: { leagueKey: true, name: true },
    });
    allLeagues.forEach((l) => {
      console.error(`  - ${l.leagueKey} (${l.name})`);
    });
    process.exit(1);
  }

  console.log(`Found league: ${league.name} (${league.leagueKey})`);

  // Upsert draft pick values for rounds 1-16
  for (let round = 1; round <= 16; round++) {
    const score = DRAFT_PICK_VALUES[round];
    if (score === undefined) {
      console.warn(`No value defined for round ${round}, skipping`);
      continue;
    }

    await prisma.draftPickValue.upsert({
      where: {
        leagueId_round: {
          leagueId: league.id,
          round,
        },
      },
      update: {
        score,
      },
      create: {
        leagueId: league.id,
        round,
        score,
      },
    });

    console.log(`  Round ${round}: ${score}`);
  }

  console.log("Draft pick values initialized successfully!");
}

// Main execution
const leagueKey = process.argv[2];

if (!leagueKey) {
  console.error("Usage: tsx scripts/init-draft-pick-values.ts <leagueKey>");
  console.error("Example: tsx scripts/init-draft-pick-values.ts 465.l.9080");
  process.exit(1);
}

initDraftPickValues(leagueKey)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });

