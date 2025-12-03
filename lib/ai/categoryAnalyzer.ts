/**
 * Category-based trade analysis for H2H categories leagues.
 * Analyzes teams by their statistical strengths/weaknesses, not just positions.
 */

import type { TeamForAI, PlayerForAI } from "./tradeAnalyzer";

// Skater categories (11 total) - MUST match Yahoo API stat names (normalized)
const SKATER_STATS = [
  "goals",
  "assists", 
  "plus/minus",
  "penalty minutes",
  "powerplay points",      // Yahoo: "Powerplay Points"
  "shorthanded points",    // Yahoo: "Shorthanded Points"
  "game-winning goals",    // Yahoo: "Game-Winning Goals"
  "shots on goal",
  "faceoffs won",
  "hits",
  "blocks"                 // Yahoo: "Blocks"
] as const;

// Goalie categories (5 total) - MUST match Yahoo API stat names
const GOALIE_STATS = [
  "wins",
  "goals against average",
  "saves",
  "save percentage",
  "shutouts"
] as const;

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
 * Normalize stat name for consistent matching (same as playerValues.ts)
 */
function normalizeStatName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ").replace(/\./g, "");
}

/**
 * Extract stat value from player's raw stats array
 * PlayerForAI.rawStats is Array<{ statName: string, value: number }>
 */
function getStatValue(player: PlayerForAI, statKey: AnyStat): number {
  if (!player.rawStats || !Array.isArray(player.rawStats)) {
    return 0;
  }
  
  // Normalize both the search key and stat names for matching
  const normalizedKey = normalizeStatName(statKey);
  
  // Find the stat by normalized name
  const stat = player.rawStats.find(s => 
    normalizeStatName(s.statName) === normalizedKey
  );
  
  return stat?.value || 0;
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
 * Normalize category gain to prevent unbounded compensation logic
 * Raw category deltas can be arbitrarily large and meaningless
 */
function normalizedCategoryGain(rawGain: number): number {
  // Clamp to reasonable range: -12 to +12
  return Math.max(-12, Math.min(12, rawGain));
}

/**
 * Calculate final trade score combining value and category gains
 * Heavily weights category improvement over pure value (H2H reality)
 */
export function calculateTradeScore(
  valueGain: number,
  rawCategoryGain: number
): number {
  // FIX #1: Normalize category gain to prevent fake compensation
  const categoryGain = normalizedCategoryGain(rawCategoryGain);
  
  // Base score: value delta + weighted category gain (reduced from 2.5 to 2.0)
  let score = (valueGain * 1.0) + (categoryGain * 2.0);
  
  // Sidegrade penalty: trades with minimal value difference are pointless
  // unless they have strong category justification
  if (Math.abs(valueGain) < 6 && categoryGain < 10) {
    score -= 15; // Heavy penalty for cosmetic swaps
  }
  
  return score;
}

