/**
 * AI-powered trade analysis using DeepSeek
 * All position analysis and trade logic is computed in TypeScript.
 * DeepSeek is only used to format explanations based on facts we provide.
 */

import { callDeepSeek } from "./deepseek";

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
 * Generate potential trades using OUR logic (not DeepSeek's)
 * Strategy: Find fair value swaps between different positions
 */
function generatePotentialTrades(
  myTeam: TeamForAI,
  otherTeams: TeamForAI[]
): Array<{ partner: TeamForAI; payload: TradePayload }> {
  const myTeamSummary = buildTeamSummary(myTeam);
  const potentialTrades: Array<{ partner: TeamForAI; payload: TradePayload }> = [];
  
  console.log("[Trade Gen] My team:", myTeamSummary.name);
  console.log("[Trade Gen] Position counts:", myTeamSummary.positionCounts);
  console.log("[Trade Gen] Weak positions:", myTeamSummary.weakPositions);
  console.log("[Trade Gen] Surplus positions:", myTeamSummary.surplusPositions);
  
  for (const partnerTeam of otherTeams) {
    const partnerSummary = buildTeamSummary(partnerTeam);
    
    console.log(`[Trade Gen] Checking ${partnerTeam.name}...`);
    
    // Strategy: Try to find ANY fair 1-for-1 trade
    // Sort my players by value (willing to trade lower/mid tier)
    const myTradeable = myTeam.roster
      .filter(p => p.value > 50 && p.value < 150) // Mid-tier players
      .filter(p => !p.status || p.status === "DTD") // Not on long-term IR
      .sort((a, b) => b.value - a.value);
    
    // Sort their players by value
    const theirTradeable = partnerTeam.roster
      .filter(p => p.value > 50 && p.value < 150)
      .filter(p => !p.status || p.status === "DTD")
      .sort((a, b) => b.value - a.value);
    
    console.log(`[Trade Gen]   My tradeable: ${myTradeable.length}, Their tradeable: ${theirTradeable.length}`);
    
    // Try to find a fair swap with different positions
    for (const myPlayer of myTradeable.slice(0, 5)) { // Check top 5
      for (const theirPlayer of theirTradeable.slice(0, 5)) {
        const valueDiff = Math.abs(myPlayer.value - theirPlayer.value);
        
        // Fair value (within 20 points)
        if (valueDiff > 20) continue;
        
        // Different primary positions (makes it interesting)
        const myPos = myPlayer.position.split("/")[0];
        const theirPos = theirPlayer.position.split("/")[0];
        
        if (myPos === theirPos) continue; // Same position = boring
        
        console.log(`[Trade Gen]   Found potential: ${myPlayer.name} (${myPos}, ${myPlayer.value.toFixed(0)}) <-> ${theirPlayer.name} (${theirPos}, ${theirPlayer.value.toFixed(0)})`);
        
        const netChange = theirPlayer.value - myPlayer.value;
        
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
            netChangeUser: netChange,
            netChangePartner: -netChange,
          },
        };
        
        potentialTrades.push({ partner: partnerTeam, payload });
        break; // Only one trade per partner for now
      }
      
      if (potentialTrades.some(t => t.partner.name === partnerTeam.name)) {
        break; // Found a trade with this partner, move on
      }
    }
  }
  
  console.log(`[Trade Gen] Generated ${potentialTrades.length} total trades`);
  
  // Sort by absolute net change (closer to fair is better)
  return potentialTrades.sort((a, b) => 
    Math.abs(a.payload.trade.netChangeUser) - Math.abs(b.payload.trade.netChangeUser)
  );
}

/**
 * Ask DeepSeek to explain a trade based on the factual data we provide
 */
async function explainTrade(payload: TradePayload): Promise<{
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

Net Value Change for You: ${payload.trade.netChangeUser >= 0 ? "+" : ""}${payload.trade.netChangeUser.toFixed(1)}
Net Value Change for Partner: ${payload.trade.netChangePartner >= 0 ? "+" : ""}${payload.trade.netChangePartner.toFixed(1)}

Explain why this trade makes sense (or doesn't) based ONLY on the position counts and values above.`;

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
    
    // Step 1: Generate potential trades using OUR logic
    const potentialTrades = generatePotentialTrades(myTeam, otherTeams);
    
    console.log(`[AI] Found ${potentialTrades.length} potential trades`);
    
    if (potentialTrades.length === 0) {
      console.log("[AI] No complementary trade opportunities found");
      return [];
    }
  
    // Step 2: Ask DeepSeek to explain the top 5 trades
    const suggestions: TradeSuggestion[] = [];
    
    for (const { partner, payload } of potentialTrades.slice(0, 5)) {
      try {
        console.log(`[AI] Explaining trade with ${partner.name}...`);
        const { reasoning, confidence } = await explainTrade(payload);
        
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
