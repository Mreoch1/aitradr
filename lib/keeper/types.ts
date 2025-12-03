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
 * @param keeperYearIndex - 0 = first year, 1 = second year, 2 = third year
 * @returns Years remaining (3, 2, 1, or 0)
 */
export function calculateYearsRemaining(keeperYearIndex: number): number {
  return Math.max(0, KEEPER_RULES.MAX_KEEPER_YEARS - keeperYearIndex);
}

/**
 * Calculate keeper surplus value (bonus for late-round steals)
 * @param playerValue - Current player value
 * @param draftRoundAvg - Average value of players drafted in that round
 * @param yearsRemaining - How many more years can be kept
 * @returns Keeper bonus to add to trade value
 */
export function calculateKeeperBonus(
  playerValue: number,
  draftRoundAvg: number,
  yearsRemaining: number
): number {
  const surplus = Math.max(0, playerValue - draftRoundAvg);
  const bonus = surplus * (yearsRemaining / KEEPER_RULES.MAX_KEEPER_YEARS);
  return bonus;
}

