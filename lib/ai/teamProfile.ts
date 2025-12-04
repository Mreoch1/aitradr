/**
 * Team Profile System for AI Trade Suggestions
 * 
 * Pre-computes and caches structured team analysis:
 * - Dual-eligibility position counting
 * - Category strength/weakness (z-scores)
 * - Positional surplus/shortage
 * - Keeper leverage analysis
 */

import prisma from "@/lib/prisma";
import { calculateKeeperBonus } from "@/lib/keeper/types";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type Position = "C" | "LW" | "RW" | "D" | "G";

export interface TeamProfile {
  teamId: string;
  teamName: string;
  managerId: string | null;
  
  // Position analysis (dual-eligibility aware)
  positions: {
    C: { count: number; surplusScore: number };
    LW: { count: number; surplusScore: number };
    RW: { count: number; surplusScore: number };
    D: { count: number; surplusScore: number };
    G: { count: number; surplusScore: number };
  };
  flexSkaters: number; // Count of multi-position players
  
  // Category z-scores
  categories: {
    // Skater categories
    G: number;
    A: number;
    P: number;
    plusMinus: number;
    PIM: number;
    PPP: number;
    SHP: number;
    GWG: number;
    SOG: number;
    FW: number;
    HIT: number;
    BLK: number;
    // Goalie categories
    W: number;
    GAA: number;
    SV: number;
    SVPct: number;
    SHO: number;
  };
  
  // Keeper state
  keepers: {
    expiring: string[]; // Player IDs with yearsRemaining === 1
    fresh: string[];    // Player IDs with yearsRemaining >= 2
    elite: string[];    // Player IDs with value >= 160
  };
  
  // Roster
  rosterPlayerIds: string[];
  
  lastUpdated: string; // ISO datetime
}

// ============================================================================
// HELPERS
// ============================================================================

function parsePositions(positionsJson: string | string[] | null): Position[] {
  if (!positionsJson) return [];
  
  try {
    const parsed = typeof positionsJson === 'string' ? JSON.parse(positionsJson) : positionsJson;
    if (Array.isArray(parsed)) {
      return parsed.filter((p: string) => ["C", "LW", "RW", "D", "G"].includes(p)) as Position[];
    }
  } catch (e) {
    console.error("[Team Profile] Failed to parse positions:", positionsJson);
  }
  return [];
}

function calculateZScore(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 0;
  return (value - mean) / stdDev;
}

function calculateStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

// ============================================================================
// MAIN PROFILE BUILDER
// ============================================================================

export async function buildAllTeamProfiles(leagueId: string): Promise<TeamProfile[]> {
  console.log("[Team Profile] Building profiles for league:", leagueId);

  // Fetch all teams with complete data
  const teams = await prisma.team.findMany({
    where: { leagueId },
    include: {
      rosterEntries: {
        include: {
          player: {
            include: {
              playerValues: { where: { leagueId } },
              playerStats: { where: { leagueId } },
            },
          },
        },
      },
    },
  });

  if (teams.length === 0) {
    console.log("[Team Profile] No teams found");
    return [];
  }

  // Get draft pick values for keeper calculations
  const draftPickValues = await prisma.draftPickValue.findMany({
    where: { leagueId },
    orderBy: { round: 'asc' }
  });
  const pickValueMap = new Map(draftPickValues.map(pv => [pv.round, pv.score]));

  // =========================================================================
  // STEP 1: Aggregate league-wide data for z-score calculations
  // =========================================================================

  const teamCategoryTotals: Map<string, Record<string, number>> = new Map();
  const teamPositionCounts: Map<string, Record<Position, number>> = new Map();

  for (const team of teams) {
    const catTotals: Record<string, number> = {
      G: 0, A: 0, P: 0, plusMinus: 0, PIM: 0, PPP: 0,
      SHP: 0, GWG: 0, SOG: 0, FW: 0, HIT: 0, BLK: 0,
      W: 0, GAA: 0, SV: 0, SVPct: 0, SHO: 0
    };
    const posCounts: Record<Position, number> = { C: 0, LW: 0, RW: 0, D: 0, G: 0 };

    for (const entry of team.rosterEntries) {
      const player = entry.player;
      const positions = parsePositions(player.positions);
      const isGoalie = positions.includes("G");

      // Position counting with dual eligibility
      if (!isGoalie && positions.length > 0) {
        const weight = 1 / positions.length;
        for (const pos of positions) {
          if (pos !== "G") posCounts[pos] += weight;
        }
      } else if (isGoalie) {
        posCounts.G += 1;
      }

      // Category aggregation
      for (const stat of player.playerStats) {
        const name = stat.statName.toLowerCase();
        const val = stat.value;
        if (!isGoalie) {
          if (name.includes("goal") && !name.includes("against")) catTotals.G += val;
          if (name.includes("assist")) catTotals.A += val;
          if (name.includes("point") && !name.includes("power") && !name.includes("short")) catTotals.P += val;
          if (name.includes("plus/minus") || name.includes("+/-")) catTotals.plusMinus += val;
          if (name.includes("penalty")) catTotals.PIM += val;
          if (name.includes("power play") || name.includes("powerplay")) catTotals.PPP += val;
          if (name.includes("shorthanded") || name.includes("short handed")) catTotals.SHP += val;
          if (name.includes("game-winning") || name.includes("game winning")) catTotals.GWG += val;
          if (name.includes("shot") && !name.includes("shootout")) catTotals.SOG += val;
          if (name.includes("faceoff")) catTotals.FW += val;
          if (name.includes("hit")) catTotals.HIT += val;
          if (name.includes("block")) catTotals.BLK += val;
        } else {
          if (name.includes("win")) catTotals.W += val;
          if (name.includes("goals against average") || name === "gaa") catTotals.GAA += val;
          if (name.includes("save") && !name.includes("%") && !name.includes("percentage")) catTotals.SV += val;
          if (name.includes("save %") || name.includes("save percentage")) catTotals.SVPct += val;
          if (name.includes("shutout")) catTotals.SHO += val;
        }
      }
    }

    teamCategoryTotals.set(team.id, catTotals);
    teamPositionCounts.set(team.id, posCounts);
  }

  // Calculate league averages and std devs for each category
  const leagueCatStats: Record<string, { mean: number; stdDev: number }> = {};
  const catNames = [
    "G", "A", "P", "plusMinus", "PIM", "PPP", "SHP", "GWG", "SOG", "FW", "HIT", "BLK",
    "W", "GAA", "SV", "SVPct", "SHO"
  ];
  
  for (const cat of catNames) {
    const values = Array.from(teamCategoryTotals.values()).map(t => t[cat]);
    leagueCatStats[cat] = calculateStats(values);
  }

  // Calculate league average positions
  const leagueAvgPos: Record<Position, number> = { C: 0, LW: 0, RW: 0, D: 0, G: 0 };
  for (const pos of ["C", "LW", "RW", "D", "G"] as Position[]) {
    const values = Array.from(teamPositionCounts.values()).map(t => t[pos]);
    leagueAvgPos[pos] = values.reduce((s, v) => s + v, 0) / values.length;
  }

  console.log("[Team Profile] League averages calculated");

  // =========================================================================
  // STEP 2: Build individual team profiles
  // =========================================================================

  const profiles: TeamProfile[] = [];

  for (const team of teams) {
    const catTotals = teamCategoryTotals.get(team.id)!;
    const posCounts = teamPositionCounts.get(team.id)!;

    // Calculate z-scores for each category
    const categories: any = {};
    for (const cat of catNames) {
      const stats = leagueCatStats[cat];
      categories[cat] = calculateZScore(catTotals[cat], stats.mean, stats.stdDev);
    }

    // Calculate flex skaters and position surplus
    let flexSkaters = 0;
    for (const entry of team.rosterEntries) {
      const positions = parsePositions(entry.player.positions);
      if (!positions.includes("G") && positions.length > 1) {
        flexSkaters++;
      }
    }

    const positions: any = {};
    for (const pos of ["C", "LW", "RW", "D", "G"] as Position[]) {
      const flexBonus = pos !== "G" ? 0.1 * flexSkaters : 0;
      positions[pos] = {
        count: posCounts[pos],
        surplusScore: posCounts[pos] - leagueAvgPos[pos] + flexBonus
      };
    }

    // Identify keeper state
    const keepers = { expiring: [] as string[], fresh: [] as string[], elite: [] as string[] };
    
    for (const entry of team.rosterEntries) {
      if (!entry.isKeeper) continue;
      
      const playerId = entry.player.id;
      const baseValue = entry.player.playerValues[0]?.score ?? 0;
      
      let keeperValue = baseValue;
      if (entry.originalDraftRound && entry.yearsRemaining !== null) {
        const draftRoundAvg = pickValueMap.get(entry.originalDraftRound) ?? 100;
        const bonus = calculateKeeperBonus(baseValue, entry.originalDraftRound, draftRoundAvg, entry.yearsRemaining);
        keeperValue = baseValue + bonus;
      }
      
      if (entry.yearsRemaining === 1) keepers.expiring.push(playerId);
      if (entry.yearsRemaining && entry.yearsRemaining >= 2) keepers.fresh.push(playerId);
      if (keeperValue >= 160) keepers.elite.push(playerId);
    }

    profiles.push({
      teamId: team.id,
      teamName: team.name,
      managerId: team.yahooManagerId,
      positions,
      flexSkaters,
      categories,
      keepers,
      rosterPlayerIds: team.rosterEntries.map(e => e.player.id),
      lastUpdated: new Date().toISOString(),
    });
  }

  console.log(`[Team Profile] Built ${profiles.length} profiles`);
  return profiles;
}

// ============================================================================
// STORAGE
// ============================================================================

export async function storeTeamProfiles(leagueId: string, profiles: TeamProfile[]): Promise<void> {
  console.log(`[Team Profile] Storing ${profiles.length} profiles`);

  for (const profile of profiles) {
    await prisma.teamProfile.upsert({
      where: { teamId: profile.teamId },
      update: {
        profileData: profile as any,
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

  console.log("[Team Profile] Profiles stored");
}

export async function loadTeamProfiles(leagueId: string): Promise<TeamProfile[]> {
  const records = await prisma.teamProfile.findMany({
    where: { leagueId },
  });

  return records.map(r => r.profileData as any as TeamProfile);
}
