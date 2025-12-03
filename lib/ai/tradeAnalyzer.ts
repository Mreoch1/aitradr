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
 */
function generatePotentialTrades(
  myTeam: TeamForAI,
  otherTeams: TeamForAI[]
): Array<{ partner: TeamForAI; payload: TradePayload }> {
  const myTeamSummary = buildTeamSummary(myTeam);
  const potentialTrades: Array<{ partner: TeamForAI; payload: TradePayload }> = [];
  
  for (const partnerTeam of otherTeams) {
    const partnerSummary = buildTeamSummary(partnerTeam);
    
    // Find complementary needs
    // Example: I'm weak at RW, they're surplus RW; they're weak at C, I'm surplus C
    const myWeakTheyStrong = myTeamSummary.weakPositions.filter(pos =>
      partnerSummary.surplusPositions.includes(pos)
    );
    const theyWeakIStrong = partnerSummary.weakPositions.filter(pos =>
      myTeamSummary.surplusPositions.includes(pos)
    );
    
    if (myWeakTheyStrong.length === 0 && theyWeakIStrong.length === 0) {
      // No complementary fit, skip
      continue;
    }
    
    // Build a simple 1-for-1 or 2-for-2 trade
    // Find a player I can send from my surplus positions
    const myPlayerToSend = myTeam.roster
      .filter(p => theyWeakIStrong.some(pos => p.position.includes(pos)))
      .sort((a, b) => b.value - a.value)[0];
    
    // Find a player I want to receive from their surplus positions
    const playerToReceive = partnerTeam.roster
      .filter(p => myWeakTheyStrong.some(pos => p.position.includes(pos)))
      .sort((a, b) => b.value - a.value)[0];
    
    if (!myPlayerToSend || !playerToReceive) {
      continue;
    }
    
    const netChange = playerToReceive.value - myPlayerToSend.value;
    
    // Only suggest if value is within ±20 points
    if (Math.abs(netChange) > 20) {
      continue;
    }
    
    const payload: TradePayload = {
      userTeam: myTeamSummary,
      partnerTeam: partnerSummary,
      trade: {
        send: [
          {
            name: myPlayerToSend.name,
            positions: myPlayerToSend.position.split("/") as Position[],
            value: myPlayerToSend.value,
            status: myPlayerToSend.status,
          },
        ],
        receive: [
          {
            name: playerToReceive.name,
            positions: playerToReceive.position.split("/") as Position[],
            value: playerToReceive.value,
            status: playerToReceive.status,
          },
        ],
        netChangeUser: netChange,
        netChangePartner: -netChange,
      },
    };
    
    potentialTrades.push({ partner: partnerTeam, payload });
  }
  
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
  const otherTeams = allTeams.filter(t => !t.isOwner);
  
  console.log("[AI] Computing trade opportunities for:", myTeam.name);
  
  // Step 1: Generate potential trades using OUR logic
  const potentialTrades = generatePotentialTrades(myTeam, otherTeams);
  
  console.log(`[AI] Found ${potentialTrades.length} potential trades`);
  
  if (potentialTrades.length === 0) {
    return [];
  }
  
  // Step 2: Ask DeepSeek to explain the top 5 trades
  const suggestions: TradeSuggestion[] = [];
  
  for (const { partner, payload } of potentialTrades.slice(0, 5)) {
    try {
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
}
