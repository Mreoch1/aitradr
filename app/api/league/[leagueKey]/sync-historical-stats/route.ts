import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { findNHLPlayerIdByName } from "@/lib/nhl/playerLookup";
import { fetchNHLPlayerSeasonStats, getLastTwoSeasons } from "@/lib/nhl/historicalStats";

/**
 * Sync historical stats (last 2 seasons) for all players in a league
 * This fetches data from NHL API and stores it in PlayerSeasonStat table
 * 
 * NOTE: Vercel serverless functions have DNS resolution issues with statsapi.web.nhl.com
 * If this fails, you can run the sync script locally: npx tsx scripts/sync-historical-stats.ts [leagueKey]
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueKey: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leagueKey } = await params;

    // Get league - use same query pattern as trade-data route (handle league key variations)
    const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
    const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');
    
    const league = await prisma.league.findFirst({
      where: {
        OR: [
          { leagueKey: normalizedLeagueKey },
          { leagueKey: reverseNormalizedKey },
          { leagueKey: leagueKey },
        ],
        userId: session.userId,
      },
      orderBy: { createdAt: 'asc' }, // Use the oldest record (primary league)
    });

    if (!league) {
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    console.log(`[Historical Stats] Found league: ${league.name} (${league.leagueKey})`);

    // Get all teams with roster entries (same pattern as trade-data route)
    const teams = await prisma.team.findMany({
      where: {
        leagueId: league.id,
      },
      include: {
        rosterEntries: {
          include: {
            player: true,
          },
        },
      },
    });

    console.log(`[Historical Stats] Found ${teams.length} teams`);

    // Get all roster entries from all teams
    const allRosterEntries = teams.flatMap(team => team.rosterEntries);
    console.log(`[Historical Stats] Found ${allRosterEntries.length} total roster entries`);

    // Get unique players from roster entries
    const uniquePlayers = Array.from(
      new Map(allRosterEntries.map(e => [e.player.id, e.player])).values()
    );

    console.log(`[Historical Stats] Syncing stats for ${uniquePlayers.length} unique players`);
    
    if (uniquePlayers.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No players found in league rosters. Please sync rosters first.",
        stats: {
          playersProcessed: 0,
          playersSkipped: 0,
          totalStatsStored: 0,
          teamsFound: teams.length,
          rosterEntriesFound: allRosterEntries.length,
        },
      });
    }

    // Get historical seasons (last 2 seasons) - use current year directly
    // getLastTwoSeasons() will use current year if no season provided
    const historicalSeasons = getLastTwoSeasons();
    
    console.log(`[Historical Stats] Fetching seasons: ${historicalSeasons.join(", ")}`);

    // Build NHL player lookup map once
    console.log("[Historical Stats] Building NHL player lookup map...");
    const { buildPlayerNameToNHLIdMap } = await import("@/lib/nhl/playerLookup");
    let lookupMap: Map<string, number>;
    try {
      lookupMap = await buildPlayerNameToNHLIdMap();
      console.log(`[Historical Stats] Built lookup map with ${lookupMap.size} players`);
    } catch (error) {
      console.error("[Historical Stats] Error building lookup map:", error);
      return NextResponse.json(
        { error: "Failed to build NHL player lookup map", details: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }

    let totalStatsStored = 0;
    let playersProcessed = 0;
    let playersSkipped = 0;
    let playersWithNoNHLId = 0;
    let playersWithNoStats = 0;

    console.log(`[Historical Stats] Starting to process ${uniquePlayers.length} players with lookup map size ${lookupMap.size}`);

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
            playersWithNoNHLId++;
            playersSkipped++;
            continue;
          }

          let playerHasStats = false;

          // Fetch stats for each historical season
          for (const season of historicalSeasons) {
            const seasonStats = await fetchNHLPlayerSeasonStats(nhlPlayerId, season);
            
            if (seasonStats.length === 0) {
              console.warn(`[Historical Stats] ⚠️  No stats found for ${player.name}, season ${season}`);
              continue;
            }

            playerHasStats = true;

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

          if (playerHasStats) {
            playersProcessed++;
            console.log(`[Historical Stats] ✅ Processed ${player.name}: ${totalStatsStored} stats stored so far`);
          } else {
            playersWithNoStats++;
            playersSkipped++;
            console.warn(`[Historical Stats] ⚠️  ${player.name} had NHL ID but no stats for any season`);
          }
          
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

    console.log(`[Historical Stats] ========== SYNC COMPLETED ==========`);
    console.log(`[Historical Stats] Total players: ${uniquePlayers.length}`);
    console.log(`[Historical Stats] Players processed (with stats): ${playersProcessed}`);
    console.log(`[Historical Stats] Players skipped: ${playersSkipped}`);
    console.log(`[Historical Stats]   - No NHL ID found: ${playersWithNoNHLId}`);
    console.log(`[Historical Stats]   - No stats found: ${playersWithNoStats}`);
    console.log(`[Historical Stats] Total stats stored: ${totalStatsStored}`);
    console.log(`[Historical Stats] Lookup map size: ${lookupMap.size}`);

    return NextResponse.json({
      success: true,
      message: `Historical stats sync completed`,
      successfulSyncs: playersProcessed,
      playersSkipped,
      totalStatsStored,
      seasons: historicalSeasons,
      totalPlayers: uniquePlayers.length,
      lookupMapSize: lookupMap.size,
      playersWithNoNHLId,
      playersWithNoStats,
    });
  } catch (error) {
    console.error("[Historical Stats] Error syncing historical stats:", error);
    return NextResponse.json(
      { error: "Failed to sync historical stats", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

