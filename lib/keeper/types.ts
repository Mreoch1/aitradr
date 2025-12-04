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
 * Player tier classification by base value
 * Used for control premium calculation
 */
type PlayerTier = 'Franchise' | 'Star' | 'Core' | 'Normal';

function classifyPlayerTier(baseValue: number): PlayerTier {
  if (baseValue >= 165) return 'Franchise';
  if (baseValue >= 150) return 'Star';
  if (baseValue >= 135) return 'Core';
  return 'Normal';
}

/**
 * Control Premium: value of locking elite players for multiple years
 * Index: [0 years, 1 year, 2 years, 3 years]
 * Elite players aren't fungible - multi-year control has massive trade gravity
 */
const CONTROL_PREMIUM: Record<PlayerTier, [number, number, number, number]> = {
  Franchise: [0, 10, 28, 45],  // McDavid, MacKinnon, Matthews tier - moderate but meaningful
  Star:      [0,  7, 20, 32],  // Elite but not irreplaceable
  Core:      [0,  4, 12, 18],  // Solid players worth keeping
  Normal:    [0,  0,  0,  0],  // No premium for role players
};

/**
 * Tiered keeper bonus caps - prevent non-franchise players from reaching franchise level
 * No matter how good the keeper economics, a Star can't become a Franchise
 */
const TIER_BONUS_CAP: Record<PlayerTier, number> = {
  Franchise: 45,  // Can get full control premium
  Star: 30,       // Limited even with perfect keeper economics
  Core: 22,       // Meaningful but not elite
  Normal: 15,     // Small bonus only
};

/**
 * Final value caps by tier - prevent tier jumping via keeper bonuses
 * Absolute ceiling based on player quality tier
 */
const FINAL_VALUE_CAP: Record<PlayerTier, number> = {
  Franchise: 230,  // Practically unreachable
  Star: 190,       // Ceiling for Star tier
  Core: 175,       // Ceiling for Core tier
  Normal: 165,     // Ceiling for Normal tier
};

/**
 * New keeper bonus formula with surplus + control premium
 * Philosophy: "How expensive would this player be to replace?"
 * 
 * @param baseValue - Current player value from z-score engine
 * @param draftRound - Original draft round (1-16)
 * @param draftRoundAvg - Average player value for this draft round
 * @param yearsRemaining - Years of keeper eligibility remaining (0-3)
 * @returns Keeper bonus points
 */
export function calculateKeeperBonus(
  baseValue: number,
  draftRound: number,
  draftRoundAvg: number,
  yearsRemaining: number
): number {
  // Clamp years remaining to valid range
  const years = Math.max(0, Math.min(3, yearsRemaining));
  
  // PART A: Surplus Bonus (underdraft value)
  // How much better is this player than the draft round average?
  const surplusRaw = Math.max(0, baseValue - draftRoundAvg);
  
  // Cap surplus by draft tier to prevent late-round explosion
  const draftTier = getRoundTier(draftRound);
  const surplusCapByTier: Record<KeeperTier, number> = {
    'A': 25,  // Rounds 1-4: small cap
    'B': 35,  // Rounds 5-10: medium cap (reduced from 40)
    'C': 40,  // Rounds 11-16: reduced from 55 to prevent over-inflation
  };
  const cappedSurplus = Math.min(surplusRaw, surplusCapByTier[draftTier]);
  
  // Weight surplus by years remaining (more conservative)
  // [0 years, 1 year, 2 years, 3 years] = [0, 0.45, 0.75, 1.00]
  const surplusWeights = [0, 0.45, 0.75, 1.0];
  const surplusBonus = cappedSurplus * surplusWeights[years];
  
  // PART B: Control Premium (multi-year elite control)
  const playerTier = classifyPlayerTier(baseValue);
  const controlBonus = CONTROL_PREMIUM[playerTier][years];
  
  // PART C: Raw keeper bonus (before tier cap)
  const keeperRawBonus = surplusBonus + controlBonus;
  
  // PART D: Apply tier-based keeper bonus cap
  // Prevents Star/Core players from accumulating franchise-level bonuses
  const keeperBonus = Math.min(keeperRawBonus, TIER_BONUS_CAP[playerTier]);
  
  // PART E: Calculate provisional keeper value
  let finalValue = baseValue + keeperBonus;
  
  // PART F: Apply final value cap by tier
  // Prevents tier jumping - Star players cannot reach Franchise values
  finalValue = Math.min(finalValue, FINAL_VALUE_CAP[playerTier]);
  
  return keeperBonus; // Return only bonus for now to maintain compatibility
}

