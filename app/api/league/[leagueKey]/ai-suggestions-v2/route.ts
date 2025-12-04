import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { loadTeamProfiles, type Player } from "@/lib/ai/teamProfile";
import { analyzeTrades } from "@/lib/ai/profileBasedTradeAnalyzer";
import { calculateKeeperBonus, getRoundTier } from "@/lib/keeper/types";

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

    console.log("[AI Suggestions V2] Starting analysis for league:", leagueKey);

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
      return NextResponse.json(
        { ok: false, error: "League not found" },
        { status: 404 }
      );
    }

    // Get current user's Yahoo ID to identify their team
    const yahooAccount = await prisma.yahooAccount.findUnique({
      where: { userId: session.userId },
      select: { yahooUserId: true }
    });
    
    if (!yahooAccount) {
      return NextResponse.json(
        { ok: false, error: "Yahoo account not linked" },
        { status: 400 }
      );
    }

    // Find user's team by matching Yahoo manager ID
    const teams = await prisma.team.findMany({
      where: { leagueId: league.id },
    });
    
    const myTeam = teams.find(t => t.yahooManagerId === yahooAccount.yahooUserId);
    if (!myTeam) {
      return NextResponse.json(
        { ok: false, error: "Your team could not be identified. Try clicking 'Refresh Teams' first." },
        { status: 400 }
      );
    }

    console.log("[AI Suggestions V2] User's team:", myTeam.name, "ID:", myTeam.id);

    // Load cached team profiles
    console.log("[AI Suggestions V2] Loading team profiles...");
    const profiles = await loadTeamProfiles(league.id);
    
    if (profiles.length === 0) {
      return NextResponse.json(
        { 
          ok: false, 
          error: "Team profiles not found. Please run 'Force Sync' first to build the AI cache." 
        },
        { status: 400 }
      );
    }

    console.log("[AI Suggestions V2] Loaded", profiles.length, "team profiles");

    // Build player pool with full data
    console.log("[AI Suggestions V2] Building player pool...");
    const playersFromDB = await prisma.player.findMany({
      include: {
        rosterEntries: {
          where: { leagueId: league.id },
        },
        playerValues: {
          where: { leagueId: league.id },
        },
        playerStats: {
          where: { leagueId: league.id },
        },
      },
    });

    // Get draft pick values for keeper bonus calculation
    const draftPickValues = await prisma.draftPickValue.findMany({
      where: { leagueId: league.id },
      orderBy: { round: 'asc' }
    });
    const pickValueMap = new Map(draftPickValues.map(pv => [pv.round, pv.score]));

    // Transform to Player objects
    const players: Player[] = [];
    
    for (const dbPlayer of playersFromDB) {
      // Find roster entry for this player
      const rosterEntry = dbPlayer.rosterEntries[0];
      if (!rosterEntry) continue; // Skip players not on any roster

      const playerValue = dbPlayer.playerValues[0];
      if (!playerValue) continue; // Skip players without values

      // Parse positions
      let positions: ("C" | "LW" | "RW" | "D" | "G")[] = [];
      try {
        const parsed = typeof dbPlayer.positions === 'string' 
          ? JSON.parse(dbPlayer.positions) 
          : dbPlayer.positions;
        if (Array.isArray(parsed)) {
          positions = parsed.filter((p: string) => 
            ["C", "LW", "RW", "D", "G"].includes(p)
          ) as ("C" | "LW" | "RW" | "D" | "G")[];
        }
      } catch (e) {
        console.error("[AI V2] Failed to parse positions for", dbPlayer.name);
      }

      const isGoalie = positions.includes("G");

      // Calculate keeper-adjusted value
      let valueBase = playerValue.score;
      let valueKeeper = valueBase;

      if (rosterEntry.isKeeper && rosterEntry.originalDraftRound && rosterEntry.yearsRemaining !== null) {
        const draftRoundAvg = pickValueMap.get(rosterEntry.originalDraftRound) ?? 100;
        const keeperBonus = calculateKeeperBonus(
          valueBase,
          rosterEntry.originalDraftRound,
          draftRoundAvg,
          rosterEntry.yearsRemaining
        );
        valueKeeper = valueBase + keeperBonus; // Use full keeper bonus for AI
      }

      // Build category object
      const categories: any = {};
      for (const stat of dbPlayer.playerStats) {
        const name = stat.statName.toLowerCase();
        const value = stat.value;

        if (!isGoalie) {
          if (name.includes("goal") && !name.includes("against")) categories.G = value;
          if (name.includes("assist")) categories.A = value;
          if (name.includes("point") && !name.includes("power") && !name.includes("short")) categories.P = value;
          if (name.includes("plus/minus") || name.includes("+/-")) categories.plusMinus = value;
          if (name.includes("penalty")) categories.PIM = value;
          if (name.includes("power play")) categories.PPP = value;
          if (name.includes("shorthanded")) categories.SHP = value;
          if (name.includes("game-winning")) categories.GWG = value;
          if (name.includes("shot") && !name.includes("shootout")) categories.SOG = value;
          if (name.includes("faceoff")) categories.FW = value;
          if (name.includes("hit")) categories.HIT = value;
          if (name.includes("block")) categories.BLK = value;
        } else {
          if (name.includes("win")) categories.W = value;
          if (name.includes("goals against average") || name === "gaa") categories.GAA = value;
          if (name.includes("save") && !name.includes("%")) categories.SV = value;
          if (name.includes("save %") || name.includes("save percentage")) categories.SVPct = value;
          if (name.includes("shutout")) categories.SHO = value;
        }
      }

      players.push({
        id: dbPlayer.id,
        name: dbPlayer.name,
        teamId: rosterEntry.teamId,
        nhlTeam: dbPlayer.teamAbbr || "?",
        positions,
        isGoalie,
        valueBase,
        valueKeeper,
        categories,
      });
    }

    console.log("[AI Suggestions V2] Built player pool:", players.length, "players");

    // Call AI with team profiles and player pool
    console.log("[AI Suggestions V2] Calling AI analyzer...");
    const suggestions = await analyzeTrades(myTeam.id, profiles, players);
    console.log("[AI Suggestions V2] Received", suggestions.length, "suggestions");

    return NextResponse.json({
      ok: true,
      suggestions,
      myTeamName: myTeam.name,
      profilesUsed: true,
      profileTimestamp: profiles[0]?.lastUpdated,
    });

  } catch (error) {
    console.error("[AI Suggestions V2] Error:", error);
    return NextResponse.json(
      { 
        ok: false, 
        error: error instanceof Error ? error.message : "AI analysis failed" 
      },
      { status: 500 }
    );
  }
}

