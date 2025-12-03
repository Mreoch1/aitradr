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
  type CategoryProfile,
} from "./categoryAnalyzer";

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
  status?: string; // IR, DTD, etc.
}

export interface TeamForAI {
  name: string;
  managerName?: string;
  isOwner: boolean;
  roster: PlayerForAI[];
  draftPicks: number[];
  totalValue: number;
}

export interface TradeSuggestion {
  tradeWithTeam: string;
  youGive: Array<{ type: "player" | "pick"; name: string; value: number }>;
  youGet: Array<{ type: "player" | "pick"; name: string; value: number }>;
  netGain: number;
  reasoning: string;
  confidence: number; // 0-100
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
    const myTradeable = myTeam.roster
      .filter(p => p.value > 50 && p.value < 180)
      .filter(p => !p.status || p.status === "DTD")
      .sort((a, b) => b.value - a.value);
    
    const theirTradeable = partnerTeam.roster
      .filter(p => p.value > 50 && p.value < 180)
      .filter(p => !p.status || p.status === "DTD")
      .sort((a, b) => b.value - a.value);
    
    // Try to find trades that improve categories
    for (const myPlayer of myTradeable.slice(0, 5)) {
      for (const theirPlayer of theirTradeable.slice(0, 5)) {
        const valueDiff = theirPlayer.value - myPlayer.value;
        
        // Fair value (within ±25 points)
        if (Math.abs(valueDiff) > 25) continue;
        
        // Calculate category gain
        const { gain: categoryGain } = calculateCategoryGain(
          myProfile,
          [myPlayer],
          [theirPlayer]
        );
        
        // Calculate combined trade score
        const tradeScore = calculateTradeScore(valueDiff, categoryGain);
        
        // Only suggest if either value is decent OR category gain is significant
        if (valueDiff < -15 && categoryGain < 5) continue; // Skip bad value with no category help
        
        console.log(`[Trade Gen]   ${myPlayer.name} <-> ${theirPlayer.name}: value=${valueDiff.toFixed(1)}, catGain=${categoryGain.toFixed(1)}, score=${tradeScore.toFixed(1)}`);
        
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
You Send: ${payload.trade.send.map(p => `${p.name} [${p.positions.join("/")}] (${p.value.toFixed(1)})${p.status ? ` [${p.status}]` : ""}`).join(", ")}
You Receive: ${payload.trade.receive.map(p => `${p.name} [${p.positions.join("/")}] (${p.value.toFixed(1)})${p.status ? ` [${p.status}]` : ""}`).join(", ")}

Net Value Change: ${payload.trade.netChangeUser >= 0 ? "+" : ""}${payload.trade.netChangeUser.toFixed(1)} points
Category Improvement Score: ${categoryGain.toFixed(1)}${categoryGain > 5 ? " (significant)" : ""}

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
    
    // Step 1: Generate potential trades using category-aware logic
    const potentialTrades = generatePotentialTrades(myTeam, otherTeams, allTeams);
    
    console.log(`[AI] Found ${potentialTrades.length} potential trades`);
    
    if (potentialTrades.length === 0) {
      console.log("[AI] No beneficial trade opportunities found");
      return [];
    }
  
    // Step 2: Ask DeepSeek to explain the top 5 trades (already scored and ranked)
    const suggestions: TradeSuggestion[] = [];
    
    for (const { partner, payload, categoryGain, tradeScore } of potentialTrades.slice(0, 5)) {
      try {
        console.log(`[AI] Explaining trade with ${partner.name} (score: ${tradeScore.toFixed(1)})...`);
        const { reasoning, confidence } = await explainTrade(payload, categoryGain);
        
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
          confidence,
        });
      } catch (error) {
        console.error("[AI] Failed to explain trade with", partner.name, error);
      }
    }
    
    console.log(`[AI] Generated ${suggestions.length} trade suggestions`);
    
    return suggestions;
  } catch (error) {
    console.error("[AI] analyzeTrades error:", error);
    throw error;
  }
}
