import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";

export async function GET(
  request: NextRequest,
  { params }: { params: { leagueKey: string } }
) {
  try {
    const session = await getSession(request);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const { leagueKey } = params;

    // Find the league
    const league = await prisma.league.findFirst({
      where: {
        userId: session.userId,
        OR: [
          { leagueKey },
          { leagueKey: leagueKey.replace(/\.1\./, ".l.") },
          { leagueKey: leagueKey.replace(/\.l\./, ".1.") },
        ],
      },
    });

    if (!league) {
      return NextResponse.json({ ok: false, error: "League not found" }, { status: 404 });
    }

    // Fetch saved trades for this league
    const savedTrades = await prisma.savedTrade.findMany({
      where: {
        userId: session.userId,
        leagueId: league.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Parse JSON fields and add team names
    const tradesWithDetails = await Promise.all(
      savedTrades.map(async (trade) => {
        const teamA = await prisma.team.findUnique({
          where: { id: trade.teamAId },
          select: { name: true },
        });
        const teamB = await prisma.team.findUnique({
          where: { id: trade.teamBId },
          select: { name: true },
        });

        return {
          id: trade.id,
          tradeName: trade.tradeName,
          teamAName: teamA?.name || "Unknown",
          teamBName: teamB?.name || "Unknown",
          teamAPlayers: JSON.parse(trade.teamAPlayers),
          teamBPlayers: JSON.parse(trade.teamBPlayers),
          teamAPicks: JSON.parse(trade.teamAPicks),
          teamBPicks: JSON.parse(trade.teamBPicks),
          teamAValue: trade.teamAValue,
          teamBValue: trade.teamBValue,
          netDiff: trade.netDiff,
          createdAt: trade.createdAt.toISOString(),
        };
      })
    );

    return NextResponse.json({ ok: true, trades: tradesWithDetails });
  } catch (error) {
    console.error("[Saved Trades] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch saved trades" },
      { status: 500 }
    );
  }
}

