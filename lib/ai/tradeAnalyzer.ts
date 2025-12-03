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
  // Analyze position strengths/weaknesses with DUAL ELIGIBILITY
  const positions = ["C", "LW", "RW", "D", "G"];
  const myPositionCounts: Record<string, number> = {};
  const myPositionValues: Record<string, number> = {};
  
  positions.forEach(pos => {
    myPositionCounts[pos] = 0;
    myPositionValues[pos] = 0;
  });
  
  // Count players for ALL eligible positions (dual eligibility matters!)
  myTeam.roster.forEach(player => {
    const eligiblePositions = player.position.split("/"); // e.g., "C/RW" -> ["C", "RW"]
    eligiblePositions.forEach(pos => {
      if (myPositionCounts[pos] !== undefined) {
        myPositionCounts[pos]++;
        myPositionValues[pos] += player.value;
      }
    });
  });
  
  // Calculate average values per position
  const myAvgValues: Record<string, number> = {};
  positions.forEach(pos => {
    myAvgValues[pos] = myPositionCounts[pos] > 0 ? myPositionValues[pos] / myPositionCounts[pos] : 0;
  });
  
  // Build the prompt
  return `You are an expert fantasy hockey trade analyzer. Analyze trades that would improve the user's team.

⚠️ CRITICAL: Players have DUAL POSITION ELIGIBILITY in fantasy hockey!
- A player listed as "C/RW" can play BOTH center AND right wing
- When counting depth: "C/RW" adds +1 to C count AND +1 to RW count
- Example: Team with "6 C-eligible" might be: 2 pure C, 3 C/RW, 1 C/LW (not 6 pure centers!)
- Always consider this when analyzing roster construction and trade needs

## USER'S TEAM: "${myTeam.name}" ${myTeam.managerName ? `(Manager: ${myTeam.managerName})` : ""}

### Roster Summary (${myTeam.roster.length} total players):
${positions.map(pos => `- ${pos}: ${myPositionCounts[pos]} eligible players, Avg Value: ${myAvgValues[pos].toFixed(1)}`).join("\n")}

Note: Counts above reflect ALL players eligible for that position (dual-eligible players counted in multiple positions).

### COMPLETE ROSTER LIST (All ${myTeam.roster.length} players):
${myTeam.roster
  .sort((a, b) => b.value - a.value)
  .map((p, i) => `${i+1}. ${p.name} - Position(s): ${p.position} - NHL Team: ${p.nhlTeam} - Value: ${p.value.toFixed(1)}${p.status ? ` [STATUS: ${p.status}]` : ""}`)
  .join("\n")}

### Position-Specific Lists (for clarity):
${positions.map(pos => {
  const players = myTeam.roster.filter(p => p.position.includes(pos)).sort((a, b) => b.value - a.value);
  return `\n${pos}-Eligible Players (${players.length} total):\n${players.map(p => `  • ${p.name} [${p.position}] - ${p.value.toFixed(1)}${p.status ? ` [${p.status}]` : ""}`).join("\n")}`;
}).join("\n")}

### Draft Picks:
${myTeam.draftPicks.length > 0 ? `Rounds: ${myTeam.draftPicks.sort((a, b) => a - b).join(", ")}` : "None"}

---

## OTHER TEAMS IN LEAGUE (${otherTeams.length} teams):

${otherTeams.map(team => {
  // Count position eligibility for this team (dual-eligible players count for multiple positions)
  const teamPosCounts: Record<string, number> = {};
  positions.forEach(pos => teamPosCounts[pos] = 0);
  team.roster.forEach(player => {
    player.position.split("/").forEach(pos => {
      if (teamPosCounts[pos] !== undefined) teamPosCounts[pos]++;
    });
  });
  
  return `
### ${team.name} ${team.managerName ? `(${team.managerName})` : ""}
Total Roster Value: ${team.totalValue.toFixed(1)}
Position Counts: ${positions.map(pos => `${pos}: ${teamPosCounts[pos]}`).join(", ")}
Draft Picks: ${team.draftPicks.length > 0 ? `Rounds ${team.draftPicks.sort((a, b) => a - b).join(", ")}` : "None"}

Top 10 Players:
${team.roster.sort((a, b) => b.value - a.value).slice(0, 10).map((p, i) => 
  `${i+1}. ${p.name} [${p.position}] ${p.nhlTeam} - ${p.value.toFixed(1)}${p.status ? ` [${p.status}]` : ""}`
).join("\n")}

Position Breakdown:
${positions.map(pos => {
  const players = team.roster.filter(p => p.position.includes(pos));
  if (players.length === 0) return `${pos}: None`;
  return `${pos} (${players.length}): ${players.sort((a, b) => b.value - a.value).map(p => `${p.name}[${p.position}]`).join(", ")}`;
}).join("\n")}
`;
}).join("\n")}

---

## TASK:

Suggest 3-5 realistic trade opportunities that would IMPROVE the user's team ("${myTeam.name}").

### STRICT RULES:
1. **READ THE COMPLETE ROSTER LISTS ABOVE CAREFULLY** - Don't make false claims about position scarcity
2. **Value balance**: Net gain must be between -10 and +15 points (no terrible trades!)
3. **Both teams must benefit** - Explain why BOTH sides would want this trade
4. **Use actual player names** from the rosters above only
5. **Consider dual eligibility correctly**:
   - A player listed as "C/RW" can play BOTH C and RW
   - Don't say "only 1 RW" if there are multiple RW-eligible players
   - Check the Position Breakdown sections for each team
6. **Focus on realistic needs**:
   - Surplus position (5+ eligible) = can afford to trade
   - Weak position (1-2 eligible) = needs help
   - Injured players (IR, DTD) = buy low opportunity
7. **NO TERRIBLE TRADES**: Don't suggest -80 point losses!

### For Each Suggestion:
1. **Strategic Fit**: What does each team actually need based on the Position Breakdown?
2. **Fair Value**: Within ±15 points maximum
3. **Mutual Benefit**: Both teams improve in some way
4. **Specific Players**: Use exact names from rosters above

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

