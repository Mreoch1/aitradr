import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

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

    const body = await request.json();
    const {
      tradeName,
      teamAId,
      teamBId,
      teamAPlayers,
      teamBPlayers,
      teamAPicks,
      teamBPicks,
      teamAValue,
      teamBValue,
      netDiff,
    } = body;

    // Find the league
    const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
    const league = await prisma.league.findFirst({
      where: {
        userId: session.userId,
        OR: [
          { leagueKey: normalizedLeagueKey },
          { leagueKey: leagueKey },
        ],
      },
    });

    if (!league) {
      return NextResponse.json({ ok: false, error: "League not found" }, { status: 404 });
    }

    // Create saved trade
    const savedTrade = await prisma.savedTrade.create({
      data: {
        userId: session.userId,
        leagueId: league.id,
        tradeName: tradeName || null,
        teamAId,
        teamBId,
        teamAPlayers: JSON.stringify(teamAPlayers || []),
        teamBPlayers: JSON.stringify(teamBPlayers || []),
        teamAPicks: JSON.stringify(teamAPicks || []),
        teamBPicks: JSON.stringify(teamBPicks || []),
        teamAValue,
        teamBValue,
        netDiff,
      },
    });

    console.log("[Save Trade] Trade saved:", savedTrade.id, tradeName || "(unnamed)");

    return NextResponse.json({
      ok: true,
      tradeId: savedTrade.id,
    });
  } catch (error) {
    console.error("[Save Trade] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to save trade" },
      { status: 500 }
    );
  }
}

