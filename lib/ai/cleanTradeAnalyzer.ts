/**
 * Clean AI Trade Analyzer
 * 
 * Consumes pre-built team profiles and player data.
 * Does NOT recalculate values or stats.
 * Focuses on trade discovery and reasoning.
 */

import type { TeamProfile } from "./teamProfile";

// ============================================================================
// TYPES
// ============================================================================

export interface PlayerForAI {
  id: string;
  name: string;
  positions: string[];
  nhlTeam: string;
  valueBase: number;
  valueKeeper: number;
  isKeeper: boolean;
  yearsRemaining?: number;
  originalDraftRound?: number;
  categories: {
    G?: number;
    A?: number;
    P?: number;
    plusMinus?: number;
    PIM?: number;
    PPP?: number;
    SHP?: number;
    GWG?: number;
    SOG?: number;
    FW?: number;
    HIT?: number;
    BLK?: number;
    W?: number;
    GAA?: number;
    SV?: number;
    SVPct?: number;
    SHO?: number;
  };
}

export interface TeamForAI {
  id: string;
  name: string;
  roster: PlayerForAI[];
  profile: TeamProfile;
}

export interface TradeSuggestion {
  partnerTeam: string;
  youGive: string[];
  youGet: string[];
  netValue: number;
  categoryImpact: string[];
  keeperImpact: string;
  explanation: string;
  confidence: "High" | "Medium" | "Speculative";
}

// ============================================================================
// SYSTEM PROMPT (FOLLOWING USER SPEC)
// ============================================================================

const SYSTEM_PROMPT = `You are a fantasy hockey trade analyzer. You consume pre-calculated data and suggest trades.

DO NOT:
- Recalculate player values
- Invent stats
- Use randomness
- Suggest laughable trades
- Force positional trades without category need
- Value P, FW, or HIT higher than G or PPP
- Duplicate symmetrical trades
- Harm both teams

DO:
- Identify weak categories (z-score < -0.85)
- Identify strong categories (z-score > +0.85)
- Match teams: strong where partner is weak, weak where partner is strong
- Consider keeper leverage (expiring vs fresh multi-year control)
- Improve category balance
- Respect positional constraints

## Trade Generation

Generate 1-for-1, 2-for-1, or 2-for-2 trades that:
1. Improve at least one weak category for target team
2. Don't reduce two strong categories at once
3. Don't downgrade keeper control without compensation
4. Don't break positional minimums (C/LW/RW >= 3.0, D >= 4.0, G >= 3.0)

## Trade Filtering

Reject trades that:
- Have net loss > 8 AND no category gain
- Break positional constraints
- Trade elite keepers without compensation
- Suggest filler players (value < 90) with no category improvement
- Pure value downgrades without keeper or category justification

## Scoring

score = valueDelta + (categoryGain × 2.5) + keeperImpact

Return top 5 trades ranked by score.

## Trade Reasoning

Each suggestion must explain:
- What problem it solves
- Why partner team accepts
- Whether it's a value/structure/category/keeper win
- Use clear, direct language (no robotic phrasing)

## Output Format

Return JSON array:

\`\`\`json
[
  {
    "partnerTeam": "Team Name",
    "youGive": ["Player A"],
    "youGet": ["Player B"],
    "netValue": 5.2,
    "categoryImpact": ["Blocks +15%", "Hits +10%"],
    "keeperImpact": "Trading expiring keeper for fresh 3-year control",
    "explanation": "This addresses your weak Blocks and Hits by acquiring Player B who excels in physical play. You're giving up Player A who contributes to categories you're already strong in.",
    "confidence": "High"
  }
]
\`\`\`

Confidence levels: High | Medium | Speculative (use only these three)

Focus on H2H category strategy, not pure value swaps.`;

// ============================================================================
// PAYLOAD BUILDER
// ============================================================================

function buildPayload(myTeam: TeamForAI, allTeams: TeamForAI[]): any {
  return {
    myTeam: {
      id: myTeam.id,
      name: myTeam.name,
      roster: myTeam.roster.map(p => ({
        id: p.id,
        name: p.name,
        positions: p.positions,
        nhlTeam: p.nhlTeam,
        valueBase: Math.round(p.valueBase * 10) / 10,
        valueKeeper: Math.round(p.valueKeeper * 10) / 10,
        isKeeper: p.isKeeper,
        yearsRemaining: p.yearsRemaining,
        categories: p.categories,
      })),
      positions: myTeam.profile.positions,
      categories: myTeam.profile.categories,
      keepers: myTeam.profile.keepers,
      flexSkaters: myTeam.profile.flexSkaters,
    },
    allTeams: allTeams
      .filter(t => t.id !== myTeam.id)
      .map(t => ({
        id: t.id,
        name: t.name,
        roster: t.roster.map(p => ({
          id: p.id,
          name: p.name,
          positions: p.positions,
          valueBase: Math.round(p.valueBase * 10) / 10,
          valueKeeper: Math.round(p.valueKeeper * 10) / 10,
          isKeeper: p.isKeeper,
          yearsRemaining: p.yearsRemaining,
        })),
        positions: t.profile.positions,
        categories: t.profile.categories,
        keepers: t.profile.keepers,
      })),
    leagueSettings: {
      categories: {
        skater: ["G", "A", "P", "+/-", "PIM", "PPP", "SHP", "GWG", "SOG", "FW", "HIT", "BLK"],
        goalie: ["W", "GAA", "SV", "SV%", "SHO"],
      },
      rosterSlots: {
        C: 3, LW: 3, RW: 3, D: 4, G: 3,
      },
      keeperRules: {
        maxYears: 3,
        tiers: { A: [1, 4], B: [5, 10], C: [11, 16] },
      },
    },
  };
}

// ============================================================================
// AI CALL
// ============================================================================

export async function analyzeTrades(
  myTeam: TeamForAI,
  allTeams: TeamForAI[]
): Promise<TradeSuggestion[]> {
  const payload = buildPayload(myTeam, allTeams);

  console.log("[Clean AI] Analyzing trades for:", myTeam.name);
  console.log("[Clean AI] Weak categories:", 
    Object.entries(myTeam.profile.categories)
      .filter(([_, z]) => z < -0.85)
      .map(([cat]) => cat)
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
          { role: "system", content: SYSTEM_PROMPT },
          { 
            role: "user", 
            content: `Analyze trade opportunities. Data:\n\n${JSON.stringify(payload, null, 2)}`
          },
        ],
        temperature: 0.7,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error("No content in AI response");
    }

    console.log("[Clean AI] Raw response:", content.substring(0, 200));

    // Parse JSON from response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("[Clean AI] Could not find JSON in response");
      throw new Error("AI response did not contain valid JSON");
    }

    const jsonString = jsonMatch[1] || jsonMatch[0];
    const suggestions: TradeSuggestion[] = JSON.parse(jsonString);

    console.log("[Clean AI] Generated", suggestions.length, "suggestions");
    return suggestions;

  } catch (error) {
    console.error("[Clean AI] Error:", error);
    throw error;
  }
}

