import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getYahooGameKey } from "@/lib/yahoo/config";
import {
  YahooNotLinkedError,
  YahooTokenExpiredError,
  YahooFantasyError,
} from "@/lib/yahoo/fantasyClient";
import { getSeasonForCurrentGame } from "@/lib/yahoo/season";
import { getStatDefinitionsForCurrentGame } from "@/lib/yahoo/statDefinitions";

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

    const gameKey = getYahooGameKey();
    if (!gameKey) {
      return NextResponse.json(
        { ok: false, error: "YAHOO_GAME_KEY is not configured" },
        { status: 500 }
      );
    }

    const season = await getSeasonForCurrentGame(request);
    const statDefinitions = await getStatDefinitionsForCurrentGame(request);

    const sample = statDefinitions.stats.slice(0, 5).map((stat) => ({
      stat_id: stat.stat_id,
      name: stat.name,
      display_name: stat.display_name,
    }));

    return NextResponse.json({
      ok: true,
      gameKey,
      season,
      statDefinitionsSummary: {
        count: statDefinitions.stats.length,
        sample,
      },
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
      console.error("Yahoo Fantasy API metadata error:", {
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

    console.error("Unexpected error in Yahoo metadata endpoint:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

