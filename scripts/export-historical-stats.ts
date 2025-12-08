/**
 * Script to fetch historical stats for all players and export to JSON
 * This creates a hard-coded historical stats file that can be committed to the repo
 * Run with: npx tsx scripts/export-historical-stats.ts
 */

import prisma from "../lib/prisma";
import { buildPlayerNameToNHLIdMap, findNHLPlayerIdByName } from "../lib/nhl/playerLookup";
import { fetchNHLPlayerSeasonStats, getLastTwoSeasons } from "../lib/nhl/historicalStats";
import fs from "fs";
import path from "path";

interface HistoricalStatsData {
  [playerName: string]: {
    [season: string]: {
      [statName: string]: number;
    };
  };
}

async function exportHistoricalStats() {
  console.log("[Export Historical Stats] Starting export...");
  
  // Get all unique players from database
  const players = await prisma.player.findMany({
    select: { id: true, name: true },
    distinct: ['name'],
    orderBy: { name: 'asc' },
  });

  console.log(`[Export Historical Stats] Found ${players.length} unique players in database`);

  // Get historical seasons
  const historicalSeasons = getLastTwoSeasons();
  console.log(`[Export Historical Stats] Fetching seasons: ${historicalSeasons.join(", ")}`);

  // Build NHL player lookup map
  console.log("[Export Historical Stats] Building NHL player lookup map...");
  const lookupMap = await buildPlayerNameToNHLIdMap();
  console.log(`[Export Historical Stats] Built lookup map with ${lookupMap.size} players`);

  const historicalStats: HistoricalStatsData = {};
  let playersProcessed = 0;
  let playersSkipped = 0;
  let totalStats = 0;

  // Process players in batches
  const batchSize = 5;
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize);

    for (const player of batch) {
      try {
        const nhlId = lookupMap.get(player.name.toLowerCase()) || await findNHLPlayerIdByName(player.name);

        if (!nhlId) {
          console.warn(`[Export Historical Stats] ⚠️  No NHL ID found for ${player.name}`);
          playersSkipped++;
          continue;
        }

        const playerStats: { [season: string]: { [statName: string]: number } } = {};

        // Fetch stats for each historical season
        for (const season of historicalSeasons) {
          const seasonStats = await fetchNHLPlayerSeasonStats(nhlId, season);
          
          if (seasonStats.length === 0) {
            continue;
          }

          const seasonYear = season.substring(0, 4); // "2023" from "20232024"
          playerStats[seasonYear] = {};

          for (const stat of seasonStats) {
            playerStats[seasonYear][stat.statName] = stat.value;
            totalStats++;
          }
        }

        if (Object.keys(playerStats).length > 0) {
          historicalStats[player.name] = playerStats;
          playersProcessed++;
          console.log(`[Export Historical Stats] ✅ ${player.name}: ${Object.keys(playerStats).length} seasons`);
        } else {
          playersSkipped++;
          console.warn(`[Export Historical Stats] ⚠️  ${player.name}: No stats found for any season`);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`[Export Historical Stats] Error processing ${player.name}:`, error);
        playersSkipped++;
      }
    }

    // Progress update
    if ((i + batchSize) % 50 === 0) {
      console.log(`[Export Historical Stats] Progress: ${i + batchSize}/${players.length} players`);
    }
  }

  // Save to JSON file
  const outputPath = path.join(process.cwd(), "data", "historical-stats.json");
  const outputDir = path.dirname(outputPath);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(historicalStats, null, 2));
  
  console.log("\n[Export Historical Stats] ===== EXPORT COMPLETE =====");
  console.log(`[Export Historical Stats] Players processed: ${playersProcessed}`);
  console.log(`[Export Historical Stats] Players skipped: ${playersSkipped}`);
  console.log(`[Export Historical Stats] Total stats: ${totalStats}`);
  console.log(`[Export Historical Stats] Output file: ${outputPath}`);
  console.log(`[Export Historical Stats] File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);

  await prisma.$disconnect();
}

exportHistoricalStats().catch((error) => {
  console.error("[Export Historical Stats] Fatal error:", error);
  process.exit(1);
});

