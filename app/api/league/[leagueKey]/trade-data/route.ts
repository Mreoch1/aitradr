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
import { syncLeagueRoster } from "@/lib/yahoo/roster";
import { getYahooAuthRedirectUrl } from "@/lib/yahoo/tokenExpiration";

export type TradeData = {
  leagueKey: string;
  leagueName: string;
  teams: {
    id: string;
    name: string;
    managerName: string | null;
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
  
  try {
    const session = await getSession();

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

    // Find the league
    const league = await prisma.league.findFirst({
      where: {
        userId: session.userId,
        OR: [
          { leagueKey: normalizedLeagueKey },
          { leagueKey: reverseNormalizedKey },
          { leagueKey: leagueKey },
        ],
      },
    });

    if (!league) {
      return NextResponse.json(
        { ok: false, error: `League not found: ${leagueKey}` },
        { status: 404 }
      );
    }

    // Sync rosters (teams and players) first
    try {
      console.log("[Trade Data] Starting roster sync for league:", leagueKey);
      await syncLeagueRoster(request, leagueKey);
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
    try {
      console.log("[Trade Data] Starting player stats sync for league:", leagueKey);
      await syncLeaguePlayerStats(request, leagueKey);
      console.log("[Trade Data] Player stats sync completed");
    } catch (error) {
      console.error("[Trade Data] Error syncing player stats:", error);
      // Continue even if stats sync fails - we'll use existing stats or defaults
    }
    
    // Ensure all players have calculated values
    await ensureLeaguePlayerValues(league.id);

    // Fetch all teams in this league
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

    // Build team roster data with player values and stats
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

        return {
          id: team.id,
          name: team.name,
          managerName: team.managerName,
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

    const tradeData: TradeData = {
      leagueKey: league.leagueKey,
      leagueName: league.name,
      teams: teamsData,
      draftPickValues: draftPickValues,
    };

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

