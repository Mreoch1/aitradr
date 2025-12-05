import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { buildTeamDashboard } from "@/lib/dashboard/builder";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueKey: string; teamId: string }> }
) {
  const { leagueKey, teamId } = await params;

  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    console.log("[Team Dashboard] Request for team:", teamId, "in league:", leagueKey);

    // Find league
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

    if (!league) {
      return NextResponse.json({ ok: false, error: "League not found" }, { status: 404 });
    }

    // Build dashboard
    const dashboard = await buildTeamDashboard(league.id, leagueKey, teamId);

    return NextResponse.json({
      ok: true,
      dashboard,
    });

  } catch (error) {
    console.error("[Team Dashboard] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to build dashboard" },
      { status: 500 }
    );
  }
}

