import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { syncLeagueRosters } from "@/lib/yahoo/roster";

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

    console.log("[Force Sync] Starting forced roster sync for league:", leagueKey);
    
    // Sync rosters and teams with ownership detection
    await syncLeagueRosters(request, leagueKey);
    
    // Update league timestamp to mark as fresh
    await prisma.league.updateMany({
      where: {
        userId: session.userId,
        OR: [
          { leagueKey: leagueKey.replace(/\.1\./g, '.l.') },
          { leagueKey: leagueKey.replace(/\.l\./g, '.1.') },
          { leagueKey: leagueKey },
        ],
      },
      data: { updatedAt: new Date() },
    });
    
    console.log("[Force Sync] Roster sync completed");
    
    return NextResponse.json({ ok: true, message: "Teams refreshed successfully" });
  } catch (error) {
    console.error("[Force Sync] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

