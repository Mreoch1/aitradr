import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { syncLeagueRosters } from "@/lib/yahoo/roster";
import { syncLeaguePlayerStats } from "@/lib/yahoo/playerStats";
import { ensureLeaguePlayerValues } from "@/lib/yahoo/playerValues";
import { buildAllTeamProfiles, storeTeamProfiles } from "@/lib/ai/teamProfile";
import {
  YahooNotLinkedError,
  YahooTokenExpiredError,
} from "@/lib/yahoo/fantasyClient";
import { getYahooAuthRedirectUrl } from "@/lib/yahoo/tokenExpiration";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueKey: string }> }
) {
  const { leagueKey } = await params;
  
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    console.log("[Force Sync] Starting full data sync for league:", leagueKey);
    
    // Find the league - shared across all users
    const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
    const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');
    
    const league = await prisma.league.findFirst({
      where: {
        OR: [
          { leagueKey: normalizedLeagueKey },
          { leagueKey: reverseNormalizedKey },
          { leagueKey: leagueKey },
        ],
      },
      orderBy: { createdAt: 'asc' }, // Use the oldest record (primary league)
    });
    
    if (!league) {
      return NextResponse.json({ ok: false, error: "League not found" }, { status: 404 });
    }
    
    // Step 1: Sync rosters and teams with ownership detection
    console.log("[Force Sync] Step 1/3: Syncing rosters...");
    await syncLeagueRosters(request, leagueKey);
    console.log("[Force Sync] Rosters synced");
    
    // Step 2: Sync player stats from Yahoo
    console.log("[Force Sync] Step 2/5: Syncing player stats...");
    try {
      await syncLeaguePlayerStats(request, leagueKey);
      console.log("[Force Sync] Player stats synced");
    } catch (error) {
      console.error("[Force Sync] Stats sync failed:", error);
      // Continue - we'll try to calculate with existing stats
    }
    
    // Step 3: Sync historical stats from NHL API (optional - may fail due to network limits)
    console.log("[Force Sync] Step 3/5: Syncing historical stats from NHL API...");
    try {
      // Import and call the historical stats sync logic
      const { findNHLPlayerIdByName, buildPlayerNameToNHLIdMap } = await import("@/lib/nhl/playerLookup");
      const { fetchNHLPlayerSeasonStats, getLastTwoSeasons } = await import("@/lib/nhl/historicalStats");
      
      // Get all teams with roster entries
      const teams = await prisma.team.findMany({
        where: { leagueId: league.id },
        include: {
          rosterEntries: {
            include: { player: true },
          },
        },
      });
      
      const allRosterEntries = teams.flatMap(team => team.rosterEntries);
      const uniquePlayers = Array.from(
        new Map(allRosterEntries.map(e => [e.player.id, e.player])).values()
      );
      
      if (uniquePlayers.length > 0) {
        const historicalSeasons = getLastTwoSeasons();
        const lookupMap = await buildPlayerNameToNHLIdMap();
        const batchSize = 10;
        let playersProcessed = 0;
        
        // Process in batches to avoid rate limits
        for (let i = 0; i < uniquePlayers.length; i += batchSize) {
          const batch = uniquePlayers.slice(i, i + batchSize);
          
          for (const player of batch) {
            const nhlId = lookupMap.get(player.name.toLowerCase()) || await findNHLPlayerIdByName(player.name);
            
            if (!nhlId) {
              continue;
            }
            
            for (const season of historicalSeasons) {
              try {
                const stats = await fetchNHLPlayerSeasonStats(nhlId, season);
                
                for (const stat of stats) {
                  await prisma.playerSeasonStat.upsert({
                    where: {
                      playerId_season_statName: {
                        playerId: player.id,
                        season,
                        statName: stat.statName,
                      },
                    },
                    update: {
                      value: stat.value,
                      gamesPlayed: stat.gamesPlayed,
                    },
                    create: {
                      playerId: player.id,
                      season,
                      statName: stat.statName,
                      value: stat.value,
                      gamesPlayed: stat.gamesPlayed,
                    },
                  });
                }
                
                if (stats.length > 0) {
                  playersProcessed++;
                }
              } catch (error) {
                console.error(`[Force Sync] Error syncing historical stats for ${player.name}, season ${season}:`, error);
              }
            }
          }
          
          // Rate limiting between batches
          if (i + batchSize < uniquePlayers.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        console.log(`[Force Sync] Historical stats synced for ${playersProcessed} players`);
      }
    } catch (error) {
      console.error("[Force Sync] Historical stats sync failed (this is optional):", error);
      // Continue - historical stats are nice to have but not required
    }
    
    // Step 4: Calculate player values using z-scores (now includes historical stats if available)
    console.log("[Force Sync] Step 4/5: Calculating player values...");
    try {
      await ensureLeaguePlayerValues(league.id);
      console.log("[Force Sync] Player values calculated");
    } catch (error) {
      console.error("[Force Sync] Value calculation failed:", error);
      return NextResponse.json(
        { ok: false, error: "Failed to calculate player values. Check Vercel logs for details." },
        { status: 500 }
      );
    }
    
    // Step 5: Auto-populate keeper data from hardcoded list
    console.log("[Force Sync] Step 5/6: Populating keeper data...");
    try {
      const { populateKeeperData } = await import("@/lib/keeper/populate");
      await populateKeeperData(league.id);
      console.log("[Force Sync] Keeper data populated");
    } catch (error) {
      console.error("[Force Sync] Keeper population failed:", error);
      // Don't fail the whole sync if keeper population fails
    }
    
    // Step 6: Build and cache team profiles for AI suggestions
    console.log("[Force Sync] Step 6/6: Building team profiles...");
    try {
      const profiles = await buildAllTeamProfiles(league.id);
      await storeTeamProfiles(league.id, profiles);
      console.log("[Force Sync] Team profiles built and cached");
    } catch (error) {
      console.error("[Force Sync] Team profile building failed:", error);
      // Don't fail the whole sync if team profiles fail
    }
    
    // Update league timestamp to mark as fresh
    await prisma.league.update({
      where: { id: league.id },
      data: { updatedAt: new Date() },
    });
    
    console.log("[Force Sync] Full sync completed successfully");
    
    return NextResponse.json({ 
      ok: true, 
      message: "Teams, stats, historical stats, values, keepers, and AI profiles refreshed successfully" 
    });
  } catch (error) {
    console.error("[Force Sync] Error:", error);
    
    if (error instanceof YahooNotLinkedError) {
      return NextResponse.json(
        { ok: false, error: "Yahoo account not linked" },
        { status: 400 }
      );
    }

    if (error instanceof YahooTokenExpiredError) {
      // Return 401 with redirect URL in response
      const returnTo = `/league/${encodeURIComponent(leagueKey)}/trade`;
      const redirectUrl = getYahooAuthRedirectUrl(returnTo);
      return NextResponse.json(
        { 
          ok: false, 
          error: "Yahoo access token expired",
          redirectUrl,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

