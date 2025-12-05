/**
 * Keeper tracking system for atfh2 league
 */

export interface KeeperData {
  isKeeper: boolean;
  originalDraftRound: number;
  keeperYearIndex: number;    // 0 = first year kept, 1 = second year, 2 = third (final) year
  yearsRemaining: number;     // 3, 2, 1, or 0
  currentKeeperRound: number; // Which round they occupy this year
  keeperRoundCost: number;    // Which round pick is forfeited (accounting for escalation/trades)
}

/**
 * Tier system for keeper restrictions
 */
type KeeperTier = 'A' | 'B' | 'C';

export const TIER_RANGES = {
  A: { min: 1, max: 4 },   // Tier A: Rounds 1-4
  B: { min: 5, max: 10 },  // Tier B: Rounds 5-10
  C: { min: 11, max: 16 }, // Tier C: Rounds 11-16
} as const;

/**
 * Keeper eligibility rules for atfh2 league
 */
export const KEEPER_RULES = {
  MAX_KEEPER_YEARS: 3,        // Can keep a player for 3 years max
  MIN_KEEPER_ROUND: 2,        // Can't move into Round 1 (hard block)
  MAX_KEEPER_ROUND: 16,       // Can't keep players beyond R16
} as const;

/**
 * Determine which tier a round belongs to
 */
export function getRoundTier(round: number): KeeperTier {
  if (round >= TIER_RANGES.A.min && round <= TIER_RANGES.A.max) return 'A';
  if (round >= TIER_RANGES.B.min && round <= TIER_RANGES.B.max) return 'B';
  return 'C';
}

/**
 * Check if a keeper can be moved to a target round (respects tier restrictions)
 */
export function canMoveToRound(originalRound: number, targetRound: number): boolean {
  // Hard block: cannot move into Round 1
  if (targetRound === 1) return false;
  
  const originalTier = getRoundTier(originalRound);
  const targetTier = getRoundTier(targetRound);
  
  // Tier A players can only stay in Tier A
  if (originalTier === 'A' && targetTier !== 'A') return false;
  
  // Tier B players can move within B, but not into A
  if (originalTier === 'B' && targetTier === 'A') return false;
  if (originalTier === 'B' && targetTier === 'C') return false;
  
  // Tier C players must stay in C
  if (originalTier === 'C' && targetTier !== 'C') return false;
  
  return true;
}

/**
 * Calculate keeper round (accounting for traded picks and tier restrictions)
 * @param originalRound - Round player was originally drafted
 * @param ownedPicks - Array of round numbers the team currently owns
 * @returns The round this keeper occupies, or null if unkeepable
 */
export function calculateKeeperRound(
  originalRound: number,
  ownedPicks: number[]
): number | null {
  // Check if team owns the original round
  if (ownedPicks.includes(originalRound)) {
    return originalRound;
  }
  
  // Find nearest earlier owned pick that respects tier restrictions
  const earlierPicks = ownedPicks
    .filter(pick => pick < originalRound && pick >= KEEPER_RULES.MIN_KEEPER_ROUND)
    .filter(pick => canMoveToRound(originalRound, pick))
    .sort((a, b) => b - a); // Descending (closest to original)
  
  if (earlierPicks.length > 0) {
    return earlierPicks[0];
  }
  
  // No valid round available - keeper is unkeepable
  return null;
}

/**
 * Calculate years remaining
 * @param keeperYearIndex - 0 = first year kept, 1 = second year kept, 2 = third year kept (final)
 * @returns Years remaining (2, 1, or 0 after current year)
 * 
 * Example: If keeperYearIndex = 1 (in 2nd year of keeping), yearsRemaining = 1 (can keep once more)
 */
export function calculateYearsRemaining(keeperYearIndex: number): number {
  // Years remaining = total allowed - (current year)
  // If in year 2 (index 1), they're using year 2, so 1 year left
  const currentYear = keeperYearIndex + 1;
  return Math.max(0, KEEPER_RULES.MAX_KEEPER_YEARS - currentYear);
}

/**
 * Calculate keeper value multiplier based on value retention and time remaining
 * @param originalRoundAvg - Average value in original draft round
 * @param keeperRoundCost - Average value at keeper round cost
 * @param yearsRemaining - Years left to keep (1, 2, or 3)
 * @returns Multiplier between 1.0 and 1.9
 */
export function calculateKeeperMultiplier(
  originalRoundAvg: number,
  keeperRoundCost: number,
  yearsRemaining: number
): number {
  if (keeperRoundCost <= 0 || originalRoundAvg <= 0) return 1.0;
  
  const valueRetention = originalRoundAvg / keeperRoundCost;
  const timeFactor = yearsRemaining / KEEPER_RULES.MAX_KEEPER_YEARS;
  
  // Multiplier = 1.0 + (retention - 1) × time factor
  const multiplier = 1.0 + ((valueRetention - 1) * timeFactor);
  
  // Clamp between 1.0 and 1.9 (max 90% bonus)
  return Math.max(1.0, Math.min(1.9, multiplier));
}

/**
 * DEPRECATED: Expiration penalty removed
 * Keeper decay is already handled via bonus scaling: keeperBonus = surplus × (yearsRemaining / 3)
 * No additional penalty needed - last year keepers are still valuable assets
 */
export function applyExpirationPenalty(value: number, yearsRemaining: number): number {
  // No expiration penalty - return value as-is
  return value;
}


/**
 * Round cost table - rough value curve for keeper surplus calculation
 * Represents average expected value at each draft position
 */
const ROUND_COST_TABLE: Record<number, number> = {
  1: 165,
  2: 155,
  3: 145,
  4: 140,
  5: 135,
  6: 130,
  7: 125,
  8: 120,
  9: 110,
  10: 100,
  11: 90,
  12: 80,
  13: 75,
  14: 70,
  15: 65,
  16: 60,
};

function getRoundCost(round: number): number {
  return ROUND_COST_TABLE[round] ?? 80;
}

function getKeeperTier(round: number): 'A' | 'B' | 'C' {
  if (round <= 4) return 'A';   // Rounds 1-4
  if (round <= 10) return 'B';  // Rounds 5-10
  return 'C';                   // Rounds 11-16
}

/**
 * Unified keeper bonus formula
 * Formula: bonus = baseValue × draftBonus × keeperMultiplier
 * 
 * draftBonus = (round - 1) / 100
 * keeperMultiplier = 0.6 (1yr), 0.8 (2yr), 1.0 (3yr)
 * 
 * Examples:
 * - Celebrini (167.6, R14, 1yr): (14-1)/100 = 0.13 → 167.6 × 0.13 × 0.6 = 13.06 → 180.7 total
 * - Tage (114.0, R13, 1yr): (13-1)/100 = 0.12 → 114.0 × 0.12 × 0.6 = 8.21 → 122.2 total
 * 
 * @param baseValue - Current player value from z-score engine
 * @param draftRound - Original draft round (1-16)
 * @param _draftRoundAvg - Unused, kept for compatibility
 * @param yearsRemaining - Years of keeper eligibility remaining (1, 2, or 3)
 * @returns Keeper bonus points
 */
export function calculateKeeperBonus(
  baseValue: number,
  draftRound: number,
  _draftRoundAvg: number, // Unused, kept for compatibility
  yearsRemaining: number
): number {
  // Draft bonus: (round - 1) / 100
  // R14 → (14-1)/100 = 0.13
  // R13 → (13-1)/100 = 0.12
  // R1 → (1-1)/100 = 0.00 (no bonus for first rounders)
  const draftBonus = (draftRound - 1) / 100;
  
  // Keeper multiplier based on years remaining
  // 1 year left = 0.6 (60%)
  // 2 years left = 0.8 (80%)
  // 3 years left = 1.0 (100%)
  const keeperMultiplier =
    yearsRemaining === 1 ? 0.6 :
    yearsRemaining === 2 ? 0.8 :
    yearsRemaining === 3 ? 1.0 :
    0; // No bonus if 0 years remaining
  
  // Final bonus: baseValue × draftBonus × keeperMultiplier
  const keeperBonus = baseValue * draftBonus * keeperMultiplier;
  
  return keeperBonus;
}

