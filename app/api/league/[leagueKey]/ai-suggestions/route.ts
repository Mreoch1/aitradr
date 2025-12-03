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
    const myTeam = teams.find(t => t.yahooManagerId === yahooAccount.yahooUserId);
    if (!myTeam) {
      return NextResponse.json(
        { ok: false, error: "Your team could not be identified. Try clicking 'Refresh Teams' first." },
        { status: 400 }
      );
    }

    console.log("[AI Suggestions] User's team:", myTeam.name, "Yahoo ID:", yahooAccount.yahooUserId);

    // Get draft pick values for keeper bonus calculation
    const draftPickValues = await prisma.draftPickValue.findMany({
      where: { leagueId: league.id },
      orderBy: { round: 'asc' }
    });
    const pickValueMap = new Map(draftPickValues.map(pv => [pv.round, pv.score]));

    // Transform data for AI
    const teamsForAI: TeamForAI[] = teams.map(team => {
      const isCurrentUser = team.yahooManagerId === yahooAccount.yahooUserId;
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
        
        // Parse positions JSON string into array and filter out non-position values
        let positionsArray: string[] = [];
        try {
          const parsed = typeof player.positions === 'string' ? JSON.parse(player.positions) : player.positions;
          if (Array.isArray(parsed)) {
            // Filter out IR/Util, keep only actual positions
            positionsArray = parsed.filter((p: string) => 
              ["C", "LW", "RW", "D", "G"].includes(p)
            );
          }
        } catch (e) {
          console.error("[AI] Failed to parse positions for", player.name, player.positions);
        }
        
        // Use parsed array, fallback to primary position, or "?"
        const positionString = positionsArray.length > 0 
          ? positionsArray.join("/")
          : (player.primaryPosition || "?");
        
        // Calculate keeper bonus if applicable
        let keeperBonus = 0;
        if (entry.isKeeper && entry.keeperRoundCost && entry.yearsRemaining) {
          const draftRoundAvg = pickValueMap.get(entry.keeperRoundCost) ?? 100;
          const surplus = Math.max(0, (playerValue?.score || 0) - draftRoundAvg);
          keeperBonus = surplus * (entry.yearsRemaining / 3);
        }
        
        return {
          name: player.name,
          position: positionString,
          nhlTeam: player.teamAbbr || "?",
          value: playerValue?.score || 0,
          stats: statsObj,
          rawStats: stats.map(s => ({ statName: s.statName, value: s.value })), // Full stats for category analysis
          status: player.status || undefined,
          // Keeper data
          isKeeper: entry.isKeeper || false,
          keeperYearIndex: entry.keeperYearIndex ?? undefined,
          yearsRemaining: entry.yearsRemaining ?? undefined,
          keeperRoundCost: entry.keeperRoundCost ?? undefined,
          keeperBonus: keeperBonus,
        };
      });
      
      const totalValue = roster.reduce((sum, p) => sum + p.value, 0);
      
      return {
        name: team.name,
        managerName: team.managerName || undefined,
        isOwner: isCurrentUser,
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

