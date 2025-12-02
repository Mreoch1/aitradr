import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@prisma/client";
import {
  YahooNotLinkedError,
  YahooTokenExpiredError,
  YahooFantasyError,
} from "@/lib/yahoo/fantasyClient";
import { syncLeagueRosters } from "@/lib/yahoo/roster";

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

    const searchParams = request.nextUrl.searchParams;
    const leagueKey = searchParams.get("leagueKey");

    if (!leagueKey) {
      return NextResponse.json(
        { ok: false, error: "leagueKey is required" },
        { status: 400 }
      );
    }

    const rosters = await syncLeagueRosters(request, leagueKey);

    return NextResponse.json({
      ok: true,
      leagueKey,
      rosters,
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
      console.error("Yahoo Fantasy API roster error:", {
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

    if (error instanceof Error) {
      if (error.message.includes("League not found")) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 404 }
        );
      }

      if (error.message.includes("No rosters found")) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 404 }
        );
      }

      if (error.message.includes("Not authenticated")) {
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 401 }
        );
      }
    }

    console.error("Unexpected error in Yahoo roster endpoint:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

