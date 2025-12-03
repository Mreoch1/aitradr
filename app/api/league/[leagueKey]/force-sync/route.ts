import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { syncLeagueRosters } from "@/lib/yahoo/roster";
import { syncLeaguePlayerStats } from "@/lib/yahoo/playerStats";
import { ensureLeaguePlayerValues } from "@/lib/yahoo/playerValues";

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

    console.log("[Force Sync] Starting full data sync for league:", leagueKey);
    
    // Find the league - shared across all users
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
      orderBy: { createdAt: 'asc' }, // Use the oldest record (primary league)
    });
    
    if (!league) {
      return NextResponse.json({ ok: false, error: "League not found" }, { status: 404 });
    }
    
    // Step 1: Sync rosters and teams with ownership detection
    console.log("[Force Sync] Step 1/3: Syncing rosters...");
    await syncLeagueRosters(request, leagueKey);
    console.log("[Force Sync] Rosters synced");
    
    // Step 2: Sync player stats from Yahoo
    console.log("[Force Sync] Step 2/3: Syncing player stats...");
    try {
      await syncLeaguePlayerStats(request, leagueKey);
      console.log("[Force Sync] Player stats synced");
    } catch (error) {
      console.error("[Force Sync] Stats sync failed:", error);
      // Continue - we'll try to calculate with existing stats
    }
    
    // Step 3: Calculate player values using z-scores
    console.log("[Force Sync] Step 3/3: Calculating player values...");
    try {
      await ensureLeaguePlayerValues(league.id);
      console.log("[Force Sync] Player values calculated");
    } catch (error) {
      console.error("[Force Sync] Value calculation failed:", error);
      return NextResponse.json(
        { ok: false, error: "Failed to calculate player values. Check Vercel logs for details." },
        { status: 500 }
      );
    }
    
    // Update league timestamp to mark as fresh
    await prisma.league.update({
      where: { id: league.id },
      data: { updatedAt: new Date() },
    });
    
    console.log("[Force Sync] Full sync completed successfully");
    
    return NextResponse.json({ 
      ok: true, 
      message: "Teams, stats, and values refreshed successfully" 
    });
  } catch (error) {
    console.error("[Force Sync] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

