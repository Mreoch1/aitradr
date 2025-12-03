/**
 * Category-based trade analysis for H2H categories leagues.
 * Analyzes teams by their statistical strengths/weaknesses, not just positions.
 */

import type { TeamForAI, PlayerForAI } from "./tradeAnalyzer";

// Skater categories (11 total)
const SKATER_STATS = [
  "goals", "assists", "plusMinus", "pim", "ppp", "shp", "gwg", "shots", "faceoffs", "hits", "blocks"
] as const;

// Goalie categories (5 total)
const GOALIE_STATS = ["wins", "saves", "savePct", "shutouts", "gaa"] as const;

type SkaterStat = typeof SKATER_STATS[number];
type GoalieStat = typeof GOALIE_STATS[number];
type AnyStat = SkaterStat | GoalieStat;

export interface CategoryProfile {
  teamName: string;
  categoryScores: Map<AnyStat, number>; // Ratio vs league average (1.0 = average)
  strengths: AnyStat[]; // Stats where score > 1.15
  weaknesses: AnyStat[]; // Stats where score < 0.90
}

export interface PlayerCategoryContribution {
  playerId: string;
  name: string;
  contributions: Map<AnyStat, number>; // Actual stat totals
  primaryContributions: AnyStat[]; // Top 3 stats this player provides
}

/**
 * Extract stat value from player stats object
 */
function getStatValue(player: PlayerForAI, statKey: AnyStat): number {
  const stats = player.stats;
  
  switch (statKey) {
    case "goals": return stats.goals || 0;
    case "assists": return stats.assists || 0;
    case "plusMinus": return stats.plusMinus || 0;
    case "pim": return stats.pim || 0;
    case "ppp": return stats.ppp || 0;
    case "shp": return 0; // Not in current stats object
    case "gwg": return 0; // Not in current stats object
    case "shots": return 0; // Not in current stats object
    case "faceoffs": return 0; // Not in current stats object
    case "hits": return 0; // Not in current stats object
    case "blocks": return 0; // Not in current stats object
    case "wins": return stats.wins || 0;
    case "saves": return stats.saves || 0;
    case "savePct": return stats.savePct || 0;
    case "shutouts": return stats.shutouts || 0;
    case "gaa": return 0; // Not in current stats object
    default: return 0;
  }
}

/**
 * Calculate league-wide averages for each category
 */
export function calculateLeagueAverages(allTeams: TeamForAI[]): Map<AnyStat, number> {
  const leagueAverages = new Map<AnyStat, number>();
  
  // Calculate totals and averages per team
  const allStats = [...SKATER_STATS, ...GOALIE_STATS];
  
  for (const stat of allStats) {
    let totalValue = 0;
    let teamCount = 0;
    
    for (const team of allTeams) {
      let teamTotal = 0;
      
      for (const player of team.roster) {
        teamTotal += getStatValue(player, stat);
      }
      
      totalValue += teamTotal;
      teamCount++;
    }
    
    const avgPerTeam = teamCount > 0 ? totalValue / teamCount : 0;
    leagueAverages.set(stat, avgPerTeam);
  }
  
  return leagueAverages;
}

/**
 * Build category profile for a team
 */
export function buildCategoryProfile(
  team: TeamForAI,
  leagueAverages: Map<AnyStat, number>
): CategoryProfile {
  const categoryScores = new Map<AnyStat, number>();
  const strengths: AnyStat[] = [];
  const weaknesses: AnyStat[] = [];
  
  const allStats = [...SKATER_STATS, ...GOALIE_STATS];
  
  for (const stat of allStats) {
    // Calculate team total for this stat
    let teamTotal = 0;
    for (const player of team.roster) {
      teamTotal += getStatValue(player, stat);
    }
    
    const leagueAvg = leagueAverages.get(stat) || 1;
    const score = leagueAvg > 0 ? teamTotal / leagueAvg : 1.0;
    
    categoryScores.set(stat, score);
    
    if (score > 1.15) strengths.push(stat);
    if (score < 0.90) weaknesses.push(stat);
  }
  
  return {
    teamName: team.name,
    categoryScores,
    strengths,
    weaknesses,
  };
}

/**
 * Calculate player's category contributions
 */
export function getPlayerCategoryContribution(player: PlayerForAI): PlayerCategoryContribution {
  const contributions = new Map<AnyStat, number>();
  const allStats = [...SKATER_STATS, ...GOALIE_STATS];
  
  for (const stat of allStats) {
    const value = getStatValue(player, stat);
    if (value > 0) {
      contributions.set(stat, value);
    }
  }
  
  // Find top 3 contributions (by absolute value)
  const sorted = Array.from(contributions.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  
  return {
    playerId: player.name, // Using name as ID for simplicity
    name: player.name,
    contributions,
    primaryContributions: sorted.map(([stat]) => stat),
  };
}

/**
 * Calculate category gain from a trade
 * Returns a score representing how much this trade improves weak categories
 */
export function calculateCategoryGain(
  myProfile: CategoryProfile,
  playersOut: PlayerForAI[],
  playersIn: PlayerForAI[]
): { gain: number; improvements: Map<AnyStat, number> } {
  const improvements = new Map<AnyStat, number>();
  let totalGain = 0;
  
  for (const stat of myProfile.weaknesses) {
    // Calculate net change in this weak stat
    const lost = playersOut.reduce((sum, p) => sum + getStatValue(p, stat), 0);
    const gained = playersIn.reduce((sum, p) => sum + getStatValue(p, stat), 0);
    const netChange = gained - lost;
    
    if (netChange > 0) {
      // Weight improvements to weak categories heavily
      const improvement = netChange * 2.0;
      improvements.set(stat, netChange);
      totalGain += improvement;
    }
  }
  
  // Also penalize if we lose strength in our strong categories
  for (const stat of myProfile.strengths) {
    const lost = playersOut.reduce((sum, p) => sum + getStatValue(p, stat), 0);
    const gained = playersIn.reduce((sum, p) => sum + getStatValue(p, stat), 0);
    const netChange = gained - lost;
    
    if (netChange < 0) {
      // Small penalty for losing strength
      totalGain += netChange * 0.5;
    }
  }
  
  return { gain: totalGain, improvements };
}

/**
 * Calculate final trade score combining value and category gains
 */
export function calculateTradeScore(
  valueGain: number,
  categoryGain: number
): number {
  // 60% value, 40% category improvement
  return valueGain * 0.6 + categoryGain * 0.4;
}

