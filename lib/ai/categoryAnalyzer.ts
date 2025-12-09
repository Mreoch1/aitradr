/**
 * Category-based trade analysis for H2H categories leagues.
 * Analyzes teams by their statistical strengths/weaknesses, not just positions.
 */

import type { TeamForAI, PlayerForAI } from "./tradeAnalyzer";

// Skater categories (12 total - Yahoo format) - MUST match Yahoo API stat names (normalized)
// Yahoo counts G, A, and P as SEPARATE categories
const SKATER_STATS = [
  "goals",
  "assists",
  "points",                // 12th category - Yahoo counts this separately from G+A
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
export type AnyStat = SkaterStat | GoalieStat;

/**
 * Category volatility factors for strategic priority weighting
 * Higher = more volatile/unpredictable (less reliable to chase)
 * Lower = more stable/grindable (more reliable to fix)
 */
const CATEGORY_VOLATILITY: Record<AnyStat, number> = {
  // Goalie categories (highly volatile)
  "shutouts": 1.4,
  "save percentage": 1.3,
  "wins": 1.1,
  "goals against average": 1.2,
  "saves": 1.0,
  
  // Skater categories
  "goals": 1.0,
  "assists": 0.95,
  "points": 0.95,
  "plus/minus": 1.2,
  "penalty minutes": 0.9,
  "powerplay points": 1.05,
  "shorthanded points": 1.3,
  "game-winning goals": 1.35,
  "shots on goal": 0.85,
  "faceoffs won": 0.7,
  "hits": 0.8,
  "blocks": 0.8,
} as const;

/**
 * Calculate strategic priority for a category based on z-score and volatility
 * Formula: priority = abs(zScore) × categoryVolatilityFactor × seasonWeight
 */
export function calculateCategoryPriority(
  zScore: number,
  category: AnyStat,
  seasonProgress: number = 0.5 // 0.0 = early season, 1.0 = late season
): number {
  const volatilityFactor = CATEGORY_VOLATILITY[category] || 1.0;
  // Season weight: early season = less urgency, late season = more urgency
  const seasonWeight = 0.8 + (seasonProgress * 0.4); // 0.8 to 1.2
  return Math.abs(zScore) * volatilityFactor * seasonWeight;
}

export interface CategoryProfile {
  teamName: string;
  categoryScores: Map<AnyStat, number>; // Ratio vs league average (1.0 = average)
  categoryZScores: Map<AnyStat, number>; // Z-scores for each category
  categoryPriorities: Map<AnyStat, number>; // Strategic priority index
  strengths: AnyStat[]; // Stats where score > 1.15
  weaknesses: AnyStat[]; // Stats where score < 0.90, sorted by priority
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
 * Exported for use in trade analyzer anti-garbage filtering
 */
export function getStatValue(player: PlayerForAI, statKey: AnyStat): number {
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
 * Calculate z-scores for all categories across teams
 */
function calculateCategoryZScores(allTeams: TeamForAI[], leagueAverages: Map<AnyStat, number>): Map<AnyStat, { mean: number; stdDev: number }> {
  const categoryStats = new Map<AnyStat, number[]>();
  const allStats = [...SKATER_STATS, ...GOALIE_STATS];
  
  // Collect all team totals for each category
  for (const stat of allStats) {
    const teamTotals: number[] = [];
    for (const team of allTeams) {
      let teamTotal = 0;
      for (const player of team.roster) {
        teamTotal += getStatValue(player, stat);
      }
      teamTotals.push(teamTotal);
    }
    categoryStats.set(stat, teamTotals);
  }
  
  // Calculate mean and stdDev for each category
  const zScoreStats = new Map<AnyStat, { mean: number; stdDev: number }>();
  for (const [stat, values] of categoryStats.entries()) {
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance) || 1;
    zScoreStats.set(stat, { mean, stdDev });
  }
  
  return zScoreStats;
}

/**
 * Build category profile for a team with strategic priority weighting
 */
export function buildCategoryProfile(
  team: TeamForAI,
  leagueAverages: Map<AnyStat, number>,
  allTeams?: TeamForAI[], // Optional: needed for z-score calculation
  seasonProgress: number = 0.5
): CategoryProfile {
  const categoryScores = new Map<AnyStat, number>();
  const categoryZScores = new Map<AnyStat, number>();
  const categoryPriorities = new Map<AnyStat, number>();
  const strengths: AnyStat[] = [];
  const weaknesses: AnyStat[] = [];
  
  const allStats = [...SKATER_STATS, ...GOALIE_STATS];
  
  // Calculate z-score stats if we have all teams data
  let zScoreStats: Map<AnyStat, { mean: number; stdDev: number }> | null = null;
  if (allTeams && allTeams.length > 0) {
    zScoreStats = calculateCategoryZScores(allTeams, leagueAverages);
  }
  
  for (const stat of allStats) {
    // Calculate team total for this stat
    let teamTotal = 0;
    for (const player of team.roster) {
      teamTotal += getStatValue(player, stat);
    }
    
    const leagueAvg = leagueAverages.get(stat) || 1;
    const score = leagueAvg > 0 ? teamTotal / leagueAvg : 1.0;
    categoryScores.set(stat, score);
    
    // Calculate z-score if we have the stats
    let zScore = 0;
    if (zScoreStats) {
      const stats = zScoreStats.get(stat);
      if (stats) {
        zScore = (teamTotal - stats.mean) / stats.stdDev;
        categoryZScores.set(stat, zScore);
        
        // Calculate strategic priority
        const priority = calculateCategoryPriority(zScore, stat, seasonProgress);
        categoryPriorities.set(stat, priority);
      }
    }
    
    // Strength/weakness thresholds per spec
    if (score > 1.15) strengths.push(stat);  // Strong category
    if (score < 0.85) weaknesses.push(stat); // Weak category (tightened from 0.90)
  }
  
  // Sort weaknesses by strategic priority (highest priority first)
  weaknesses.sort((a, b) => {
    const priorityA = categoryPriorities.get(a) || 0;
    const priorityB = categoryPriorities.get(b) || 0;
    return priorityB - priorityA; // Descending order
  });
  
  return {
    teamName: team.name,
    categoryScores,
    categoryZScores,
    categoryPriorities,
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
 * Calculate category gain from a trade with strategic priority weighting
 * Returns a score representing how much this trade improves weak categories
 */
export function calculateCategoryGain(
  myProfile: CategoryProfile,
  playersOut: PlayerForAI[],
  playersIn: PlayerForAI[]
): { gain: number; improvements: Map<AnyStat, number>; categorySwings: Map<AnyStat, number> } {
  const improvements = new Map<AnyStat, number>();
  const categorySwings = new Map<AnyStat, number>(); // Net z-score change per category
  let totalGain = 0;
  
  // Calculate net change for ALL categories (not just weaknesses)
  const allStats = [...SKATER_STATS, ...GOALIE_STATS];
  for (const stat of allStats) {
    const lost = playersOut.reduce((sum, p) => sum + getStatValue(p, stat), 0);
    const gained = playersIn.reduce((sum, p) => sum + getStatValue(p, stat), 0);
    const netChange = gained - lost;
    
    // Calculate z-score swing (approximate based on league averages)
    // This is a simplified calculation - in practice, you'd need league stdDev
    const currentZScore = myProfile.categoryZScores.get(stat) || 0;
    // For now, use raw change as proxy for z-score change
    categorySwings.set(stat, netChange);
  }
  
  // Weight improvements to weak categories by strategic priority
  for (const stat of myProfile.weaknesses) {
    const netChange = categorySwings.get(stat) || 0;
    
    if (netChange > 0) {
      // Weight by strategic priority (higher priority = more weight)
      const priority = myProfile.categoryPriorities.get(stat) || 1.0;
      // Invert volatility: stable categories (low volatility) get higher weight
      const volatilityFactor = CATEGORY_VOLATILITY[stat] || 1.0;
      const stabilityWeight = 1.0 / volatilityFactor; // Lower volatility = higher weight
      
      const improvement = netChange * stabilityWeight * 2.0;
      improvements.set(stat, netChange);
      totalGain += improvement;
    }
  }
  
  // Also penalize if we lose strength in our strong categories
  for (const stat of myProfile.strengths) {
    const netChange = categorySwings.get(stat) || 0;
    
    if (netChange < 0) {
      // Small penalty for losing strength
      totalGain += netChange * 0.5;
    }
  }
  
  return { gain: totalGain, improvements, categorySwings };
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

