import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  YahooNotLinkedError,
  YahooTokenExpiredError,
  YahooFantasyError,
} from "@/lib/yahoo/fantasyClient";

/**
 * GET: Get draft picks for a team
 * POST: Update draft picks for a team
 */
export async function GET(
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

    const { leagueKey } = await params;
    const searchParams = request.nextUrl.searchParams;
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json(
        { ok: false, error: "teamId is required" },
        { status: 400 }
      );
    }

    // Normalize league key
    const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
    const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');

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

    const draftPicks = await prisma.teamDraftPick.findMany({
      where: {
        teamId,
        leagueId: league.id,
      },
      select: {
        round: true,
      },
      orderBy: {
        round: "asc",
      },
    });

    return NextResponse.json({
      ok: true,
      draftPicks: draftPicks.map((pick) => pick.round),
    });
  } catch (error) {
    console.error("Error fetching draft picks:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch draft picks",
      },
      { status: 500 }
    );
  }
}

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

    const { leagueKey } = await params;
    const body = await request.json();
    const { teamId, rounds } = body;

    if (!teamId || !Array.isArray(rounds)) {
      return NextResponse.json(
        { ok: false, error: "teamId and rounds array are required" },
        { status: 400 }
      );
    }

    // Validate rounds are 1-16
    const validRounds = rounds.filter(
      (r: number) => typeof r === "number" && r >= 1 && r <= 16
    );

    // Normalize league key
    const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
    const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');

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

    // Verify team belongs to this league
    const team = await prisma.team.findFirst({
      where: {
        id: teamId,
        leagueId: league.id,
      },
    });

    if (!team) {
      return NextResponse.json(
        { ok: false, error: "Team not found in this league" },
        { status: 404 }
      );
    }

    // Delete existing picks for this team
    await prisma.teamDraftPick.deleteMany({
      where: {
        teamId,
        leagueId: league.id,
      },
    });

    // Create new picks
    if (validRounds.length > 0) {
      await prisma.teamDraftPick.createMany({
        data: validRounds.map((round: number) => ({
          teamId,
          leagueId: league.id,
          round,
        })),
      });
    }

    return NextResponse.json({
      ok: true,
      message: "Draft picks updated",
      draftPicks: validRounds.sort((a: number, b: number) => a - b),
    });
  } catch (error) {
    console.error("Error updating draft picks:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to update draft picks",
      },
      { status: 500 }
    );
  }
}

