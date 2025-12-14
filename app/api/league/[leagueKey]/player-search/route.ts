import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

/**
 * Player Search API
 * Searches for players that excel in specified categories
 * 
 * Query params:
 * - categories: comma-separated list of category names (e.g., "plus/minus,hits")
 * - limit: number of results (default: 5)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueKey: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const { leagueKey } = await params;
    const searchParams = request.nextUrl.searchParams;
    const categoriesParam = searchParams.get("categories");
    const limit = parseInt(searchParams.get("limit") || "5", 10);

    if (!categoriesParam) {
      return NextResponse.json(
        { ok: false, error: "categories parameter is required" },
        { status: 400 }
      );
    }

    // Parse categories (normalize names)
    const requestedCategories = categoriesParam
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);

    if (requestedCategories.length === 0) {
      return NextResponse.json(
        { ok: false, error: "At least one category is required" },
        { status: 400 }
      );
    }

    // Normalize league key
    const normalizedLeagueKey = leagueKey.replace(/\.1\./g, ".l.");
    const league = await prisma.league.findFirst({
      where: {
        OR: [
          { leagueKey: normalizedLeagueKey },
          { leagueKey: leagueKey.replace(/\.l\./g, ".1.") },
        ],
      },
    });

    if (!league) {
      return NextResponse.json(
        { ok: false, error: "League not found" },
        { status: 404 }
      );
    }

    // Get all players in the league with their stats
    const players = await prisma.player.findMany({
      include: {
        playerStats: {
          where: { leagueId: league.id },
        },
        playerValues: {
          where: { leagueId: league.id },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        rosterEntries: {
          where: { leagueId: league.id },
          include: {
            team: true,
          },
        },
      },
    });

    // Map stat names to normalized versions for matching
    const normalizeStatName = (name: string): string => {
      return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[\/\-]/g, "/")
        .replace(/\./g, "");
    };

    // Map requested categories to possible stat name variations
    // These match Yahoo's actual stat names as stored in the database
    const categoryMap: Record<string, string[]> = {
      "goals": ["Goals"],
      "assists": ["Assists"],
      "points": ["Points"],
      "plus/minus": ["Plus/Minus", "Plus Minus", "+/-"],
      "penalty minutes": ["Penalty Minutes", "PIM"],
      "power play points": ["Powerplay Points", "Power Play Points", "PowerPlay Points", "PPP"],
      "short handed points": ["Shorthanded Points", "Short Handed Points", "ShortHanded Points", "SHP"],
      "game winning goals": ["Game-Winning Goals", "Game Winning Goals", "GameWinning Goals", "GWG"],
      "shots on goal": ["Shots on Goal", "Shots On Goal", "Shots", "SOG"],
      "faceoffs won": ["Faceoffs Won", "FaceOffs Won", "Faceoffs", "FW"],
      "hits": ["Hits", "HIT"],
      "blocked shots": ["Blocks", "Blocked Shots", "BLK"],
      "wins": ["Wins", "W"],
      "losses": ["Losses", "L"],
      "goals against": ["Goals Against", "GA"],
      "goals against average": ["Goals Against Average", "GAA"],
      "saves": ["Saves", "SV"],
      "save percentage": ["Save Percentage", "Save %", "SV%"],
      "shutouts": ["Shutouts", "SHO"],
    };

    // Score each player based on how well they match the requested categories
    const scoredPlayers = players
      .map((player) => {
        const statsMap = new Map<string, number>();
        for (const stat of player.playerStats) {
          const normalized = normalizeStatName(stat.statName);
          statsMap.set(normalized, stat.value);
        }

        // Calculate match score for requested categories
        let totalScore = 0;
        let matchedCategories = 0;
        const categoryScores: Record<string, number> = {};

        for (const requestedCategory of requestedCategories) {
          const possibleNames = categoryMap[requestedCategory] || [requestedCategory];
          let bestValue = 0;
          let matched = false;

          // Check against actual stat names in database (case-insensitive matching)
          for (const statEntry of player.playerStats) {
            const statNameLower = statEntry.statName.toLowerCase().trim();
            for (const possibleName of possibleNames) {
              const possibleNameLower = possibleName.toLowerCase().trim();
              // Try exact match or normalized match
              if (statNameLower === possibleNameLower || 
                  normalizeStatName(statEntry.statName) === normalizeStatName(possibleName)) {
                bestValue = Math.max(bestValue, statEntry.value);
                matched = true;
              }
            }
          }

          if (matched) {
            matchedCategories++;
            // Normalize score: higher is better, but cap extreme values
            // For negative categories (like GAA), we'd want lower values, but for now assume higher is better
            const normalizedScore = Math.min(bestValue / 10, 20); // Cap at 20 points per category
            totalScore += normalizedScore;
            categoryScores[requestedCategory] = bestValue;
          }
        }

        // Bonus for matching multiple categories
        const matchBonus = matchedCategories === requestedCategories.length ? 10 : 0;

        // Get player value
        const valueScore = player.playerValues[0]?.score || 0;

        // Get team info
        const rosterEntry = player.rosterEntries[0];
        const teamName = rosterEntry?.team?.name || "Free Agent";
        const isOnRoster = !!rosterEntry;

        return {
          playerId: player.id,
          name: player.name,
          nhlTeam: player.teamAbbr || "?",
          position: player.primaryPosition || player.positions || "?",
          valueScore,
          teamName,
          isOnRoster,
          matchScore: totalScore + matchBonus,
          matchedCategories,
          categoryScores,
          allStats: Array.from(statsMap.entries()).map(([name, value]) => ({
            name,
            value,
          })),
        };
      })
      .filter((p) => p.matchedCategories > 0) // Only include players with at least one matching category
      .sort((a, b) => {
        // Sort by match score (descending), then by value score (descending)
        if (b.matchScore !== a.matchScore) {
          return b.matchScore - a.matchScore;
        }
        return b.valueScore - a.valueScore;
      })
      .slice(0, limit);

    return NextResponse.json({
      ok: true,
      results: scoredPlayers,
      requestedCategories,
      totalFound: scoredPlayers.length,
    });
  } catch (error) {
    console.error("[Player Search] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

