/**
 * Profile-Based Trade Analyzer
 * 
 * Uses cached TeamProfiles with dual-eligibility awareness and category analysis
 * to generate intelligent trade suggestions.
 */

import type { TeamProfile, Player } from "./teamProfile";

// ============================================================================
// TYPES
// ============================================================================

export interface TradeSuggestion {
  confidence: "low" | "medium" | "high";
  partnerTeamId: string;
  partnerTeamName: string;
  youGive: string[];
  youGet: string[];
  valueDelta: number;
  categoryImpact: string[];
  positionImpact: string;
  reasoning: string;
}

interface AIPayload {
  league: {
    categories: {
      skater: string[];
      goalie: string[];
    };
  };
  teamProfiles: {
    teamId: string;
    teamName: string;
    positions: Record<string, { count: number; surplusScore: number }>;
    flexSkaters: number;
    skaterCategories: Record<string, { zScore: number; strength: string }>;
    goalieCategories: Record<string, { zScore: number; strength: string }>;
  }[];
  players: {
    id: string;
    name: string;
    teamId: string;
    positions: string[];
    nhlTeam: string;
    valueBase: number;
    valueKeeper: number;
    categories: Record<string, number>;
  }[];
  targetTeamId: string;
}

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are an expert fantasy hockey trade analyzer. Your job is to suggest realistic, mutually beneficial trades for a target team.

## Core Algorithm

1. **Identify Target Team Needs:**
   - Find the 3 weakest skater categories (lowest z-scores)
   - Find the weakest goalie categories
   - Find positional shortages (surplusScore < -0.7)
   - Note positional surpluses (surplusScore > +0.7)

2. **Find Compatible Trade Partners:**
   - Look for teams that are strong where target is weak
   - And weak where target is strong (they need what you have)
   - Prioritize teams with complementary surpluses and shortages

3. **Generate Trade Candidates:**
   - Consider 1-for-1, 2-for-1, and 2-for-2 trades only
   - Players must have valueBase >= 100 OR directly help a weak category
   - Do NOT suggest trades involving low-impact players (value < 90) unless they fill a critical category hole

4. **Apply Positional Safety Checks:**
   - After the trade, BOTH teams must maintain minimum position counts:
     - C >= 3.0 (using fractional counting for multi-position players)
     - LW >= 3.0
     - RW >= 3.0
     - D >= 4.0
     - G >= 3.0
   - Reject any trade that violates these minimums for either team

5. **Calculate Trade Score:**
   - valueDelta = (keeper value gained by target) - (keeper value lost by target)
   - categoryGain = sum of improvements in target's weak categories (scale -12 to +12)
   - positionFix = bonus if trade fixes positional shortage for both teams
   - **Trade Score = valueDelta × 1.0 + categoryGain × 2.5 + positionFix**
   - Prioritize category fit over pure value

6. **Elite Trade Protection:**
   - If target team is trading away an elite player (valueKeeper >= 160):
     - Only allow if target gets back similar value (within 10%) OR massive category gain (>= 10 points)
   - Block downgrades from elite to non-elite unless category gain is exceptional

7. **Output Requirements:**
   - Return 3-5 best trades ranked by trade score
   - Each suggestion must include:
     - Who trades with whom
     - Players sent and received
     - Net value change for each team
     - Category improvements for target team (specific categories with gains)
     - Positional balance changes (using dual eligibility language)
     - Confidence score: "low" (risky but potentially valuable), "medium" (balanced), "high" (clear win-win)

## Important Rules

- **Never suggest garbage trades:** Both teams must improve their weakest areas
- **Respect dual eligibility:** A C/RW counts as 0.5 C and 0.5 RW
- **Favor category fit:** A trade that fixes a weak category is better than a pure value swap
- **No sidegrade spam:** If valueDelta is between -6 and +6 AND no category gain, reject it
- **Keeper context matters:** Fresh 3-year keepers are more valuable than expiring keepers, even if base value is similar

## Response Format

Return a JSON array of trade suggestions. Each entry must have:

\`\`\`json
{
  "confidence": "high" | "medium" | "low",
  "partnerTeamName": "Team Name",
  "youGive": ["Player A", "Player B"],
  "youGet": ["Player C"],
  "valueDelta": 5.2,
  "categoryImpact": ["Blocks +15%", "Hits +10%"],
  "positionImpact": "Strengthens RW (0.5), maintains C (0.5 loss offset by flexibility)",
  "reasoning": "This trade addresses your weak Blocks and Hits categories by acquiring [Player], who excels in physical play. You're giving up [Player A/B] who are surplus in categories you're already strong in. Positional balance is maintained due to dual eligibility."
}
\`\`\`

Focus on trades that make strategic sense for H2H category leagues, not just mathematical value swaps.`;

// ============================================================================
// PAYLOAD BUILDER
// ============================================================================

export function buildAIPayload(
  profiles: TeamProfile[],
  players: Player[],
  targetTeamId: string
): AIPayload {
  // Compact team profiles
  const compactProfiles = profiles.map(p => ({
    teamId: p.teamId,
    teamName: p.teamName,
    positions: p.positions,
    flexSkaters: p.flexSkaters,
    skaterCategories: p.skaterCategories,
    goalieCategories: p.goalieCategories,
  }));

  // Compact player data
  const compactPlayers = players.map(p => ({
    id: p.id,
    name: p.name,
    teamId: p.teamId,
    positions: p.positions,
    nhlTeam: p.nhlTeam,
    valueBase: Math.round(p.valueBase * 10) / 10,
    valueKeeper: Math.round(p.valueKeeper * 10) / 10,
    categories: p.categories,
  }));

  return {
    league: {
      categories: {
        skater: ["G", "A", "P", "plusMinus", "PIM", "PPP", "SHP", "GWG", "SOG", "FW", "HIT", "BLK"],
        goalie: ["W", "GAA", "SV", "SVPct", "SHO"],
      },
    },
    teamProfiles: compactProfiles,
    players: compactPlayers,
    targetTeamId,
  };
}

// ============================================================================
// AI CALL
// ============================================================================

export async function analyzeTrades(
  targetTeamId: string,
  profiles: TeamProfile[],
  players: Player[]
): Promise<TradeSuggestion[]> {
  const payload = buildAIPayload(profiles, players, targetTeamId);
  
  const targetProfile = profiles.find(p => p.teamId === targetTeamId);
  if (!targetProfile) {
    throw new Error("Target team profile not found");
  }

  console.log("[AI Trade Analyzer] Analyzing trades for:", targetProfile.teamName);
  console.log("[AI Trade Analyzer] Target weak categories:", 
    Object.entries(targetProfile.skaterCategories)
      .filter(([_, cat]) => cat.strength === "weak")
      .map(([name]) => name)
  );

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: `Analyze trade opportunities for the target team. Here is the league data:\n\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[AI Trade Analyzer] API error:", response.status, errorText);
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("[AI Trade Analyzer] Raw AI response:", content);

    // Parse JSON from response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("[AI Trade Analyzer] Could not find JSON in response:", content);
      throw new Error("AI response did not contain valid JSON");
    }

    const jsonString = jsonMatch[1] || jsonMatch[0];
    const suggestions: TradeSuggestion[] = JSON.parse(jsonString);

    // Enrich suggestions with teamIds
    const enrichedSuggestions = suggestions.map(s => {
      const partnerProfile = profiles.find(p => 
        p.teamName.toLowerCase() === s.partnerTeamName.toLowerCase()
      );
      return {
        ...s,
        partnerTeamId: partnerProfile?.teamId || "",
      };
    });

    console.log("[AI Trade Analyzer] Generated", enrichedSuggestions.length, "suggestions");

    return enrichedSuggestions;

  } catch (error) {
    console.error("[AI Trade Analyzer] Error calling AI:", error);
    throw error;
  }
}

