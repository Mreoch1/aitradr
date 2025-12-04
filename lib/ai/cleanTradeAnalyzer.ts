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

export interface TradeAsset {
  type: "player" | "pick";
  name: string;
  value: number;
  round?: number; // For picks
}

export interface TradeSuggestion {
  partnerTeam: string;
  youGive: TradeAsset[];
  youGet: TradeAsset[];
  netValue: number;
  categoryImpact: string[];
  keeperImpact: string;
  explanation: string;
  confidence: "High" | "Medium" | "Speculative";
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates that a trade suggestion has valid structure and data
 * SOFT QUALITY PASS: Only rejects true garbage, allows legitimate trades
 */
function isValidSuggestion(suggestion: TradeSuggestion): boolean {
  // Must have a partner team name
  if (!suggestion.partnerTeam || suggestion.partnerTeam.trim() === "") {
    console.warn("[Clean AI] Rejected: Missing partner team");
    return false;
  }
  
  // Must have assets on both sides
  if (!suggestion.youGive || suggestion.youGive.length === 0) {
    console.warn("[Clean AI] Rejected: No assets given");
    return false;
  }
  if (!suggestion.youGet || suggestion.youGet.length === 0) {
    console.warn("[Clean AI] Rejected: No assets received");
    return false;
  }
  
  // Kill "undefined" in asset names
  const allAssets = [...suggestion.youGive, ...suggestion.youGet];
  if (allAssets.some(asset => !asset.name || asset.name.toLowerCase().includes("undefined"))) {
    console.warn("[Clean AI] Rejected: Asset name contains 'undefined'");
    return false;
  }
  
  // Kill NaN/Infinity values
  if (allAssets.some(asset => !Number.isFinite(asset.value))) {
    console.warn("[Clean AI] Rejected: Asset has NaN or Infinity value");
    return false;
  }
  
  // Net value should be a finite number (but can be negative, zero, or positive)
  if (!Number.isFinite(suggestion.netValue)) {
    console.warn("[Clean AI] Rejected: NaN netValue");
    return false;
  }
  
  return true;
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

VALIDATION RULES (CRITICAL):
You must NOT output a trade if:
- The partner team name is missing or blank
- Either side has zero assets
- All assets on both sides have value <= 0
- Any asset label contains the word "undefined"
- A draft pick is missing its round number

If a candidate trade in the input violates any of these rules, treat it as invalid and exclude it from your final suggestions.

You should only produce suggestions that move at least one real player or a clearly defined draft pick with a valid round (1 to 16) and a positive value.

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

Return JSON array with assets as objects (NOT strings):

\`\`\`json
[
  {
    "partnerTeam": "Team Name",
    "youGive": [
      { "type": "player", "name": "Player A", "value": 123.4 }
    ],
    "youGet": [
      { "type": "player", "name": "Player B", "value": 128.6 }
    ],
    "netValue": 5.2,
    "categoryImpact": ["Blocks +15%", "Hits +10%"],
    "keeperImpact": "Trading expiring keeper for fresh 3-year control",
    "explanation": "This addresses your weak Blocks and Hits by acquiring Player B who excels in physical play. You're giving up Player A who contributes to categories you're already strong in.",
    "confidence": "High"
  }
]
\`\`\`

For each asset in youGive/youGet:
- type: "player" or "pick"
- name: Player name, or round number (as string "3") for picks
- value: Numeric value from input data
- round: (picks only) Round number as integer

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
  
  // Validate profile structure
  if (!myTeam.profile || !myTeam.profile.categories || !myTeam.profile.positions) {
    console.error("[Clean AI] Invalid profile structure:", myTeam.profile);
    throw new Error("Team profile is missing required data. Please refresh your data.");
  }
  
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

    console.log("🔥 AI: Raw candidates generated:", suggestions.length);
    
    // Log first few suggestions for debugging
    if (suggestions.length > 0) {
      console.log("🔥 First suggestion sample:", JSON.stringify(suggestions[0], null, 2));
    }
    
    // Filter out invalid suggestions (only true garbage, not close-value trades)
    const validSuggestions = suggestions.filter(isValidSuggestion);
    
    console.log("🔥 AI: Surviving after validation:", validSuggestions.length);
    
    if (validSuggestions.length === 0 && suggestions.length > 0) {
      console.error("🔥 ⚠️ ALL SUGGESTIONS FILTERED OUT!");
      console.error("🔥 Sample rejected suggestion:", JSON.stringify(suggestions[0], null, 2));
    }
    
    if (suggestions.length === 0) {
      console.error("🔥 ⚠️ AI RETURNED ZERO SUGGESTIONS - Model didn't generate any trades!");
    }
    
    return validSuggestions;

  } catch (error) {
    console.error("[Clean AI] Error:", error);
    throw error;
  }
}

