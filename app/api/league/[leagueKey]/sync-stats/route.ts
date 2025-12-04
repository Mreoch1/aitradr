import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import {
  YahooNotLinkedError,
  YahooTokenExpiredError,
  YahooFantasyError,
} from "@/lib/yahoo/fantasyClient";
import { syncLeaguePlayerStats } from "@/lib/yahoo/playerStats";
import { ensureLeaguePlayerValues } from "@/lib/yahoo/playerValues";
import { buildAllTeamProfiles, storeTeamProfiles } from "@/lib/ai/teamProfile";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueKey: string }> }
) {
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

    const { leagueKey } = await params;

    if (!leagueKey) {
      return NextResponse.json(
        { ok: false, error: "leagueKey is required" },
        { status: 400 }
      );
    }

    // Sync player stats
    await syncLeaguePlayerStats(request, leagueKey);

    // Recalculate player values with new stats
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
      orderBy: { createdAt: 'asc' },
    });

    if (league) {
      await ensureLeaguePlayerValues(league.id);
      
      // Rebuild team profiles after recalculating values
      try {
        const profiles = await buildAllTeamProfiles(league.id);
        await storeTeamProfiles(league.id, profiles);
        console.log("[Sync Stats] Team profiles rebuilt");
      } catch (error) {
        console.error("[Sync Stats] Team profile building failed:", error);
        // Don't fail the whole sync if team profiles fail
      }
    }

    return NextResponse.json({
      ok: true,
      message: "Player stats synced, values recalculated, and AI profiles refreshed",
    });
  } catch (error) {
    if (error instanceof YahooNotLinkedError) {
      return NextResponse.json(
        { ok: false, error: "Yahoo account not linked" },
        { status: 400 }
      );
    }

    if (error instanceof YahooTokenExpiredError) {
      return NextResponse.json(
        { ok: false, error: "Yahoo access token expired" },
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

    console.error("Error syncing player stats:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to sync player stats",
      },
      { status: 500 }
    );
  }
}

