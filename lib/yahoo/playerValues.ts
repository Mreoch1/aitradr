/**
 * Player value calculation using z-scores to mirror Yahoo Fantasy rankings.
 * 
 * This approach treats each category as equally important (like Yahoo H2H categories)
 * and calculates standardized scores (z-scores) for each stat.
 */

import prisma from "@/lib/prisma";

// ===== TUNABLE CONSTANTS =====

// Games started threshold for full reliability (5 games = 100% reliable)
// Lower baseline recognizes early-season breakouts while still favoring volume
const BASELINE_GS = 5;

// Optional scaling factor to balance goalies vs skaters
const GOALIE_SCALING = 1.0; // Adjust if goalies still seem over/undervalued

// ===== TYPES =====

interface StatData {
  playerId: string;
  playerName: string;
  stats: Map<string, number>;
}

interface ZScoreStats {
  mean: number;
  stdDev: number;
}

// ===== STAT CATEGORIES =====

// Skater categories (11 total)
const SKATER_CATEGORIES = [
  "goals", "assists", "plus/minus", "penalty minutes",
  "powerplay points", "shorthanded points", "game winning goals",
  "shots on goal", "faceoffs won", "hits", "blocks"
] as const;

// Goalie categories (5 total)
const GOALIE_CATEGORIES = [
  "wins", "goals against average", "saves", "save percentage", "shutouts"
] as const;

// Negative categories (lower is better)
const NEGATIVE_CATEGORIES = ["goals against average"];

// ===== UTILITY FUNCTIONS =====

/**
 * Normalize stat names for consistent lookup
 */
function normalizeStatName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ").replace(/\./g, "");
}

/**
 * Calculate mean of an array
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate standard deviation
 */
function stdDev(values: number[], meanValue: number): number {
  if (values.length === 0) return 1; // Avoid division by zero
  const variance = values.reduce((sum, v) => sum + Math.pow(v - meanValue, 2), 0) / values.length;
  return Math.sqrt(variance) || 1; // Return 1 if stdDev is 0
}

/**
 * Calculate z-score
 */
function zScore(value: number, mean: number, std: number, isNegative: boolean = false): number {
  if (std === 0) return 0;
  return isNegative 
    ? (mean - value) / std  // For negative categories (GAA), lower is better
    : (value - mean) / std; // For positive categories
}

// ===== SKATER VALUE CALCULATION =====

/**
 * Calculate skater value using z-scores across all skater categories
 */
export async function calculateSkaterValue(
  playerId: string,
  leagueId: string,
  allSkaterStats?: Map<string, StatData>
): Promise<number> {
  // If stats not provided, fetch them
  if (!allSkaterStats) {
    allSkaterStats = await fetchAllSkaterStats(leagueId);
  }
  
  const playerStats = allSkaterStats.get(playerId);
  if (!playerStats) {
    return 40; // Default for players without stats
  }
  
  // Calculate z-scores for each category
  const categoryStats = calculateCategoryStats(allSkaterStats, SKATER_CATEGORIES);
  
  let totalZScore = 0;
  
  for (const category of SKATER_CATEGORIES) {
    const playerValue = playerStats.stats.get(category) || 0;
    const catStats = categoryStats.get(category);
    
    if (!catStats) continue;
    
    const isNegative = NEGATIVE_CATEGORIES.includes(category);
    const z = zScore(playerValue, catStats.mean, catStats.stdDev, isNegative);
    
    totalZScore += z;
  }
  
  // Return raw z-score sum (can be negative for below-average players)
  // Scale to make values positive and easier to read
  return totalZScore * 10 + 100;
}

// ===== GOALIE VALUE CALCULATION =====

/**
 * Calculate goalie value using z-scores with games-started volume adjustment
 */
export async function calculateGoalieValue(
  playerId: string,
  leagueId: string,
  allGoalieStats?: Map<string, StatData>
): Promise<number> {
  // If stats not provided, fetch them
  if (!allGoalieStats) {
    allGoalieStats = await fetchAllGoalieStats(leagueId);
  }
  
  const playerStats = allGoalieStats.get(playerId);
  if (!playerStats) {
    return 40; // Default for players without stats
  }
  
  // Calculate z-scores for each category
  const categoryStats = calculateCategoryStats(allGoalieStats, GOALIE_CATEGORIES);
  
  let totalZScore = 0;
  
  for (const category of GOALIE_CATEGORIES) {
    const playerValue = playerStats.stats.get(category) || 0;
    const catStats = categoryStats.get(category);
    
    if (!catStats) continue;
    
    const isNegative = NEGATIVE_CATEGORIES.includes(category);
    const z = zScore(playerValue, catStats.mean, catStats.stdDev, isNegative);
    
    totalZScore += z;
  }
  
  // Apply games-started volume adjustment with soft curve
  // sqrt(min(1, GS/BASELINE)) - smoother than linear, prevents crushing breakout goalies
  const gamesStarted = playerStats.stats.get("games started") || 0;
  const gsFactor = Math.sqrt(Math.min(1.0, gamesStarted / BASELINE_GS));
  
  // Scale to make values positive and easier to read
  const baseValue = totalZScore * 10 + 100;
  
  // Apply volume factor and optional scaling
  return baseValue * gsFactor * GOALIE_SCALING;
}

// ===== HELPER FUNCTIONS =====

/**
 * Fetch all skater stats for a league
 */
async function fetchAllSkaterStats(leagueId: string): Promise<Map<string, StatData>> {
  const players = await prisma.player.findMany({
    where: {
      primaryPosition: { not: "G" },
      playerStats: {
        some: { leagueId },
      },
    },
    include: {
      playerStats: {
        where: { leagueId },
      },
    },
  });
  
  const statsMap = new Map<string, StatData>();
  
  for (const player of players) {
    const statMap = new Map<string, number>();
    
    for (const stat of player.playerStats) {
      const normalized = normalizeStatName(stat.statName);
      statMap.set(normalized, stat.value);
    }
    
    statsMap.set(player.id, {
      playerId: player.id,
      playerName: player.name,
      stats: statMap,
    });
  }
  
  return statsMap;
}

/**
 * Fetch all goalie stats for a league
 */
async function fetchAllGoalieStats(leagueId: string): Promise<Map<string, StatData>> {
  const goalies = await prisma.player.findMany({
    where: {
      primaryPosition: "G",
      playerStats: {
        some: { leagueId },
      },
    },
    include: {
      playerStats: {
        where: { leagueId },
      },
    },
  });
  
  const statsMap = new Map<string, StatData>();
  
  for (const goalie of goalies) {
    const statMap = new Map<string, number>();
    
    for (const stat of goalie.playerStats) {
      const normalized = normalizeStatName(stat.statName);
      statMap.set(normalized, stat.value);
    }
    
    statsMap.set(goalie.id, {
      playerId: goalie.id,
      playerName: goalie.name,
      stats: statMap,
    });
  }
  
  return statsMap;
}

/**
 * Calculate mean and standard deviation for each category
 */
function calculateCategoryStats(
  allPlayerStats: Map<string, StatData>,
  categories: readonly string[]
): Map<string, ZScoreStats> {
  const categoryStats = new Map<string, ZScoreStats>();
  
  for (const category of categories) {
    const values: number[] = [];
    
    for (const playerData of allPlayerStats.values()) {
      const value = playerData.stats.get(category);
      if (value !== undefined && value !== null) {
        values.push(value);
      }
    }
    
    if (values.length > 0) {
      const meanVal = mean(values);
      const stdDevVal = stdDev(values, meanVal);
      
      categoryStats.set(category, {
        mean: meanVal,
        stdDev: stdDevVal,
      });
    }
  }
  
  return categoryStats;
}

// ===== MAIN CALCULATION FUNCTION =====

/**
 * Calculate and store player value for a league.
 * Automatically detects if player is a goalie or skater.
 */
export async function calculateAndStorePlayerValue(
  playerId: string,
  leagueId: string,
  allSkaterStats?: Map<string, StatData>,
  allGoalieStats?: Map<string, StatData>
): Promise<number> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  let score: number;
  
  if (player.primaryPosition === "G") {
    score = await calculateGoalieValue(playerId, leagueId, allGoalieStats);
  } else {
    score = await calculateSkaterValue(playerId, leagueId, allSkaterStats);
  }

  // Store value
  await prisma.playerValue.upsert({
    where: {
      playerId_leagueId: {
        playerId,
        leagueId,
      },
    },
    update: {
      score,
      breakdown: JSON.stringify({ method: "z-score", position: player.primaryPosition }),
    },
    create: {
      playerId,
      leagueId,
      score,
      breakdown: JSON.stringify({ method: "z-score", position: player.primaryPosition }),
    },
  });

  return score;
}

/**
 * Ensure all players in a league have calculated values.
 * This is a batch operation that recalculates all values using z-scores.
 */
export async function ensureLeaguePlayerValues(leagueId: string): Promise<void> {
  console.log(`[PlayerValues] Calculating z-score based values for league`);
  
  // Fetch all stats once for efficiency
  const allSkaterStats = await fetchAllSkaterStats(leagueId);
  const allGoalieStats = await fetchAllGoalieStats(leagueId);
  
  console.log(`[PlayerValues] Found ${allSkaterStats.size} skaters, ${allGoalieStats.size} goalies`);

  // Calculate skater values
  for (const playerId of allSkaterStats.keys()) {
    await calculateAndStorePlayerValue(playerId, leagueId, allSkaterStats, allGoalieStats);
  }
  
  // Calculate goalie values
  for (const playerId of allGoalieStats.keys()) {
    await calculateAndStorePlayerValue(playerId, leagueId, allSkaterStats, allGoalieStats);
  }
  
  console.log(`[PlayerValues] All player values calculated, now calculating draft pick values`);
  
  // Calculate draft pick values based on player values
  await calculateDraftPickValues(leagueId);
  
  // Debug: Print top players for verification
  await printTopPlayers(leagueId);
}

/**
 * Get player value for a specific player in a league.
 * Returns 0 if no value is calculated yet.
 */
export async function getPlayerValue(
  playerId: string,
  leagueId: string
): Promise<number> {
  const playerValue = await prisma.playerValue.findUnique({
    where: {
      playerId_leagueId: {
        playerId,
        leagueId,
      },
    },
  });

  return playerValue?.score ?? 0;
}

/**
 * Calculate draft pick values dynamically based on actual player values.
 */
export async function calculateDraftPickValues(leagueId: string): Promise<void> {
  console.log(`[DraftPicks] Calculating dynamic draft pick values for league`);
  
  const playerValues = await prisma.playerValue.findMany({
    where: { leagueId },
    orderBy: { score: 'desc' },
    select: { score: true },
  });
  
  if (playerValues.length === 0) {
    console.warn(`[DraftPicks] No player values found for league`);
    return;
  }
  
  const totalPlayers = playerValues.length;
  const playersPerRound = Math.max(Math.floor(totalPlayers / 16), 1);
  
  for (let round = 1; round <= 16; round++) {
    const startIdx = (round - 1) * playersPerRound;
    const endIdx = Math.min(round * playersPerRound, totalPlayers);
    
    const roundPlayers = playerValues.slice(startIdx, endIdx);
    
    if (roundPlayers.length === 0) {
      const score = Math.max(5, 85 - (round * 5));
      await prisma.draftPickValue.upsert({
        where: { leagueId_round: { leagueId, round } },
        update: { score },
        create: { leagueId, round, score },
      });
      continue;
    }
    
    const avgValue = roundPlayers.reduce((sum, p) => sum + p.score, 0) / roundPlayers.length;
    
    await prisma.draftPickValue.upsert({
      where: { leagueId_round: { leagueId, round } },
      update: { score: avgValue },
      create: { leagueId, round, score: avgValue },
    });
    
    console.log(`[DraftPicks] Round ${round}: ${avgValue.toFixed(1)}`);
  }
}

/**
 * Debug function: Print top players to verify rankings match Yahoo
 */
async function printTopPlayers(leagueId: string): Promise<void> {
  console.log("\n===== TOP 15 SKATERS =====");
  
  const topSkaters = await prisma.playerValue.findMany({
    where: {
      leagueId,
      player: { primaryPosition: { not: "G" } },
    },
    include: {
      player: { select: { name: true, primaryPosition: true, teamAbbr: true } },
    },
    orderBy: { score: 'desc' },
    take: 15,
  });
  
  topSkaters.forEach((pv, i) => {
    console.log(`${i + 1}. ${pv.player.name} (${pv.player.primaryPosition}, ${pv.player.teamAbbr}) - Value: ${pv.score.toFixed(1)}`);
  });
  
  console.log("\n===== TOP 15 GOALIES =====");
  
  const topGoalies = await prisma.playerValue.findMany({
    where: {
      leagueId,
      player: { primaryPosition: "G" },
    },
    include: {
      player: { select: { name: true, teamAbbr: true } },
    },
    orderBy: { score: 'desc' },
    take: 15,
  });
  
  topGoalies.forEach((pv, i) => {
    console.log(`${i + 1}. ${pv.player.name} (G, ${pv.player.teamAbbr}) - Value: ${pv.score.toFixed(1)}`);
  });
  
  console.log("\n");
}
