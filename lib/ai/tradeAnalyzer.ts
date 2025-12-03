/**
 * AI-powered trade analysis using DeepSeek
 */

import { callDeepSeek } from "./deepseek";

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

function buildTradeAnalysisPrompt(
  myTeam: TeamForAI,
  otherTeams: TeamForAI[]
): string {
  // Analyze position strengths/weaknesses
  const positions = ["C", "LW", "RW", "D", "G"];
  const myPositionCounts: Record<string, number> = {};
  const myPositionValues: Record<string, number> = {};
  
  positions.forEach(pos => {
    myPositionCounts[pos] = 0;
    myPositionValues[pos] = 0;
  });
  
  myTeam.roster.forEach(player => {
    const pos = player.position.split("/")[0] || player.position; // Take first position if dual eligible
    if (myPositionCounts[pos] !== undefined) {
      myPositionCounts[pos]++;
      myPositionValues[pos] += player.value;
    }
  });
  
  // Calculate average values per position
  const myAvgValues: Record<string, number> = {};
  positions.forEach(pos => {
    myAvgValues[pos] = myPositionCounts[pos] > 0 ? myPositionValues[pos] / myPositionCounts[pos] : 0;
  });
  
  // Build the prompt
  return `You are an expert fantasy hockey trade analyzer. Analyze trades that would improve the user's team.

## USER'S TEAM: "${myTeam.name}" ${myTeam.managerName ? `(Manager: ${myTeam.managerName})` : ""}

### Roster Summary (${myTeam.roster.length} players):
${positions.map(pos => `- ${pos}: ${myPositionCounts[pos]} players, Avg Value: ${myAvgValues[pos].toFixed(1)}`).join("\n")}

### Top 10 Players by Value:
${myTeam.roster
  .sort((a, b) => b.value - a.value)
  .slice(0, 10)
  .map((p, i) => `${i+1}. ${p.name} (${p.position}, ${p.nhlTeam}) - Value: ${p.value.toFixed(1)}${p.status ? ` [${p.status}]` : ""}`)
  .join("\n")}

### Position Depth Analysis:
${positions.map(pos => {
  const players = myTeam.roster.filter(p => p.position.includes(pos)).sort((a, b) => b.value - a.value);
  return `${pos}: ${players.length} players - ${players.slice(0, 3).map(p => `${p.name} (${p.value.toFixed(0)})`).join(", ")}`;
}).join("\n")}

### Draft Picks:
${myTeam.draftPicks.length > 0 ? `Rounds: ${myTeam.draftPicks.sort((a, b) => a - b).join(", ")}` : "None"}

---

## OTHER TEAMS IN LEAGUE (${otherTeams.length} teams):

${otherTeams.map(team => `
### ${team.name} ${team.managerName ? `(${team.managerName})` : ""}
- Total Roster Value: ${team.totalValue.toFixed(1)}
- ${positions.map(pos => {
  const count = team.roster.filter(p => p.position.includes(pos)).length;
  return `${pos}: ${count}`;
}).join(", ")}
- Top 3 Players: ${team.roster.sort((a, b) => b.value - a.value).slice(0, 3).map(p => `${p.name} (${p.value.toFixed(0)})`).join(", ")}
- Draft Picks: ${team.draftPicks.length > 0 ? team.draftPicks.sort((a, b) => a - b).join(", ") : "None"}
`).join("\n")}

---

## TASK:

Suggest 3-5 realistic trade opportunities that would IMPROVE the user's team ("${myTeam.name}"). For each suggestion:

1. **Identify strategic fit**: Which team has what you need, and needs what you have?
2. **Propose specific players/picks**: Be realistic about value balance
3. **Explain the benefit**: How does this improve position weaknesses, add depth, or address specific needs?
4. **Consider injury status**: If a player is on IR, factor that into timing
5. **Assess fairness**: Aim for fair value (within ±10 points)

Format your response as JSON:

\`\`\`json
{
  "suggestions": [
    {
      "tradeWithTeam": "Team Name",
      "youGive": [
        {"type": "player", "name": "Player Name", "value": 120.5}
      ],
      "youGet": [
        {"type": "player", "name": "Player Name", "value": 125.0}
      ],
      "netGain": 4.5,
      "reasoning": "This trade addresses your D weakness. You have C depth to spare, and they need a center...",
      "confidence": 85
    }
  ]
}
\`\`\`

Focus on trades that:
- Fill position gaps
- Are realistic (fair value)
- Both teams benefit
- Consider surplus positions

Provide 3-5 suggestions ordered by confidence (best first).`;
}

export async function analyzeTrades(
  myTeam: TeamForAI,
  allTeams: TeamForAI[]
): Promise<TradeSuggestion[]> {
  const otherTeams = allTeams.filter(t => !t.isOwner);
  
  const prompt = buildTradeAnalysisPrompt(myTeam, otherTeams);
  
  console.log("[AI] Analyzing trades for:", myTeam.name);
  console.log("[AI] Prompt length:", prompt.length, "characters");
  
  const response = await callDeepSeek([
    {
      role: "system",
      content: "You are an expert fantasy hockey trade analyzer. Always respond with valid JSON containing trade suggestions."
    },
    {
      role: "user",
      content: prompt
    }
  ], {
    temperature: 0.7,
    maxTokens: 2500
  });
  
  console.log("[AI] Response length:", response.length, "characters");
  
  // Parse JSON response
  try {
    // Extract JSON from markdown code blocks if present
    let jsonStr = response;
    const jsonMatch = response.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1];
    }
    
    const parsed = JSON.parse(jsonStr);
    return parsed.suggestions || [];
  } catch (error) {
    console.error("[AI] Failed to parse response:", error);
    console.error("[AI] Response was:", response.substring(0, 500));
    throw new Error("Failed to parse AI response");
  }
}

