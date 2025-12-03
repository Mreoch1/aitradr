import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth/session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leagueKey: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const { leagueKey } = await params;

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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ leagueKey: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const { leagueKey } = await params;
    const url = new URL(_request.url);
    const tradeId = url.searchParams.get("id");

    if (!tradeId) {
      return NextResponse.json({ ok: false, error: "Trade ID required" }, { status: 400 });
    }

    // Verify the trade belongs to this user
    const trade = await prisma.savedTrade.findUnique({
      where: { id: tradeId },
    });

    if (!trade) {
      return NextResponse.json({ ok: false, error: "Trade not found" }, { status: 404 });
    }

    if (trade.userId !== session.userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    // Delete the trade
    await prisma.savedTrade.delete({
      where: { id: tradeId },
    });

    console.log("[Saved Trades] Deleted trade:", tradeId);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Saved Trades] Delete error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to delete trade" },
      { status: 500 }
    );
  }
}

