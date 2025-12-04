/**
 * AI-powered trade analysis using DeepSeek
 * All position and CATEGORY analysis computed in TypeScript.
 * DeepSeek is only used to format explanations based on facts we provide.
 */

import { callDeepSeek } from "./deepseek";
import {
  calculateLeagueAverages,
  buildCategoryProfile,
  calculateCategoryGain,
  calculateTradeScore,
  getStatValue,
  type CategoryProfile,
} from "./categoryAnalyzer";
import { toFixedSafe } from "@/lib/utils/numberFormat";
import type { AnyStat } from "./categoryAnalyzer";

type Position = "C" | "LW" | "RW" | "D" | "G";

export interface PlayerForAI {
  name: string;
  position: string;
  nhlTeam: string;
  value: number;
  stats: {
    goals?: number;
    assists?: number;
    points?: number;
    plusMinus?: number;
    pim?: number;
    ppp?: number;
    wins?: number;
    saves?: number;
    savePct?: number;
    shutouts?: number;
  };
  rawStats?: Array<{ statName: string; value: number }>; // Full stat array for category analysis
  status?: string; // IR, DTD, etc.
  // Keeper data
  isKeeper?: boolean;
  keeperYearIndex?: number;
  yearsRemaining?: number;
  keeperRoundCost?: number;
  keeperBonus?: number; // Calculated keeper surplus value
}

export interface TeamForAI {
  name: string;
  managerName?: string;
  isOwner: boolean;
  roster: PlayerForAI[];
  draftPicks: number[];
  totalValue: number;
}

export interface TradeAsset {
  type: "player" | "pick";
  name: string;
  value: number;
  round?: number; // For picks only
}

export interface TradeSuggestion {
  tradeWithTeam: string;
  youGive: TradeAsset[];
  youGet: TradeAsset[];
  netGain: number;
  reasoning: string;
  confidence: number; // 0-100
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates that a trade suggestion has valid structure and data
 * SOFT QUALITY PASS: Only rejects true garbage, allows legitimate trades
 */
export function isValidTradeSuggestion(suggestion: TradeSuggestion): boolean {
  // Must have a partner team name
  if (!suggestion.tradeWithTeam || suggestion.tradeWithTeam.trim() === "") {
    console.warn("[Validation] Rejected: Missing partner team");
    return false;
  }
  
  // Must move at least one asset on each side
  if (!suggestion.youGive || suggestion.youGive.length === 0) {
    console.warn("[Validation] Rejected: No assets given");
    return false;
  }
  if (!suggestion.youGet || suggestion.youGet.length === 0) {
    console.warn("[Validation] Rejected: No assets received");
    return false;
  }
  
  const allAssets = [...suggestion.youGive, ...suggestion.youGet];
  
  // Kill "Round undefined Pick" - asset name contains "undefined"
  if (allAssets.some(a => !a.name || a.name.toLowerCase().includes("undefined"))) {
    console.warn("[Validation] Rejected: Asset name contains 'undefined'");
    return false;
  }
  
  // Kill NaN/Infinity values
  if (allAssets.some(a => !Number.isFinite(a.value))) {
    console.warn("[Validation] Rejected: NaN or Infinity value");
    return false;
  }
  
  // Reject only if BOTH sides are useless (value < 5)
  const giveHasValue = suggestion.youGive.some(a => a.value > 5);
  const getHasValue = suggestion.youGet.some(a => a.value > 5);
  
  if (!giveHasValue && !getHasValue) {
    console.warn("[Validation] Rejected: Both sides have value < 5");
    return false;
  }
  
  // Pick rule: only reject if it's labeled as a pick AND has no round
  const badPick = allAssets.some(a => 
    a.type === "pick" && (a.round == null || !Number.isFinite(a.round))
  );
  
  if (badPick) {
    console.warn("[Validation] Rejected: Pick missing round number");
    return false;
  }
  
  return true;
}

interface PositionCounts {
  C: number;
  LW: number;
  RW: number;
  D: number;
  G: number;
}

interface TeamSummary {
  teamId: string;
  name: string;
  managerName?: string;
  positionCounts: PositionCounts;
  weakPositions: Position[];
  surplusPositions: Position[];
  topPlayers: Array<{ name: string; positions: Position[]; value: number; status?: string }>;
}

interface TradePayload {
  userTeam: TeamSummary;
  partnerTeam: TeamSummary;
  trade: {
    send: Array<{ name: string; positions: Position[]; value: number; status?: string }>;
    receive: Array<{ name: string; positions: Position[]; value: number; status?: string }>;
    netChangeUser: number;
    netChangePartner: number;
  };
}

/**
 * Compute position counts for a team (players with dual eligibility count for both positions)
 */
function computePositionCounts(players: PlayerForAI[]): PositionCounts {
  const counts: PositionCounts = { C: 0, LW: 0, RW: 0, D: 0, G: 0 };
  
  for (const player of players) {
    const positions = player.position.split("/") as Position[];
    for (const pos of positions) {
      if (counts[pos] !== undefined) {
        counts[pos]++;
      }
    }
  }
  
  return counts;
}

/**
 * Find weak and surplus positions based on roster distribution
 */
function analyzePositionDepth(counts: PositionCounts): {
  weak: Position[];
  surplus: Position[];
} {
  const total = counts.C + counts.LW + counts.RW + counts.D + counts.G;
  const avg = total / 5;
  
  const weak: Position[] = [];
  const surplus: Position[] = [];
  
  for (const pos of ["C", "LW", "RW", "D", "G"] as Position[]) {
    if (counts[pos] <= 2) {
      weak.push(pos);
    } else if (counts[pos] >= avg + 1) {
      surplus.push(pos);
    }
  }
  
  return { weak, surplus };
}

/**
 * Build a team summary with computed position analysis
 */
function buildTeamSummary(team: TeamForAI): TeamSummary {
  const positionCounts = computePositionCounts(team.roster);
  const { weak, surplus } = analyzePositionDepth(positionCounts);
  
  const topPlayers = team.roster
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
    .map(p => ({
      name: p.name,
      positions: p.position.split("/") as Position[],
      value: p.value,
      status: p.status,
    }));
  
  return {
    teamId: team.name, // Using name as ID for simplicity
    name: team.name,
    managerName: team.managerName,
    positionCounts,
    weakPositions: weak,
    surplusPositions: surplus,
    topPlayers,
  };
}

/**
 * Generate potential trades using category-aware logic
 * Strategy: Find trades that improve weak categories while maintaining fair value
 */
function generatePotentialTrades(
  myTeam: TeamForAI,
  otherTeams: TeamForAI[],
  allTeams: TeamForAI[]
): Array<{ partner: TeamForAI; payload: TradePayload; categoryGain: number; tradeScore: number }> {
  const myTeamSummary = buildTeamSummary(myTeam);
  
  // Calculate league averages and category profiles
  const leagueAverages = calculateLeagueAverages(allTeams);
  const myProfile = buildCategoryProfile(myTeam, leagueAverages);
  
  console.log("[Trade Gen] My team:", myTeamSummary.name);
  console.log("[Trade Gen] Category strengths:", myProfile.strengths.join(", ") || "None");
  console.log("[Trade Gen] Category weaknesses:", myProfile.weaknesses.join(", ") || "None");
  
  const potentialTrades: Array<{ partner: TeamForAI; payload: TradePayload; categoryGain: number; tradeScore: number }> = [];
  
  for (const partnerTeam of otherTeams) {
    const partnerSummary = buildTeamSummary(partnerTeam);
    const partnerProfile = buildCategoryProfile(partnerTeam, leagueAverages);
    
    console.log(`[Trade Gen] Checking ${partnerTeam.name}...`);
    
    // Tradeable players (mid-tier, not injured long-term)
    // ANTI-GARBAGE RULE: Filter out low-impact players unless they're starters
    // Simplified: Only consider starter-level players (90+ value)
    const isStarterLevel = (player: PlayerForAI) => player.value >= 90;
    
    const myTradeable = myTeam.roster
      .filter(p => p.value > 50 && p.value < 180)
      .filter(p => !p.status || p.status === "DTD")
      .filter(p => isStarterLevel(p)) // Only starters
      .sort((a, b) => b.value - a.value);
    
    const theirTradeable = partnerTeam.roster
      .filter(p => p.value > 50 && p.value < 180)
      .filter(p => !p.status || p.status === "DTD")
      .filter(p => isStarterLevel(p)) // Only starters
      .sort((a, b) => b.value - a.value);
    
    console.log(`[Trade Gen]   My tradeable: ${myTradeable.length} players (from ${myTeam.roster.length} total)`);
    console.log(`[Trade Gen]   Their tradeable: ${theirTradeable.length} players (from ${partnerTeam.roster.length} total)`);
    
    // Try to find trades that improve categories
    for (const myPlayer of myTradeable.slice(0, 5)) {
      for (const theirPlayer of theirTradeable.slice(0, 5)) {
        const valueDiff = theirPlayer.value - myPlayer.value;
        
        // FIX #4: ELITE PLAYER PROTECTION (tighter threshold)
        // Elite tier = 150+ value (lowered from 155 to be more protective)
        const isMyPlayerElite = myPlayer.value >= 150;
        if (isMyPlayerElite && valueDiff < -(myPlayer.value * 0.07)) {
          // Losing >7% value on elite player - REJECT
          continue;
        }
        
        // Fair value (within ±25 points for non-elite)
        if (Math.abs(valueDiff) > 25) continue;
        
        // Calculate category gain
        const { gain: categoryGain } = calculateCategoryGain(
          myProfile,
          [myPlayer],
          [theirPlayer]
        );
        
        // FIX #2: KEEPER ASSET LOCK
        // Expiring high-surplus keepers CANNOT be traded for non-keepers unless major value gain
        if (myPlayer.isKeeper && 
            (myPlayer.yearsRemaining ?? 3) === 1 && 
            (myPlayer.keeperBonus ?? 0) > 20) {
          // This is a valuable expiring keeper
          if (!theirPlayer.isKeeper && valueDiff < 15) {
            // Trading keeper for non-keeper without major value gain - BLOCK
            continue;
          }
        }
        
        // FIX #3: Bad Trade Hard Blocker (keeper loss)
        // If losing value AND losing keeper, reject
        if (valueDiff < -12 && myPlayer.isKeeper && !theirPlayer.isKeeper) {
          continue;
        }
        
        // Calculate keeper economics impact
        let keeperImpact = 0;
        
        // Losing a high-keeper-bonus player is costly
        const myKeeperBonus = myPlayer.keeperBonus || 0;
        const theirKeeperBonus = theirPlayer.keeperBonus || 0;
        keeperImpact = theirKeeperBonus - myKeeperBonus;
        
        // Prefer moving expiring keepers (low years remaining)
        if (myPlayer.isKeeper && (myPlayer.yearsRemaining ?? 3) <= 1) {
          keeperImpact += 8; // Bonus for moving expiring keeper
        }
        
        // Protect fresh late-round elite keepers
        if (myPlayer.isKeeper && myPlayer.keeperBonus && myPlayer.keeperBonus > 30) {
          keeperImpact -= 12; // Penalty for trading away elite keeper bargain
        }
        
        // FIX #5: Market Sanity Filter
        // Downgrade from elite to non-elite requires extra justification
        let marketPenalty = 0;
        if (myPlayer.value >= 150 && theirPlayer.value < 135) {
          // Elite → non-elite downgrade
          marketPenalty = 8; // Treat as 8 points worse than stated
        }
        
        // FIX #6: Position Justification (track if trade creates holes)
        // For now, this is a placeholder - full positional analysis would need roster context
        let positionPenalty = 0;
        const myPos = myPlayer.position.split("/")[0];
        const theirPos = theirPlayer.position.split("/")[0];
        
        // If trading away primary position for different position, small penalty
        if (myPos !== theirPos) {
          positionPenalty = 2; // Mild penalty for position change
        }
        
        // Calculate combined trade score
        const adjustedValueDiff = valueDiff - marketPenalty - positionPenalty;
        const tradeScore = calculateTradeScore(adjustedValueDiff, categoryGain) + keeperImpact;
        
        // Filter logic: skip trades that don't make strategic sense
        // 1. Skip heavy value losses with no category help
        if (valueDiff < -15 && categoryGain < 5 && keeperImpact < 5) continue;
        
        // 2. Skip sidegrades (cosmetic swaps with no purpose)
        if (Math.abs(valueDiff) < 6 && categoryGain < 10 && keeperImpact < 5) continue;
        
        // 3. BAD TRADE BLOCKER: Net loss >10 requires major category gains
        if (valueDiff < -10) {
          // Losing 10+ value requires significant category improvement
          if (categoryGain < 15) continue; // Need strong category justification
          
          // Cannot trade away elite keeper with years remaining for value loss
          if (myPlayer.isKeeper && (myPlayer.yearsRemaining ?? 0) > 1 && myPlayer.keeperBonus && myPlayer.keeperBonus > 25) {
            continue; // Protect valuable keepers
          }
        }
        
        // 4. Only suggest if trade score is positive (net benefit)
        if (tradeScore < 0) continue;
        
        console.log(`[Trade Gen]   ${myPlayer.name}${myPlayer.isKeeper ? ' [K]' : ''} <-> ${theirPlayer.name}${theirPlayer.isKeeper ? ' [K]' : ''}: value=${toFixedSafe(valueDiff, 1)}, cat=${toFixedSafe(categoryGain, 1)}, keeper=${toFixedSafe(keeperImpact, 1)}, market=${marketPenalty}, score=${toFixedSafe(tradeScore, 1)}`);
        
        const payload: TradePayload = {
          userTeam: myTeamSummary,
          partnerTeam: partnerSummary,
          trade: {
            send: [
              {
                name: myPlayer.name,
                positions: myPlayer.position.split("/") as Position[],
                value: myPlayer.value,
                status: myPlayer.status,
              },
            ],
            receive: [
              {
                name: theirPlayer.name,
                positions: theirPlayer.position.split("/") as Position[],
                value: theirPlayer.value,
                status: theirPlayer.status,
              },
            ],
            netChangeUser: valueDiff,
            netChangePartner: -valueDiff,
          },
        };
        
        potentialTrades.push({ partner: partnerTeam, payload, categoryGain, tradeScore });
        break; // One trade per partner
      }
      
      if (potentialTrades.some(t => t.partner.name === partnerTeam.name)) {
        break;
      }
    }
  }
  
  console.log(`[Trade Gen] Generated ${potentialTrades.length} total trades`);
  
  if (potentialTrades.length === 0) {
    console.log(`[Trade Gen] No trades found. Possible reasons:`);
    console.log(`[Trade Gen]   - Not enough tradeable players (need value 50-180, healthy)`);
    console.log(`[Trade Gen]   - No fair value matches (need within ±25 points)`);
    console.log(`[Trade Gen]   - Trade scores too low (value + category gains)`);
  }
  
  // Sort by trade score (value + category gain)
  return potentialTrades.sort((a, b) => b.tradeScore - a.tradeScore);
}

/**
 * Ask DeepSeek to explain a trade based on the factual data we provide
 * Includes category gain information for richer explanations
 */
async function explainTrade(payload: TradePayload, categoryGain: number): Promise<{
  reasoning: string;
  confidence: number;
}> {
  const systemPrompt = `You are a fantasy hockey trade analyst.

You receive:
- Exact position counts for each team
- A specific trade with player names, positions, and value deltas

STRICT RULES:
1. You MUST base positional comments ONLY on the provided positionCounts.
2. NEVER invent or guess how many players a team has at a position.
3. If the data does not show a shortage or surplus, do not claim there is one.
4. You may reference relative depth ONLY if the counts support it.
5. If a statement cannot be proven from the numbers provided, OMIT IT.

Your job:
- Explain why this trade might help or hurt the user
- Mention which positions change (C, LW, RW, D, G)
- Mention value balance (net gains or losses)
- Avoid claims that contradict the position counts

Return JSON ONLY with this exact shape:
{
  "reasoning": "Brief explanation (2-3 sentences max)",
  "confidence": 75
}

Do NOT add extra fields. Do NOT describe positions in ways that contradict positionCounts.`;

  const userPrompt = `Explain this trade:

User Team: ${payload.userTeam.name}
Position Counts: ${Object.entries(payload.userTeam.positionCounts).map(([pos, count]) => `${pos}:${count}`).join(", ")}
Weak Positions: ${payload.userTeam.weakPositions.join(", ") || "None"}
Surplus Positions: ${payload.userTeam.surplusPositions.join(", ") || "None"}

Partner Team: ${payload.partnerTeam.name}${payload.partnerTeam.managerName ? ` (${payload.partnerTeam.managerName})` : ""}
Position Counts: ${Object.entries(payload.partnerTeam.positionCounts).map(([pos, count]) => `${pos}:${count}`).join(", ")}
Weak Positions: ${payload.partnerTeam.weakPositions.join(", ") || "None"}
Surplus Positions: ${payload.partnerTeam.surplusPositions.join(", ") || "None"}

TRADE:
You Send: ${payload.trade.send.map(p => `${p.name} [${p.positions.join("/")}] (${toFixedSafe(p.value, 1)})${p.status ? ` [${p.status}]` : ""}`).join(", ")}
You Receive: ${payload.trade.receive.map(p => `${p.name} [${p.positions.join("/")}] (${toFixedSafe(p.value, 1)})${p.status ? ` [${p.status}]` : ""}`).join(", ")}

Net Value Change: ${payload.trade.netChangeUser >= 0 ? "+" : ""}${toFixedSafe(payload.trade.netChangeUser, 1)} points
Category Improvement Score: ${toFixedSafe(categoryGain, 1)}${categoryGain > 5 ? " (significant)" : ""}

Explain in 2-3 sentences why this trade makes sense based on position balance and value.`;

  const response = await callDeepSeek([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ], {
    temperature: 0.3,
    maxTokens: 300,
  });
  
  // Parse JSON response
  try {
    let jsonStr = response.trim();
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    const parsed = JSON.parse(jsonStr);
    
    // Validate the response doesn't contradict our position counts
    const reasoning = parsed.reasoning.toLowerCase();
    
    // Simple sanity check: if it says "only X" for a position, verify
    for (const pos of ["C", "LW", "RW", "D", "G"] as Position[]) {
      const onlyMatch = reasoning.match(new RegExp(`only \\d+ ${pos.toLowerCase()}`, "i"));
      if (onlyMatch) {
        console.warn(`[AI] Warning: Response mentions "only X ${pos}", verifying against actual count:`, payload.userTeam.positionCounts[pos]);
      }
    }
    
    return {
      reasoning: parsed.reasoning,
      confidence: parsed.confidence || 50,
    };
  } catch (error) {
    console.error("[AI] Failed to parse explanation:", error);
    console.error("[AI] Response was:", response);
    
    // Fallback
    return {
      reasoning: "This trade balances value and addresses position needs.",
      confidence: 50,
    };
  }
}

/**
 * Main entry point: analyze trades for the user's team
 * Uses category-aware logic to find trades that address statistical weaknesses
 */
export async function analyzeTrades(
  myTeam: TeamForAI,
  allTeams: TeamForAI[]
): Promise<TradeSuggestion[]> {
  try {
    const otherTeams = allTeams.filter(t => !t.isOwner);
    
    console.log("[AI] Computing trade opportunities for:", myTeam.name);
    console.log("[AI] My team roster size:", myTeam.roster.length);
    console.log("[AI] Other teams count:", otherTeams.length);
    
    // Check if player values are calculated
    const myTeamHasValues = myTeam.roster.some(p => p.value > 0);
    if (!myTeamHasValues) {
      console.error("[AI] ERROR: All players have 0 value - values not calculated yet");
      throw new Error("Player values not calculated. Please click 'Refresh Teams' to sync data from Yahoo.");
    }
    
    // Step 1: Generate potential trades using category-aware logic
    const potentialTrades = generatePotentialTrades(myTeam, otherTeams, allTeams);
    
    console.log(`[AI] Found ${potentialTrades.length} potential trades`);
    
    if (potentialTrades.length === 0) {
      console.log("[AI] No beneficial trade opportunities found");
      return [];
    }
  
    // Step 2: Ask DeepSeek to explain the top 5 trades (already scored and ranked)
    const suggestions: TradeSuggestion[] = [];
    
    // FIX #7: Deduplicate trades
    const seenTrades = new Set<string>();
    
    for (const { partner, payload, categoryGain, tradeScore } of potentialTrades.slice(0, 5)) {
      try {
        // Create unique key for this trade
        const tradeKey = `${payload.trade.send.map(p => p.name).join(',')}|${payload.trade.receive.map(p => p.name).join(',')}|${partner.name}`;
        if (seenTrades.has(tradeKey)) {
          continue; // Skip duplicate
        }
        seenTrades.add(tradeKey);
        
        console.log(`[AI] Explaining trade with ${partner.name} (score: ${toFixedSafe(tradeScore, 1)})...`);
        const { reasoning } = await explainTrade(payload, categoryGain);
        
        // FIX #8: Risk-based confidence calculation
        // Confidence decreases with value risk: abs(valueDelta × 2.5)
        const valueDelta = payload.trade.netChangeUser;
        const riskBasedConfidence = Math.max(55, Math.min(95, 100 - Math.abs(valueDelta * 2.5)));
        
        suggestions.push({
          tradeWithTeam: `${partner.name}${partner.managerName ? ` (${partner.managerName})` : ""}`,
          youGive: payload.trade.send.map(p => ({
            type: "player" as const,
            name: p.name,
            value: p.value,
          })),
          youGet: payload.trade.receive.map(p => ({
            type: "player" as const,
            name: p.name,
            value: p.value,
          })),
          netGain: payload.trade.netChangeUser,
          reasoning,
          confidence: riskBasedConfidence, // Use calculated confidence, not AI's opinion
        });
      } catch (error) {
        console.error("[AI] Failed to explain trade with", partner.name, error);
      }
    }
    
    console.log(`[AI] ✅ Generated ${suggestions.length} trade suggestions (before validation)`);
    
    // Filter out invalid suggestions (only true garbage, not close-value trades)
    const validSuggestions = suggestions.filter(isValidTradeSuggestion);
    
    console.log(`[AI] ✅ Returning ${validSuggestions.length} valid trade suggestions (filtered ${suggestions.length - validSuggestions.length} invalid)`);
    
    if (validSuggestions.length === 0 && suggestions.length > 0) {
      console.error("[AI] ⚠️ ALL SUGGESTIONS FILTERED OUT - Validation may be too strict!");
    }
    
    return validSuggestions;
  } catch (error) {
    console.error("[AI] analyzeTrades error:", error);
    throw error;
  }
}
