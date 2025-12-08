/**
 * Script to sync historical stats for a league
 * Run with: npx tsx scripts/sync-historical-stats.ts [leagueKey]
 */

import prisma from "../lib/prisma";
import { buildPlayerNameToNHLIdMap, findNHLPlayerIdByName } from "../lib/nhl/playerLookup";
import { fetchNHLPlayerSeasonStats, getLastTwoSeasons } from "../lib/nhl/historicalStats";

async function syncHistoricalStats(leagueKey: string) {
  console.log(`[Historical Stats] Starting sync for league: ${leagueKey}`);
  
  // Get league
  const league = await prisma.league.findFirst({
    where: {
      leagueKey,
    },
    include: {
      rosterEntries: {
        include: {
          player: true,
        },
      },
    },
  });

  if (!league) {
    console.error(`[Historical Stats] League not found: ${leagueKey}`);
    process.exit(1);
  }

  console.log(`[Historical Stats] Found league: ${league.name}`);

  // Get unique players from roster
  const uniquePlayers = Array.from(
    new Map(league.rosterEntries.map(e => [e.player.id, e.player])).values()
  );

  console.log(`[Historical Stats] Found ${uniquePlayers.length} unique players`);

  // Determine historical seasons (last 2 seasons)
  // Current season is 2024, so we want 2023 and 2022
  const currentYear = new Date().getFullYear();
  const historicalSeasons = getLastTwoSeasons(currentYear.toString());
  
  console.log(`[Historical Stats] Fetching seasons: ${historicalSeasons.join(", ")}`);

  // Build NHL player lookup map once
  console.log(`[Historical Stats] Building NHL player lookup map...`);
  const lookupMap = await buildPlayerNameToNHLIdMap();
  console.log(`[Historical Stats] Built lookup map with ${lookupMap.size} players`);

  let totalStatsStored = 0;
  let playersProcessed = 0;
  let playersSkipped = 0;
  let playersWithHistoricalData = 0;

  // Process players in batches to avoid rate limiting
  const batchSize = 10;
  for (let i = 0; i < uniquePlayers.length; i += batchSize) {
    const batch = uniquePlayers.slice(i, i + batchSize);
    
    console.log(`[Historical Stats] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uniquePlayers.length / batchSize)} (${batch.length} players)`);
    
    for (const player of batch) {
      try {
        // Find NHL player ID
        const nhlPlayerId = await findNHLPlayerIdByName(player.name, lookupMap);
        
        if (!nhlPlayerId) {
          console.warn(`[Historical Stats] ⚠️  Could not find NHL ID for ${player.name}`);
          playersSkipped++;
          continue;
        }

        let playerHasData = false;

        // Fetch stats for each historical season
        for (const season of historicalSeasons) {
          const seasonStats = await fetchNHLPlayerSeasonStats(nhlPlayerId, season);
          
          if (seasonStats.length === 0) {
            console.warn(`[Historical Stats] ⚠️  No stats found for ${player.name}, season ${season}`);
            continue;
          }

          playerHasData = true;

          // Store stats in database
          for (const stat of seasonStats) {
            await prisma.playerSeasonStat.upsert({
              where: {
                playerId_season_statName: {
                  playerId: player.id,
                  season: season.substring(0, 4), // Store as "2023" instead of "20232024"
                  statName: stat.statName,
                },
              },
              update: {
                value: stat.value,
                gamesPlayed: stat.gamesPlayed,
                updatedAt: new Date(),
              },
              create: {
                playerId: player.id,
                season: season.substring(0, 4),
                statName: stat.statName,
                value: stat.value,
                gamesPlayed: stat.gamesPlayed,
              },
            });
            
            totalStatsStored++;
          }
        }

        if (playerHasData) {
          playersWithHistoricalData++;
          console.log(`[Historical Stats] ✅ ${player.name}: Stored historical stats`);
        }
        
        playersProcessed++;
        
        // Rate limiting: wait 100ms between players
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`[Historical Stats] ❌ Error processing player ${player.name}:`, error);
        playersSkipped++;
      }
    }

    // Wait between batches
    if (i + batchSize < uniquePlayers.length) {
      console.log(`[Historical Stats] Waiting 1 second before next batch...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n[Historical Stats] ✅ Sync completed!`);
  console.log(`[Historical Stats] Players processed: ${playersProcessed}`);
  console.log(`[Historical Stats] Players with historical data: ${playersWithHistoricalData}`);
  console.log(`[Historical Stats] Players skipped: ${playersSkipped}`);
  console.log(`[Historical Stats] Total stats stored: ${totalStatsStored}`);
  console.log(`[Historical Stats] Seasons: ${historicalSeasons.join(", ")}`);
}

// Main execution
const leagueKey = process.argv[2] || "465.l.9080";

syncHistoricalStats(leagueKey)
  .then(() => {
    console.log("\n[Historical Stats] Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n[Historical Stats] Fatal error:", error);
    process.exit(1);
  });

