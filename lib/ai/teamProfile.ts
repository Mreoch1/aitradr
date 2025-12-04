/**
 * Team Profile System for AI Trade Suggestions
 * 
 * Builds a structured analysis of each team's roster including:
 * - Dual-eligibility position counting
 * - Category strength/weakness analysis
 * - Positional surplus/shortage detection
 */

import prisma from "@/lib/prisma";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type Position = "C" | "LW" | "RW" | "D" | "G";

export interface Player {
  id: string;              // stable Yahoo or internal id
  name: string;
  teamId: string;          // fantasy team id
  nhlTeam: string;         // "COL", "EDM", etc
  positions: Position[];   // include all eligible spots, e.g. ["C", "RW"]
  isGoalie: boolean;
  valueBase: number;       // base value from weighted z score system
  valueKeeper: number;     // keeper adjusted value (base + keeper economics)
  categories: {
    // Skater categories
    G?: number;
    A?: number;
    P?: number;
    plusMinus?: number;
    PIM?: number;
    PPP?: number;
    SHP?: number;
    GWG?: number;
    SOG?: number;
    FW?: number;
    HIT?: number;
    BLK?: number;
    // Goalie categories
    W?: number;
    GAA?: number;
    SV?: number;
    SVPct?: number;
    SHO?: number;
  };
}

export interface PositionSummary {
  count: number;           // effective count including fractional multi eligible
  surplusScore: number;    // positive = surplus, negative = shortage
}

export interface CategorySummary {
  zScore: number;          // how far above or below league average
  strength: "weak" | "neutral" | "strong";
}

export interface TeamProfile {
  teamId: string;
  teamName: string;

  // positional information
  positions: Record<Position, PositionSummary>;
  flexSkaters: number;     // number of skaters with positions.length > 1

  // category information for skaters
  skaterCategories: {
    G: CategorySummary;
    A: CategorySummary;
    P: CategorySummary;
    plusMinus: CategorySummary;
    PIM: CategorySummary;
    PPP: CategorySummary;
    SHP: CategorySummary;
    GWG: CategorySummary;
    SOG: CategorySummary;
    FW: CategorySummary;
    HIT: CategorySummary;
    BLK: CategorySummary;
  };

  // category information for goalies
  goalieCategories: {
    W: CategorySummary;
    GAA: CategorySummary;
    SV: CategorySummary;
    SVPct: CategorySummary;
    SHO: CategorySummary;
  };

  // for convenience
  rosterPlayerIds: string[];
  lastUpdated: string; // ISO datetime
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse positions from database JSON string
 */
function parsePositions(positionsJson: string | string[] | null): Position[] {
  if (!positionsJson) return [];
  
  try {
    const parsed = typeof positionsJson === 'string' ? JSON.parse(positionsJson) : positionsJson;
    if (Array.isArray(parsed)) {
      // Filter out IR/Util, keep only actual positions
      return parsed.filter((p: string) => 
        ["C", "LW", "RW", "D", "G"].includes(p)
      ) as Position[];
    }
  } catch (e) {
    console.error("[Team Profile] Failed to parse positions:", positionsJson);
  }
  return [];
}

/**
 * Calculate category z-score for a team
 * @param teamTotal - Team's total in this category
 * @param leagueMean - League average for this category
 * @param leagueStdDev - League standard deviation for this category
 */
function calculateZScore(teamTotal: number, leagueMean: number, leagueStdDev: number): number {
  if (leagueStdDev === 0) return 0;
  return (teamTotal - leagueMean) / leagueStdDev;
}

/**
 * Map z-score to strength classification
 */
function classifyStrength(zScore: number): "weak" | "neutral" | "strong" {
  if (zScore >= 0.75) return "strong";
  if (zScore <= -0.75) return "weak";
  return "neutral";
}

/**
 * Calculate league statistics for a category
 */
function calculateLeagueStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  return { mean, stdDev };
}

// ============================================================================
// CORE PROFILE BUILDING LOGIC
// ============================================================================

/**
 * Build TeamProfile for a single team
 */
export async function buildTeamProfile(
  teamId: string,
  leagueId: string,
  leagueAvgPositions: Record<Position, number>,
  leagueCategoryStats: {
    skater: Record<string, { mean: number; stdDev: number }>;
    goalie: Record<string, { mean: number; stdDev: number }>;
  }
): Promise<TeamProfile> {
  // Fetch team with roster, player values, and stats
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      rosterEntries: {
        include: {
          player: {
            include: {
              playerValues: {
                where: { leagueId },
              },
              playerStats: {
                where: { leagueId },
              },
            },
          },
        },
      },
    },
  });

  if (!team) {
    throw new Error(`Team ${teamId} not found`);
  }

  // Initialize position counts
  const positions: Record<Position, PositionSummary> = {
    C: { count: 0, surplusScore: 0 },
    LW: { count: 0, surplusScore: 0 },
    RW: { count: 0, surplusScore: 0 },
    D: { count: 0, surplusScore: 0 },
    G: { count: 0, surplusScore: 0 },
  };

  let flexSkaters = 0;

  // Initialize category totals
  const skaterTotals: Record<string, number> = {
    G: 0, A: 0, P: 0, plusMinus: 0, PIM: 0, PPP: 0, 
    SHP: 0, GWG: 0, SOG: 0, FW: 0, HIT: 0, BLK: 0
  };
  const goalieTotals: Record<string, number> = {
    W: 0, GAA: 0, SV: 0, SVPct: 0, SHO: 0
  };

  const rosterPlayerIds: string[] = [];

  // Process each roster entry
  for (const entry of team.rosterEntries) {
    const player = entry.player;
    rosterPlayerIds.push(player.id);

    const playerPositions = parsePositions(player.positions);
    const isGoalie = playerPositions.includes("G");

    // Handle dual eligibility with fractional counting
    if (!isGoalie && playerPositions.length > 0) {
      const weight = 1 / playerPositions.length;
      
      for (const pos of playerPositions) {
        if (pos !== "G") {
          positions[pos].count += weight;
        }
      }

      if (playerPositions.length > 1) {
        flexSkaters++;
      }
    } else if (isGoalie) {
      positions.G.count += 1;
    }

    // Aggregate category stats
    const stats = player.playerStats;
    for (const stat of stats) {
      const name = stat.statName.toLowerCase();
      const value = stat.value;

      // Map stat names to category keys
      if (!isGoalie) {
        if (name.includes("goal") && !name.includes("against")) skaterTotals.G += value;
        if (name.includes("assist")) skaterTotals.A += value;
        if (name.includes("point") && !name.includes("power") && !name.includes("short")) skaterTotals.P += value;
        if (name.includes("plus/minus") || name.includes("+/-")) skaterTotals.plusMinus += value;
        if (name.includes("penalty")) skaterTotals.PIM += value;
        if (name.includes("power play")) skaterTotals.PPP += value;
        if (name.includes("shorthanded")) skaterTotals.SHP += value;
        if (name.includes("game-winning")) skaterTotals.GWG += value;
        if (name.includes("shot") && !name.includes("shootout")) skaterTotals.SOG += value;
        if (name.includes("faceoff")) skaterTotals.FW += value;
        if (name.includes("hit")) skaterTotals.HIT += value;
        if (name.includes("block")) skaterTotals.BLK += value;
      } else {
        if (name.includes("win")) goalieTotals.W += value;
        if (name.includes("goals against average") || name === "gaa") goalieTotals.GAA += value;
        if (name.includes("save") && !name.includes("%")) goalieTotals.SV += value;
        if (name.includes("save %") || name.includes("save percentage")) goalieTotals.SVPct += value;
        if (name.includes("shutout")) goalieTotals.SHO += value;
      }
    }
  }

  // Calculate positional surplus scores
  for (const pos of ["C", "LW", "RW", "D", "G"] as Position[]) {
    const flexBonus = pos !== "G" ? 0.1 * flexSkaters : 0;
    positions[pos].surplusScore = positions[pos].count - leagueAvgPositions[pos] + flexBonus;
  }

  // Calculate category z-scores and strengths for skaters
  const skaterCategories: any = {};
  for (const cat of Object.keys(skaterTotals)) {
    const stats = leagueCategoryStats.skater[cat];
    if (stats) {
      const zScore = calculateZScore(skaterTotals[cat], stats.mean, stats.stdDev);
      skaterCategories[cat] = {
        zScore,
        strength: classifyStrength(zScore),
      };
    } else {
      skaterCategories[cat] = { zScore: 0, strength: "neutral" };
    }
  }

  // Calculate category z-scores and strengths for goalies
  const goalieCategories: any = {};
  for (const cat of Object.keys(goalieTotals)) {
    const stats = leagueCategoryStats.goalie[cat];
    if (stats) {
      const zScore = calculateZScore(goalieTotals[cat], stats.mean, stats.stdDev);
      goalieCategories[cat] = {
        zScore,
        strength: classifyStrength(zScore),
      };
    } else {
      goalieCategories[cat] = { zScore: 0, strength: "neutral" };
    }
  }

  return {
    teamId: team.id,
    teamName: team.name,
    positions,
    flexSkaters,
    skaterCategories,
    goalieCategories,
    rosterPlayerIds,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Build all team profiles for a league
 */
export async function buildAllTeamProfiles(leagueId: string): Promise<TeamProfile[]> {
  console.log("[Team Profile] Building profiles for league:", leagueId);

  // Fetch all teams in league
  const teams = await prisma.team.findMany({
    where: { leagueId },
    include: {
      rosterEntries: {
        include: {
          player: {
            include: {
              playerValues: {
                where: { leagueId },
              },
              playerStats: {
                where: { leagueId },
              },
            },
          },
        },
      },
    },
  });

  if (teams.length === 0) {
    console.log("[Team Profile] No teams found for league");
    return [];
  }

  // =========================================================================
  // STEP 1: Calculate league-wide position averages (with dual eligibility)
  // =========================================================================
  const leaguePositionCounts: Record<Position, number[]> = {
    C: [], LW: [], RW: [], D: [], G: []
  };

  for (const team of teams) {
    const teamPositions: Record<Position, number> = {
      C: 0, LW: 0, RW: 0, D: 0, G: 0
    };

    for (const entry of team.rosterEntries) {
      const playerPositions = parsePositions(entry.player.positions);
      const isGoalie = playerPositions.includes("G");

      if (!isGoalie && playerPositions.length > 0) {
        const weight = 1 / playerPositions.length;
        for (const pos of playerPositions) {
          if (pos !== "G") {
            teamPositions[pos] += weight;
          }
        }
      } else if (isGoalie) {
        teamPositions.G += 1;
      }
    }

    // Add to league arrays
    for (const pos of ["C", "LW", "RW", "D", "G"] as Position[]) {
      leaguePositionCounts[pos].push(teamPositions[pos]);
    }
  }

  // Calculate average for each position
  const leagueAvgPositions: Record<Position, number> = {
    C: 0, LW: 0, RW: 0, D: 0, G: 0
  };
  for (const pos of ["C", "LW", "RW", "D", "G"] as Position[]) {
    const counts = leaguePositionCounts[pos];
    leagueAvgPositions[pos] = counts.reduce((sum, c) => sum + c, 0) / counts.length;
  }

  console.log("[Team Profile] League position averages:", leagueAvgPositions);

  // =========================================================================
  // STEP 2: Calculate league-wide category statistics
  // =========================================================================
  const skaterCategoryTotals: Record<string, number[]> = {
    G: [], A: [], P: [], plusMinus: [], PIM: [], PPP: [], 
    SHP: [], GWG: [], SOG: [], FW: [], HIT: [], BLK: []
  };
  const goalieCategoryTotals: Record<string, number[]> = {
    W: [], GAA: [], SV: [], SVPct: [], SHO: []
  };

  for (const team of teams) {
    const teamSkaterTotals: Record<string, number> = {
      G: 0, A: 0, P: 0, plusMinus: 0, PIM: 0, PPP: 0, 
      SHP: 0, GWG: 0, SOG: 0, FW: 0, HIT: 0, BLK: 0
    };
    const teamGoalieTotals: Record<string, number> = {
      W: 0, GAA: 0, SV: 0, SVPct: 0, SHO: 0
    };

    for (const entry of team.rosterEntries) {
      const player = entry.player;
      const playerPositions = parsePositions(player.positions);
      const isGoalie = playerPositions.includes("G");
      const stats = player.playerStats;

      for (const stat of stats) {
        const name = stat.statName.toLowerCase();
        const value = stat.value;

        if (!isGoalie) {
          if (name.includes("goal") && !name.includes("against")) teamSkaterTotals.G += value;
          if (name.includes("assist")) teamSkaterTotals.A += value;
          if (name.includes("point") && !name.includes("power") && !name.includes("short")) teamSkaterTotals.P += value;
          if (name.includes("plus/minus") || name.includes("+/-")) teamSkaterTotals.plusMinus += value;
          if (name.includes("penalty")) teamSkaterTotals.PIM += value;
          if (name.includes("power play")) teamSkaterTotals.PPP += value;
          if (name.includes("shorthanded")) teamSkaterTotals.SHP += value;
          if (name.includes("game-winning")) teamSkaterTotals.GWG += value;
          if (name.includes("shot") && !name.includes("shootout")) teamSkaterTotals.SOG += value;
          if (name.includes("faceoff")) teamSkaterTotals.FW += value;
          if (name.includes("hit")) teamSkaterTotals.HIT += value;
          if (name.includes("block")) teamSkaterTotals.BLK += value;
        } else {
          if (name.includes("win")) teamGoalieTotals.W += value;
          if (name.includes("goals against average") || name === "gaa") teamGoalieTotals.GAA += value;
          if (name.includes("save") && !name.includes("%")) teamGoalieTotals.SV += value;
          if (name.includes("save %") || name.includes("save percentage")) teamGoalieTotals.SVPct += value;
          if (name.includes("shutout")) teamGoalieTotals.SHO += value;
        }
      }
    }

    // Add to league arrays
    for (const cat of Object.keys(teamSkaterTotals)) {
      skaterCategoryTotals[cat].push(teamSkaterTotals[cat]);
    }
    for (const cat of Object.keys(teamGoalieTotals)) {
      goalieCategoryTotals[cat].push(teamGoalieTotals[cat]);
    }
  }

  // Calculate mean and std dev for each category
  const leagueCategoryStats = {
    skater: {} as Record<string, { mean: number; stdDev: number }>,
    goalie: {} as Record<string, { mean: number; stdDev: number }>,
  };

  for (const cat of Object.keys(skaterCategoryTotals)) {
    leagueCategoryStats.skater[cat] = calculateLeagueStats(skaterCategoryTotals[cat]);
  }
  for (const cat of Object.keys(goalieCategoryTotals)) {
    leagueCategoryStats.goalie[cat] = calculateLeagueStats(goalieCategoryTotals[cat]);
  }

  console.log("[Team Profile] League category stats calculated");

  // =========================================================================
  // STEP 3: Build individual team profiles
  // =========================================================================
  const profiles: TeamProfile[] = [];

  for (const team of teams) {
    const profile = await buildTeamProfile(
      team.id,
      leagueId,
      leagueAvgPositions,
      leagueCategoryStats
    );
    profiles.push(profile);
  }

  console.log(`[Team Profile] Built ${profiles.length} team profiles`);

  return profiles;
}

/**
 * Store team profiles in database
 */
export async function storeTeamProfiles(leagueId: string, profiles: TeamProfile[]): Promise<void> {
  console.log(`[Team Profile] Storing ${profiles.length} profiles for league ${leagueId}`);

  for (const profile of profiles) {
    await prisma.teamProfile.upsert({
      where: {
        teamId: profile.teamId,
      },
      update: {
        profileData: profile as any, // Store as JSON
        lastUpdated: new Date(),
      },
      create: {
        teamId: profile.teamId,
        leagueId,
        profileData: profile as any,
        lastUpdated: new Date(),
      },
    });
  }

  console.log("[Team Profile] All profiles stored");
}

/**
 * Load team profiles from database
 */
export async function loadTeamProfiles(leagueId: string): Promise<TeamProfile[]> {
  const records = await prisma.teamProfile.findMany({
    where: { leagueId },
  });

  return records.map(r => r.profileData as any as TeamProfile);
}

