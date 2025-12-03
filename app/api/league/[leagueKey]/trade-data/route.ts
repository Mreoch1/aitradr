import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import {
  YahooNotLinkedError,
  YahooTokenExpiredError,
  YahooFantasyError,
} from "@/lib/yahoo/fantasyClient";
import { ensureLeaguePlayerValues } from "@/lib/yahoo/playerValues";
import { syncLeaguePlayerStats } from "@/lib/yahoo/playerStats";
import { syncLeagueRosters } from "@/lib/yahoo/roster";
import { getYahooAuthRedirectUrl } from "@/lib/yahoo/tokenExpiration";

export type TradeData = {
  leagueKey: string;
  leagueName: string;
  myTeamId?: string; // ID of the user's team
  myTeamName?: string; // Name of the user's team
  lastUpdated: string; // ISO timestamp of last data sync
  teams: {
    id: string;
    name: string;
    managerName: string | null;
    isOwner: boolean; // True if this is the logged-in user's team
    roster: {
      playerId: string;
      yahooPlayerId: string;
      name: string;
      nhlTeam: string | null;
      position: string | null;
      positions: string | null; // All eligible positions (e.g., "C,RW" or "LW,RW")
      status: string | null; // Injury status (IR, IR+, DTD, O, etc.)
      valueScore: number;
      stats: {
        statName: string;
        value: number;
      }[];
      // Keeper tracking
      isKeeper?: boolean;
      keeperYearIndex?: number;
      yearsRemaining?: number;
      keeperRoundCost?: number;
    }[];
    draftPicks: number[]; // Array of round numbers (1-16) that this team owns
  }[];
  draftPickValues: {
    round: number;
    score: number;
  }[];
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueKey: string }> }
) {
  // Extract leagueKey first so it's available in catch blocks
  const { leagueKey } = await params;
  console.log("[Trade Data] ========== STARTING TRADE DATA REQUEST ==========");
  console.log("[Trade Data] League key:", leagueKey);
  
  try {
    const session = await getSession();
    console.log("[Trade Data] Session:", session ? "authenticated" : "not authenticated");

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const yahooAccount = await prisma.yahooAccount.findUnique({
      where: { userId: session.userId },
    });

    if (!yahooAccount) {
      return NextResponse.json(
        { ok: false, error: "Yahoo account not linked" },
        { status: 400 }
      );
    }

    if (!leagueKey) {
      return NextResponse.json(
        { ok: false, error: "leagueKey is required" },
        { status: 400 }
      );
    }

    // Normalize league key
    const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
    const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');

    // Find the league - look for ANY league with this key (shared across all users)
    // This is the correct behavior since we hardcoded everyone to the same league
    let league = await prisma.league.findFirst({
      where: {
        OR: [
          { leagueKey: normalizedLeagueKey },
          { leagueKey: reverseNormalizedKey },
          { leagueKey: leagueKey },
        ],
      },
      orderBy: { createdAt: 'asc' }, // Use the oldest record (primary league)
    });

    // If league not found, sync leagues from Yahoo and try again
    if (!league) {
      console.log("[Trade Data] League not in database, syncing leagues from Yahoo...");
      const { syncUserLeagues } = await import("@/lib/yahoo/leagues");
      await syncUserLeagues(request);
      
      league = await prisma.league.findFirst({
        where: {
          OR: [
            { leagueKey: normalizedLeagueKey },
            { leagueKey: reverseNormalizedKey },
            { leagueKey: leagueKey },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!league) {
      return NextResponse.json(
        { ok: false, error: `You are not a member of league ${leagueKey}. This app is for the atfh2 league only.` },
        { status: 404 }
      );
    }

    // Check if we need to sync (only sync if data is older than 24 hours OR if refresh param is set)
    const searchParams = request.nextUrl.searchParams;
    const forceRefresh = searchParams.get("refresh") === "true";
    
    const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours (more frequent updates)
    const lastSync = league.updatedAt;
    const timeSinceSync = Date.now() - lastSync.getTime();
    const needsSync = timeSinceSync > SYNC_INTERVAL_MS || forceRefresh;
    
    console.log("[Trade Data] Last sync:", lastSync.toISOString(), "Time since:", Math.round(timeSinceSync / 1000 / 60), "minutes");
    console.log("[Trade Data] Force refresh:", forceRefresh);
    console.log("[Trade Data] Needs sync:", needsSync);

    if (needsSync) {
      // Sync rosters (teams and players)
      try {
        console.log("[Trade Data] Starting roster sync for league:", leagueKey);
        await syncLeagueRosters(request, leagueKey);
        console.log("[Trade Data] Roster sync completed");
      } catch (error) {
        console.error("[Trade Data] Error syncing rosters:", error);
        if (error instanceof Error) {
          console.error("[Trade Data] Error message:", error.message);
          
          // If Yahoo is blocking with 999, throw a proper error
          if (error.message.includes("status 999") || error.message.includes("Request denied")) {
            return NextResponse.json(
              { 
                ok: false, 
                error: "Yahoo API access blocked. Your access token may have expired or been revoked. Please re-authenticate.",
                reauth: true,
                reauthUrl: `/api/auth/yahoo/start?returnTo=${encodeURIComponent(`/league/${leagueKey}/trade`)}`,
              },
              { status: 401 }
            );
          }
        }
      }

      // Sync player stats
      let statsSuccess = false;
      try {
        console.log("[Trade Data] Starting player stats sync for league:", leagueKey);
        await syncLeaguePlayerStats(request, leagueKey);
        console.log("[Trade Data] Player stats sync completed");
        statsSuccess = true;
      } catch (error) {
        console.error("[Trade Data] Error syncing player stats:", error);
        if (error instanceof Error) {
          console.error("[Trade Data] Stats sync error details:", error.message);
        }
        // Continue - we'll try to use existing stats
      }
      
      // Update the league's updatedAt timestamp
      await prisma.league.update({
        where: { id: league.id },
        data: { updatedAt: new Date() },
      });
      
      // Calculate player values (only if we have fresh stats or this is first run)
      if (statsSuccess || forceRefresh) {
        console.log("[Trade Data] Calculating player values...");
        try {
          await ensureLeaguePlayerValues(league.id);
          console.log("[Trade Data] Player values calculated successfully");
        } catch (error) {
          console.error("[Trade Data] Error calculating player values:", error);
          if (error instanceof Error) {
            console.error("[Trade Data] Value calc error details:", error.message);
          }
        }
      }
    } else {
      console.log("[Trade Data] Using cached data (last sync was recent)");
    }
    
    // Always try to ensure values exist (in case previous sync failed)
    try {
      const valueCount = await prisma.playerValue.count({
        where: { leagueId: league.id }
      });
      console.log("[Trade Data] Found", valueCount, "player values in database");
      
      if (valueCount === 0) {
        console.log("[Trade Data] No player values found, attempting calculation...");
        await ensureLeaguePlayerValues(league.id);
      }
    } catch (error) {
      console.error("[Trade Data] Error checking/ensuring player values:", error);
    }

    // Fetch all teams in this league
    console.log("[Trade Data] Querying teams from database for league:", league.id);
    const teams = await prisma.team.findMany({
      where: { leagueId: league.id },
      include: {
        rosterEntries: {
          include: {
            player: true,
          },
        },
      },
      orderBy: {
        name: "asc",
      },
    });
    console.log("[Trade Data] Found", teams.length, "teams in database");
    if (teams.length > 0) {
      console.log("[Trade Data] Team names:", teams.map(t => t.name).join(", "));
    }

    // Build team roster data with player values and stats
    // Determine ownership dynamically based on current user's Yahoo ID
    const currentUserYahooId = yahooAccount.yahooUserId;
    
    const teamsData = await Promise.all(
      teams.map(async (team: any) => {
        const roster = await Promise.all(
          team.rosterEntries.map(async (entry: any) => {
            const playerValue = await prisma.playerValue.findUnique({
              where: {
                playerId_leagueId: {
                  playerId: entry.playerId,
                  leagueId: league.id,
                },
              },
            });

            // Get player stats
            const playerStats = await prisma.playerStat.findMany({
              where: {
                playerId: entry.playerId,
                leagueId: league.id,
              },
              select: {
                statName: true,
                value: true,
              },
              orderBy: {
                statName: "asc",
              },
            });

            return {
              playerId: entry.playerId,
              yahooPlayerId: entry.player.playerKey,
              name: entry.player.name,
              nhlTeam: entry.player.teamAbbr,
              position: entry.player.primaryPosition,
              positions: entry.player.positions, // All eligible positions
              status: entry.player.status, // Injury status (IR, IR+, DTD, etc.)
              valueScore: playerValue?.score ?? 0,
              stats: playerStats,
              // Keeper data
              isKeeper: entry.isKeeper || false,
              keeperYearIndex: entry.keeperYearIndex ?? undefined,
              yearsRemaining: entry.yearsRemaining ?? undefined,
              keeperRoundCost: entry.keeperRoundCost ?? undefined,
            };
          })
        );

        // Get draft picks owned by this team
        const teamDraftPicks = await prisma.teamDraftPick.findMany({
          where: {
            teamId: team.id,
            leagueId: league.id,
          },
          select: {
            round: true,
          },
        });

        // Determine if this team belongs to the current user
        const isOwner = team.yahooManagerId === currentUserYahooId;

        return {
          id: team.id,
          name: team.name,
          managerName: team.managerName,
          isOwner: isOwner,
          roster,
          draftPicks: teamDraftPicks.map((pick: { round: number }) => pick.round).sort((a: number, b: number) => a - b) || [],
        };
      })
    );

    // Fetch draft pick values (calculated dynamically from player values)
    const draftPickValues = await prisma.draftPickValue.findMany({
      where: { leagueId: league.id },
      orderBy: { round: "asc" },
      select: {
        round: true,
        score: true,
      },
    });

    // Identify the user's team
    const myTeam = teamsData.find(t => t.isOwner);
    
    const tradeData: TradeData = {
      leagueKey: league.leagueKey,
      leagueName: league.name,
      myTeamId: myTeam?.id,
      myTeamName: myTeam?.name,
      lastUpdated: league.updatedAt.toISOString(),
      teams: teamsData,
      draftPickValues: draftPickValues,
    };

    console.log("[Trade Data] User's team:", myTeam ? `${myTeam.name} (${myTeam.id})` : "Not identified");

    return NextResponse.json({
      ok: true,
      data: tradeData,
    });
  } catch (error) {
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

    if (error instanceof YahooFantasyError) {
      return NextResponse.json(
        {
          ok: false,
          error: `Yahoo Fantasy API error: ${error.status} ${error.message}`,
        },
        { status: 500 }
      );
    }

    console.error("Error fetching trade data:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch trade data",
      },
      { status: 500 }
    );
  }
}

