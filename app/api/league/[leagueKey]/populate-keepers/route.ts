import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { populateKeeperData } from "@/lib/keeper/populate";

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

    console.log("[Populate Keepers] Starting for league:", leagueKey);
    
    // Find the league
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
    
    // Use shared populate function
    const updated = await populateKeeperData(league.id);
    
    return NextResponse.json({ 
      ok: true, 
      message: `Successfully populated ${updated} keeper records`
    });
  } catch (error) {
    console.error("[Populate Keepers] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to populate keepers" },
      { status: 500 }
    );
  }
}

