import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { loadTeamProfiles } from "@/lib/ai/teamProfile";
import { analyzeTrades, type PlayerForAI, type TeamForAI } from "@/lib/ai/cleanTradeAnalyzer";
import { calculateKeeperBonus } from "@/lib/keeper/types";

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

    console.log("[AI V2] Starting for league:", leagueKey);

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

    // Get user's Yahoo ID
    const yahooAccount = await prisma.yahooAccount.findUnique({
      where: { userId: session.userId },
      select: { yahooUserId: true }
    });
    
    if (!yahooAccount) {
      return NextResponse.json({ ok: false, error: "Yahoo account not linked" }, { status: 400 });
    }

    // Load cached team profiles
    console.log("[AI V2] Loading cached profiles...");
    const profiles = await loadTeamProfiles(league.id);
    
    if (profiles.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Team profiles not found. Data is still syncing. Try again in 30 seconds." },
        { status: 400 }
      );
    }

    console.log("[AI V2] Loaded", profiles.length, "cached profiles");

    // Get draft pick values for keeper calculations
    const draftPickValues = await prisma.draftPickValue.findMany({
      where: { leagueId: league.id },
      orderBy: { round: 'asc' }
    });
    const pickValueMap = new Map(draftPickValues.map(pv => [pv.round, pv.score]));

    // Fetch all teams with rosters
    const teams = await prisma.team.findMany({
      where: { leagueId: league.id },
      include: {
        rosterEntries: {
          include: {
            player: {
              include: {
                playerValues: { where: { leagueId: league.id } },
                playerStats: { where: { leagueId: league.id } },
              },
            },
          },
        },
      },
    });

    // Find user's team
    const myTeam = teams.find(t => t.yahooManagerId === yahooAccount.yahooUserId);
    if (!myTeam) {
      return NextResponse.json(
        { ok: false, error: "Your team not found. Try refreshing teams first." },
        { status: 400 }
      );
    }

    console.log("[AI V2] User's team:", myTeam.name);

    // Build TeamForAI objects
    const teamsForAI: TeamForAI[] = teams.map(team => {
      const profile = profiles.find(p => p.teamId === team.id);
      if (!profile) {
        throw new Error(`Profile not found for team ${team.name}`);
      }

      const roster: PlayerForAI[] = team.rosterEntries.map(entry => {
        const player = entry.player;
        const baseValue = player.playerValues[0]?.score ?? 0;
        
        let keeperValue = baseValue;
        if (entry.isKeeper && entry.originalDraftRound && entry.yearsRemaining !== null) {
          const draftRoundAvg = pickValueMap.get(entry.originalDraftRound) ?? 100;
          const bonus = calculateKeeperBonus(baseValue, entry.originalDraftRound, draftRoundAvg, entry.yearsRemaining);
          keeperValue = baseValue + bonus;
        }

        // Parse positions
        let positions: string[] = [];
        try {
          const parsed = typeof player.positions === 'string' ? JSON.parse(player.positions) : player.positions;
          if (Array.isArray(parsed)) {
            positions = parsed.filter(p => ["C", "LW", "RW", "D", "G"].includes(p));
          }
        } catch (e) {}

        const isGoalie = positions.includes("G");

        // Build categories from stats
        const categories: any = {};
        for (const stat of player.playerStats) {
          const name = stat.statName.toLowerCase();
          const val = stat.value ?? 0;
          if (!isGoalie) {
            if (name.includes("goal") && !name.includes("against")) categories.G = val;
            if (name.includes("assist")) categories.A = val;
            if (name.includes("point") && !name.includes("power") && !name.includes("short")) categories.P = val;
            if (name.includes("plus/minus") || name.includes("+/-")) categories.plusMinus = val;
            if (name.includes("penalty")) categories.PIM = val;
            if (name.includes("power play") || name.includes("powerplay")) categories.PPP = val;
            if (name.includes("shorthanded") || name.includes("short handed")) categories.SHP = val;
            if (name.includes("game-winning") || name.includes("game winning")) categories.GWG = val;
            if (name.includes("shot") && !name.includes("shootout")) categories.SOG = val;
            if (name.includes("faceoff")) categories.FW = val;
            if (name.includes("hit")) categories.HIT = val;
            if (name.includes("block")) categories.BLK = val;
          } else {
            if (name.includes("win")) categories.W = val;
            if (name.includes("goals against average") || name === "gaa") categories.GAA = val;
            if (name.includes("save") && !name.includes("%") && !name.includes("percentage")) categories.SV = val;
            if (name.includes("save %") || name.includes("save percentage")) categories.SVPct = val;
            if (name.includes("shutout")) categories.SHO = val;
          }
        }

        return {
          id: player.id,
          name: player.name,
          positions,
          nhlTeam: player.teamAbbr || "?",
          valueBase: baseValue,
          valueKeeper: keeperValue,
          isKeeper: entry.isKeeper || false,
          yearsRemaining: entry.yearsRemaining ?? undefined,
          originalDraftRound: entry.originalDraftRound ?? undefined,
          categories,
        };
      });

      return {
        id: team.id,
        name: team.name,
        roster,
        profile,
      };
    });

    const myTeamForAI = teamsForAI.find(t => t.id === myTeam.id)!;

    console.log("[AI V2] Calling AI with", teamsForAI.length, "teams");
    const suggestions = await analyzeTrades(myTeamForAI, teamsForAI);
    console.log("[AI V2] Received", suggestions.length, "suggestions");

    return NextResponse.json({
      ok: true,
      suggestions,
      myTeamName: myTeam.name,
      profilesUsed: true,
      profileAge: profiles[0]?.lastUpdated,
    });

  } catch (error) {
    console.error("[AI V2] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AI analysis failed" },
      { status: 500 }
    );
  }
}
