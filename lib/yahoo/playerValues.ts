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

// Value range constraints - prevent runaway scores
const SKATER_VALUE_MIN = 45;
const SKATER_VALUE_MAX = 165;
const GOALIE_VALUE_MIN = 50;
const GOALIE_VALUE_MAX = 155;

// Defense dampening - defensemen don't trade like forwards
const DEFENSE_MULTIPLIER = 0.92; // D positions worth ~8% less than equivalent forwards

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

// Weighted buckets - reflects fantasy trade reality, not pure math equality
// MUST match Yahoo's stat names after normalization
const SCORING_CORE = ["goals", "assists", "powerplay points", "shots on goal"] as const;
const SUPPORT_STATS = ["plus/minus", "shorthanded points", "game-winning goals"] as const;
const GRIND_STATS = ["penalty minutes", "faceoffs won", "hits", "blocks"] as const;

// All skater categories for z-score calculation
const SKATER_CATEGORIES = [
  ...SCORING_CORE,
  ...SUPPORT_STATS,
  ...GRIND_STATS,
] as const;

// Category weights - reflects fantasy market reality
const CATEGORY_WEIGHTS = {
  SCORING: 1.5,  // Goals, Assists, PPP, SOG - what managers actually trade for
  SUPPORT: 1.0,  // +/-, SHP, GWG - meaningful but not primary
  GRIND: 0.7,    // FW, PIM, HIT, BLK - valuable but not trade drivers
} as const;

// Position scarcity multipliers - reflects roster construction reality
const POSITION_MULTIPLIERS = {
  LW: 1.08,  // Wings are scarce
  RW: 1.04,  // Wings are scarce
  C: 0.96,   // Centers are plentiful
  D: 1.10,   // Good defensemen are gold
  G: 1.00,   // Already balanced via reliability curve
} as const;

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
 * Calculate skater value using WEIGHTED z-scores by bucket
 * Reflects fantasy trade reality: offense > support > grind stats
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
  
  // Get player info for position multiplier
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { primaryPosition: true, name: true }
  });
  
  // Calculate z-scores for each category
  const categoryStats = calculateCategoryStats(allSkaterStats, SKATER_CATEGORIES);
  
  let scoringZSum = 0;
  let supportZSum = 0;
  let grindZSum = 0;
  
  // Bucket 1: Scoring Core (G, A, PPP, SOG)
  for (const category of SCORING_CORE) {
    const playerValue = playerStats.stats.get(category) || 0;
    const catStats = categoryStats.get(category);
    if (catStats) {
      scoringZSum += zScore(playerValue, catStats.mean, catStats.stdDev, false);
    }
  }
  
  // Bucket 2: Support Stats (+/-, SHP, GWG)
  for (const category of SUPPORT_STATS) {
    const playerValue = playerStats.stats.get(category) || 0;
    const catStats = categoryStats.get(category);
    if (catStats) {
      const isNegative = NEGATIVE_CATEGORIES.includes(category);
      supportZSum += zScore(playerValue, catStats.mean, catStats.stdDev, isNegative);
    }
  }
  
  // Bucket 3: Grind Stats (FW, PIM, HIT, BLK)
  for (const category of GRIND_STATS) {
    const playerValue = playerStats.stats.get(category) || 0;
    const catStats = categoryStats.get(category);
    if (catStats) {
      grindZSum += zScore(playerValue, catStats.mean, catStats.stdDev, false);
    }
  }
  
  // Apply bucket weights
  const weightedScoring = scoringZSum * CATEGORY_WEIGHTS.SCORING;
  const weightedSupport = supportZSum * CATEGORY_WEIGHTS.SUPPORT;
  const weightedGrind = grindZSum * CATEGORY_WEIGHTS.GRIND;
  
  const totalWeightedZ = weightedScoring + weightedSupport + weightedGrind;
  
  // Cap grind dominance: grind contribution cannot exceed 40% of total value
  let finalWeightedZ = totalWeightedZ;
  const totalValue = Math.abs(weightedScoring) + Math.abs(weightedSupport) + Math.abs(weightedGrind);
  if (totalValue > 0) {
    const grindPercent = Math.abs(weightedGrind) / totalValue;
    if (grindPercent > 0.40) {
      const maxGrind = totalValue * 0.40;
      const clampedGrind = weightedGrind > 0 ? maxGrind : -maxGrind;
      finalWeightedZ = weightedScoring + weightedSupport + clampedGrind;
    }
  }
  
  // Base value from weighted z-scores (scaled down to prevent runaway scores)
  let value = finalWeightedZ * 8 + 100; // Reduced from 10 to 8 for tighter scaling
  
  // Get player stats for market correction rules
  const goals = playerStats.stats.get("goals") || 0;
  const assists = playerStats.stats.get("assists") || 0;
  const points = goals + assists;
  const ppp = playerStats.stats.get("powerplay points") || 0;
  
  // Position scarcity multiplier (before defense dampening)
  if (player?.primaryPosition) {
    const pos = player.primaryPosition as keyof typeof POSITION_MULTIPLIERS;
    const multiplier = POSITION_MULTIPLIERS[pos] || 1.0;
    value *= multiplier;
  }
  
  // Defense dampening: D positions don't trade like forwards
  if (player?.primaryPosition === 'D') {
    // Only apply dampening to non-elite defensemen
    // Elite D (30+ points) maintain value
    if (points < 30) {
      value *= DEFENSE_MULTIPLIER;
    }
  }
  
  // Market gravity multiplier based on scoring production
  // Reflects Yahoo trade reality: elite scorers command premium
  if (points >= 40 || goals >= 20) {
    // Top 10 tier - absolute elite
    value *= 1.12;
  } else if (points >= 30 || goals >= 15) {
    // Top 30 tier - star players
    value *= 1.08;
  } else if (points >= 22 || goals >= 10) {
    // Top 60 tier - solid contributors
    value *= 1.04;
  }
  
  // Superstar floor: Elite scorers cannot rank below depth players
  const isEliteScorer = points >= 30 || goals >= 15 || ppp >= 15;
  if (isEliteScorer) {
    value = Math.max(value, 145); // Raised from 135 to 145
  }
  
  // Hard floor for any scoring threat
  const isScorer = points >= 20 || goals >= 10;
  if (isScorer) {
    value = Math.max(value, 115);
  }
  
  // CLAMP to prevent runaway values
  value = Math.max(SKATER_VALUE_MIN, Math.min(SKATER_VALUE_MAX, value));
  
  // Reintroduce spread after clamping to create elite tier separation
  // Uses raw z-score sum to preserve ordering within elite tier
  const spreadAdjustment = (finalWeightedZ * 0.4); // Increased from 0.35 to 0.4
  value += spreadAdjustment;
  
  // Add tiny deterministic jitter based on player stats to break remaining ties
  // This prevents identical values for different elite players
  const jitterSeed = (goals * 3.7 + assists * 2.3 + ppp * 1.1) % 3.0;
  value += (jitterSeed - 1.5); // Range: -1.5 to +1.5
  
  // Re-clamp after spread (but allow slight overflow for ordering)
  value = Math.max(SKATER_VALUE_MIN, Math.min(SKATER_VALUE_MAX + 10, value));
  
  // Franchise star safeguard: prevent multi-category role players from equaling superstars
  // Stars are defined by elite offensive production, not category coverage
  const isFranchiseStar = points >= 40 || (goals >= 18 && assists >= 18);
  
  if (!isFranchiseStar && value > 158) {
    // Apply suppression to excellent-but-not-elite players
    // This prevents Suzuki/Eichel from matching MacKinnon/McDavid
    const suppression = 0.92; // 8% reduction
    value *= suppression;
  }
  
  return value;
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
  
  // Scale to make values positive and easier to read (reduced scaling)
  const baseValue = totalZScore * 8 + 100; // Reduced from 10 to 8
  
  // Apply volume factor and optional scaling
  let value = baseValue * gsFactor * GOALIE_SCALING;
  
  // CLAMP goalie values to prevent runaway scores
  value = Math.max(GOALIE_VALUE_MIN, Math.min(GOALIE_VALUE_MAX, value));
  
  // Add small spread to prevent ties at the cap
  const spreadAdjustment = (totalZScore * 0.35);
  value += spreadAdjustment;
  
  // Tiny jitter based on wins/saves to break remaining ties
  const wins = playerStats.stats.get("wins") || 0;
  const saves = playerStats.stats.get("saves") || 0;
  const jitterSeed = (wins * 2.7 + saves * 0.01) % 3.0;
  value += (jitterSeed - 1.5);
  
  // Re-clamp after spread
  value = Math.max(GOALIE_VALUE_MIN, Math.min(GOALIE_VALUE_MAX + 5, value));
  
  return value;
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
 * Uses percentile-based approach with floors to ensure sensible values.
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
      // Fallback for empty rounds
      const score = Math.max(5, 85 - (round * 5));
      await prisma.draftPickValue.upsert({
        where: { leagueId_round: { leagueId, round } },
        update: { score },
        create: { leagueId, round, score },
      });
      continue;
    }
    
    // Calculate average but apply floor based on round
    const avgValue = roundPlayers.reduce((sum, p) => sum + p.score, 0) / roundPlayers.length;
    
    // Floor values by round - late picks still have value
    let finalValue = avgValue;
    if (round >= 14) {
      // Rounds 14-16: Floor at 5-1 (bench/speculative value)
      const lateFloor = Math.max(1, 8 - (round - 14) * 3);
      finalValue = Math.max(avgValue, lateFloor);
    } else if (round >= 10) {
      // Rounds 10-13: Floor at 30 (still rosterable)
      finalValue = Math.max(avgValue, 30);
    } else if (round >= 7) {
      // Rounds 7-9: Floor at 60 (depth value)
      finalValue = Math.max(avgValue, 60);
    }
    
    await prisma.draftPickValue.upsert({
      where: { leagueId_round: { leagueId, round } },
      update: { score: finalValue },
      create: { leagueId, round, score: finalValue },
    });
    
    console.log(`[DraftPicks] Round ${round}: ${finalValue.toFixed(1)} ${avgValue !== finalValue ? `(floor applied, was ${avgValue.toFixed(1)})` : ''}`);
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
