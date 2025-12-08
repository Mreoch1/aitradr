import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { findNHLPlayerIdByName } from "@/lib/nhl/playerLookup";
import { fetchNHLPlayerSeasonStats, getLastTwoSeasons } from "@/lib/nhl/historicalStats";
import { getSeasonForCurrentGame } from "@/lib/yahoo/season";

/**
 * Sync historical stats (last 2 seasons) for all players in a league
 * This fetches data from NHL API and stores it in PlayerSeasonStat table
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

    // Get league
    const league = await prisma.league.findFirst({
      where: {
        leagueKey,
        userId: session.userId,
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
      return NextResponse.json({ error: "League not found" }, { status: 404 });
    }

    // Get unique players from roster
    const uniquePlayers = Array.from(
      new Map(league.rosterEntries.map(e => [e.player.id, e.player])).values()
    );

    console.log(`[Historical Stats] Syncing stats for ${uniquePlayers.length} players`);

    // Get current season to determine which historical seasons to fetch
    const currentSeason = await getSeasonForCurrentGame(request);
    const historicalSeasons = getLastTwoSeasons(currentSeason);
    
    console.log(`[Historical Stats] Fetching seasons: ${historicalSeasons.join(", ")}`);

    // Build NHL player lookup map once
    const { buildPlayerNameToNHLIdMap } = await import("@/lib/nhl/playerLookup");
    const lookupMap = await buildPlayerNameToNHLIdMap();

    let totalStatsStored = 0;
    let playersProcessed = 0;
    let playersSkipped = 0;

    // Process players in batches to avoid rate limiting
    const batchSize = 10;
    for (let i = 0; i < uniquePlayers.length; i += batchSize) {
      const batch = uniquePlayers.slice(i, i + batchSize);
      
      for (const player of batch) {
        try {
          // Find NHL player ID
          const nhlPlayerId = await findNHLPlayerIdByName(player.name, lookupMap);
          
          if (!nhlPlayerId) {
            console.warn(`[Historical Stats] Could not find NHL ID for ${player.name}`);
            playersSkipped++;
            continue;
          }

          // Fetch stats for each historical season
          for (const season of historicalSeasons) {
            const seasonStats = await fetchNHLPlayerSeasonStats(nhlPlayerId, season);
            
            if (seasonStats.length === 0) {
              console.warn(`[Historical Stats] No stats found for ${player.name}, season ${season}`);
              continue;
            }

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

          playersProcessed++;
          
          // Rate limiting: wait 100ms between players
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`[Historical Stats] Error processing player ${player.name}:`, error);
          playersSkipped++;
        }
      }

      // Wait between batches
      if (i + batchSize < uniquePlayers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return NextResponse.json({
      success: true,
      message: `Historical stats sync completed`,
      stats: {
        playersProcessed,
        playersSkipped,
        totalStatsStored,
        seasons: historicalSeasons,
      },
    });
  } catch (error) {
    console.error("[Historical Stats] Error syncing historical stats:", error);
    return NextResponse.json(
      { error: "Failed to sync historical stats", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

