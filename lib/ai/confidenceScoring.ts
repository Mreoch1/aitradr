/**
 * Confidence scoring for AI trade suggestions
 * 
 * Reflects realistic probability that a trade would be accepted by both sides.
 * Penalizes lopsided trades, rewards fair value + category improvement.
 */

export interface TradeContext {
  netValue: number;           // Your side net change (positive = you win)
  categoryScore?: number;     // Normalized category gain, 0 to 1 (optional)
  hasEliteOutgoing?: boolean; // Trading away elite player
  hasEliteIncoming?: boolean; // Receiving elite player
}

/**
 * Calculate realistic confidence for a trade suggestion
 * 
 * Philosophy:
 * - Fair trades (< 5 value diff) = High confidence
 * - Moderate wins (5-30) = High to Medium
 * - Big wins (> 50) = Speculative (too good to be true)
 * - Any loss = capped confidence (trading partner unlikely to accept)
 * 
 * @param context - Trade context with netValue and optional category/elite flags
 * @returns Confidence label: "High" | "Medium" | "Speculative"
 */
export function computeConfidence(context: TradeContext): "High" | "Medium" | "Speculative" {
  const { netValue, categoryScore = 0 } = context;
  
  let confidence = 0;
  
  // Base confidence from value fairness
  const absNet = Math.abs(netValue);
  
  if (absNet <= 5) {
    confidence = 0.9;  // Very fair, both sides happy
  } else if (absNet <= 15) {
    confidence = 0.8;  // Slightly tilted but acceptable
  } else if (absNet <= 30) {
    confidence = 0.65; // Moderate advantage - less likely to be accepted
  } else if (absNet <= 50) {
    confidence = 0.4;  // Large advantage, very questionable
  } else {
    confidence = 0.2;  // Very lopsided, essentially veto-bait
  }
  
  // Small boost for category improvement (max +10%)
  // Reduced from 15% because category gains shouldn't justify huge value losses
  confidence += 0.10 * Math.min(categoryScore, 1.0);
  confidence = Math.min(confidence, 0.98);
  
  // Hard caps for losing trades
  if (netValue < -5) {
    confidence = Math.min(confidence, 0.6);   // Losing a bit = Medium max
  }
  if (netValue < -12) {
    confidence = Math.min(confidence, 0.4);   // Losing more = Speculative max
  }
  if (netValue < -20) {
    confidence = Math.min(confidence, 0.25);  // Major loss = very speculative
  }
  
  // Realism guard: huge wins are unlikely to be accepted
  // Tighter thresholds for realistic trades
  if (netValue > 20) {
    confidence = Math.min(confidence, 0.5);   // > 20 point win = Medium max (unlikely)
  }
  if (netValue > 25) {
    confidence = Math.min(confidence, 0.4);   // > 25 point win = Speculative (very unlikely)
  }
  if (netValue > 40) {
    confidence = Math.min(confidence, 0.25);  // > 40 point win = Very Speculative (veto-bait)
  }
  if (netValue > 50) {
    confidence = Math.min(confidence, 0.15);  // > 50 point win = Essentially impossible
  }
  
  // Map confidence score to label
  if (confidence >= 0.8) {
    return "High";
  } else if (confidence >= 0.55) {
    return "Medium";
  } else {
    return "Speculative";
  }
}

/**
 * Calculate normalized category score (0 to 1)
 * Based on how many weak categories are addressed and by how much
 * 
 * @param categoryImpact - Array of category improvement strings like "Hits +15%"
 * @returns Normalized score 0.0 to 1.0
 */
export function calculateCategoryScore(categoryImpact: string[]): number {
  if (!categoryImpact || categoryImpact.length === 0) {
    return 0;
  }
  
  let totalImprovement = 0;
  let count = 0;
  
  for (const impact of categoryImpact) {
    // Parse percentage from strings like "Hits +15%"
    const match = impact.match(/([+-]?\d+(?:\.\d+)?)\s*%/);
    if (match) {
      const percent = parseFloat(match[1]);
      totalImprovement += Math.abs(percent);
      count++;
    }
  }
  
  if (count === 0) {
    return 0;
  }
  
  // Average improvement percentage, normalized to 0-1 scale
  // 20% improvement = 0.4, 50% improvement = 1.0
  const avgImprovement = totalImprovement / count;
  return Math.min(avgImprovement / 50, 1.0);
}

