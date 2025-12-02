import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@prisma/client";
import {
  YahooNotLinkedError,
  YahooTokenExpiredError,
  YahooFantasyError,
} from "@/lib/yahoo/fantasyClient";
import { syncUserLeagues } from "@/lib/yahoo/leagues";

export async function GET(request: NextRequest) {
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

    const leagues = await syncUserLeagues(request);

    return NextResponse.json({
      ok: true,
      leagues: leagues.map((league) => ({
        leagueKey: league.leagueKey,
        name: league.name,
        season: league.season,
        sport: league.sport,
        teamCount: league.teamCount,
      })),
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
      console.error("Yahoo Fantasy API leagues error:", {
        status: error.status,
        endpoint: error.endpoint,
        message: error.message,
      });

      return NextResponse.json(
        {
          ok: false,
          error: `Yahoo Fantasy API error: ${error.status} ${error.message}`,
        },
        { status: error.status >= 500 ? 500 : error.status }
      );
    }

    if (error instanceof Error && error.message.includes("No leagues")) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 404 }
      );
    }

    console.error("Unexpected error in Yahoo leagues endpoint:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

