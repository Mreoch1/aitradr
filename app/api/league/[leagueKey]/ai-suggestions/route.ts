import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { analyzeTrades, type TeamForAI, type PlayerForAI } from "@/lib/ai/tradeAnalyzer";

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

    console.log("[AI Suggestions] Starting analysis for league:", leagueKey);

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
      return NextResponse.json(
        { ok: false, error: "League not found" },
        { status: 404 }
      );
    }

    // Fetch all teams with rosters, stats, and values
    const teams = await prisma.team.findMany({
      where: { leagueId: league.id },
      include: {
        rosterEntries: {
          include: {
            player: {
              include: {
                playerValues: {
                  where: { leagueId: league.id },
                },
                playerStats: {
                  where: { leagueId: league.id },
                },
              },
            },
          },
        },
        draftPicks: true,
      },
    });

    console.log("[AI Suggestions] Found", teams.length, "teams");

    // Find user's team
    const myTeam = teams.find(t => t.isOwner);
    if (!myTeam) {
      return NextResponse.json(
        { ok: false, error: "Your team could not be identified. Try clicking 'Refresh Teams' first." },
        { status: 400 }
      );
    }

    console.log("[AI Suggestions] User's team:", myTeam.name);

    // Transform data for AI
    const teamsForAI: TeamForAI[] = teams.map(team => {
      const roster: PlayerForAI[] = team.rosterEntries.map(entry => {
        const player = entry.player;
        const playerValue = player.playerValues[0];
        const stats = player.playerStats;
        
        const statsObj: PlayerForAI["stats"] = {};
        stats.forEach(stat => {
          const name = stat.statName.toLowerCase();
          if (name.includes("goal") && !name.includes("against")) statsObj.goals = stat.value;
          if (name.includes("assist")) statsObj.assists = stat.value;
          if (name.includes("point") && !name.includes("power") && !name.includes("short")) statsObj.points = stat.value;
          if (name.includes("plus/minus") || name.includes("+/-")) statsObj.plusMinus = stat.value;
          if (name.includes("penalty")) statsObj.pim = stat.value;
          if (name.includes("power play")) statsObj.ppp = stat.value;
          if (name.includes("win")) statsObj.wins = stat.value;
          if (name.includes("save") && !name.includes("%")) statsObj.saves = stat.value;
          if (name.includes("save %") || name.includes("save percentage")) statsObj.savePct = stat.value;
          if (name.includes("shutout")) statsObj.shutouts = stat.value;
        });
        
        return {
          name: player.name,
          position: player.primaryPosition || player.positions || "?",
          nhlTeam: player.teamAbbr || "?",
          value: playerValue?.score || 0,
          stats: statsObj,
          status: player.status || undefined,
        };
      });
      
      const totalValue = roster.reduce((sum, p) => sum + p.value, 0);
      
      return {
        name: team.name,
        managerName: team.managerName || undefined,
        isOwner: team.isOwner,
        roster,
        draftPicks: team.draftPicks.map(dp => dp.round),
        totalValue,
      };
    });

    const myTeamForAI = teamsForAI.find(t => t.isOwner)!;
    
    console.log("[AI Suggestions] Calling DeepSeek AI...");
    const suggestions = await analyzeTrades(myTeamForAI, teamsForAI);
    console.log("[AI Suggestions] Received", suggestions.length, "suggestions");

    return NextResponse.json({
      ok: true,
      suggestions,
      myTeamName: myTeam.name,
    });

  } catch (error) {
    console.error("[AI Suggestions] Error:", error);
    return NextResponse.json(
      { 
        ok: false, 
        error: error instanceof Error ? error.message : "AI analysis failed" 
      },
      { status: 500 }
    );
  }
}

