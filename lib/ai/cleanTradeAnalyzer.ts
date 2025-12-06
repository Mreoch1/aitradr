/**
 * Clean AI Trade Analyzer
 * 
 * Consumes pre-built team profiles and player data.
 * Does NOT recalculate values or stats.
 * Focuses on trade discovery and reasoning.
 */

import type { TeamProfile } from "./teamProfile";
import { computeConfidence, calculateCategoryScore } from "./confidenceScoring";

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
  
  // FIX #1: Hard Loss Floor - prevent massive losing trades
  if (suggestion.netValue < -12) {
    console.warn("[Clean AI] Rejected: Net loss > 12 points (", suggestion.netValue, ")");
    return false;
  }
  
  // Tighter floor for elite losses
  const givingElitePlayers = suggestion.youGive.filter(a => a.value >= 140);
  if (givingElitePlayers.length > 0 && suggestion.netValue < -7) {
    console.warn("[Clean AI] Rejected: Trading elite player (>= 140) with net loss > 7 (", suggestion.netValue, ")");
    return false;
  }
  
  // FIX #4: Elite Anchor Constraint
  // Prevent elite scorer downgrades (Caufield → Wilson scenarios)
  const ELITE_SCORING_THRESHOLD = 145;
  const MINIMUM_RETURN_THRESHOLD = 135;
  
  const givingEliteScorer = suggestion.youGive.some(a => a.value >= ELITE_SCORING_THRESHOLD);
  const receivingEliteScorer = suggestion.youGet.some(a => a.value >= MINIMUM_RETURN_THRESHOLD);
  const receivingMultiplePlayers = suggestion.youGet.filter(a => a.type === "player").length >= 2;
  const significantNetGain = suggestion.netValue > 15;
  
  if (givingEliteScorer && !receivingEliteScorer && !receivingMultiplePlayers && !significantNetGain) {
    console.warn("[Clean AI] Rejected: Trading elite scorer (>= 145) without elite return");
    return false;
  }
  
  return true;
}

// ============================================================================
// SYSTEM PROMPT (FOLLOWING USER SPEC)
// ============================================================================

const SYSTEM_PROMPT = `You are the AI trade-analysis engine for AITRADR.

The backend provides:
- Precomputed per-player values
- Keeper-adjusted values
- Per-team category z-scores (normalized to league)
- Team category strengths/weaknesses
- Dual-position eligibility
- Keeper years remaining and control premium
- Daily refreshed stats

You DO NOT calculate player values.
You DO NOT fetch data.
You ONLY reason from provided data.

# YOUR TASK

Generate TRADE SUGGESTIONS for the target team that:
1. Improve at least one WEAK category (z-score < -0.85)
2. Match team weaknesses to partner team surpluses
3. Be reasonably beneficial for BOTH teams
4. Respect positional balance and roster construction
5. Follow keeper economics
6. Obey elite-player protection rules
7. Avoid garbage trades and placeholders

# TRADE CONSTRUCTION

Trade types allowed:
- 1-for-1
- 2-for-1
- 2-for-2
- 3-for-2
- Picks allowed only if they meaningfully improve balance

Each trade must:
- Address at least one category weakness
- Come from another team's surplus
- Be position-valid after trade
- Not destroy roster depth

# ELITE PROTECTION RULES

## Hard Loss Floor (FIX #1):
- NEVER suggest trades with netValue < -12
- IF trading elite player (valueBase >= 140), netValue must be >= -7
- No massive losing trades allowed

## Offense Floor (FIX #2):
- IF outgoing player valueBase >= 130
- AND incoming player does NOT improve Goals, Assists, or PPP
- THEN reject the trade
- Elite scorers must only go for other scorers or multi-player packages

## Elite Anchor Constraint (FIX #4):
IF sending away elite scorer (valueBase >= 145) THEN:
- Incoming package MUST be:
  - EITHER elite return (valueBase >= 135)
  - OR multiple strong players (2+ players with collective value match)
  - OR significant net gain (> 15 points)

NEVER trade:
- Elite scorer for banger only (Caufield → Wilson)
- Franchise piece for depth (McDavid → Reinhart)
- Top-line talent for pure hits/PIM player (Hughes → Tom Wilson)

# KEEPER LOGIC

Keeper values are already computed. But enforce:

IF player is NOT true elite scorer (baseValue < 135):
- Control premium should be minimal
- Keeper bonus capped at 35% of base value

1-year keepers cannot outrank multi-year elite unless base value is similar.

Cap any keeper total at: keeperAdjusted <= baseValue × 1.45

# CATEGORY WEIGHT GUARDRAILS

Scoring categories > grind categories.

IF Hits/PIM/Blocks dominate trade impact:
- Degrade net trade score

Grinders cannot outrank offensive stars.

## Category Compensation Cap (FIX #5):
- Category gain may NOT compensate for more than 40% of value loss
- Example: If valueLoss = 50, categoryGain can offset MAX 20 points
- Anything beyond this = rejected
- You cannot trade Jack Hughes for Tom Wilson just because "Hits +50%"

## Banger Ceiling:
- Pure grinders (primary value from HIT/PIM/BLK) max value = 130
- No pure hitter should exceed 130 value

NEVER allow:
- Tom Wilson > Cole Caufield
- Kiefer Sherwood > Artemi Panarin
- Sam Reinhart > Connor McDavid

# REJECTION RULES

Discard trade if:
- Player name missing or contains "undefined"
- Draft pick round undefined or < 1 or > 16
- Any player value < 90 unless explicitly fixes weak category
- Trade worsens existing weak category
- Trade destroys positional balance
- Pure value-wash with no strategic gain
- "Bangers for star" swap
- Position shift without category benefit
- Both sides worthless (all values < 10)

# OUTPUT FORMAT (STRICT)

Return exactly this JSON array:

\`\`\`json
[
  {
    "partnerTeam": "Team Name",
    "youGive": [
      { "type": "player", "name": "Player Name", "value": 123.4 },
      { "type": "pick", "name": "3", "value": 45.0, "round": 3 }
    ],
    "youGet": [
      { "type": "player", "name": "Player Name", "value": 134.5 }
    ],
    "netValue": 11.1,
    "categoryImpact": ["Goals +12%", "Assists +8%"],
    "keeperImpact": "Trading expiring keeper for 2-year control",
    "explanation": "This addresses your weak Goals and Assists by acquiring Player Name who excels in offensive categories. You're giving up a player and pick from areas where you have surplus.",
    "confidence": "High"
  }
]
\`\`\`

For each asset:
- type: "player" or "pick"
- name: Player name OR round number as string for picks
- value: Numeric value from input data
- round: (picks only) Integer 1-16

Confidence: High | Medium | Speculative (only these three)

Note: Confidence will be recalculated based on realism. Use these guidelines:
- High: Fair trades (netValue between -5 and +15)
- Medium: Moderate advantage (-5 to -12, or +15 to +30)
- Speculative: Lopsided (> 30 point swing) or risky

# TRADING PHILOSOPHY

Think like a human GM:
- Match weaknesses to surplus
- Trade stars for stars
- Trade bangers only if category dominant
- Prefer lineup optimization over raw value
- Never recommend veto-bait trades (> 50 value difference)
- Consider league landscape and trade acceptance likelihood
- Do not force trades
- Fair trades > robbery attempts

## Realism Filters:
- Trades with > 90 value difference will be auto-filtered as unrealistic
- Trades with > 50 value difference will be marked "Speculative"
- Losing trades (netValue < 0) capped at "Medium" confidence

Return 3-5 best suggestions ranked by strategic fit and realism.`;

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
    
    // Recalculate confidence using realistic scoring (not AI's opinion)
    const suggestionsWithRealConfidence = validSuggestions.map(s => {
      const categoryScore = calculateCategoryScore(s.categoryImpact || []);
      const newConfidence = computeConfidence({
        netValue: s.netValue,
        categoryScore,
      });
      
      console.log(`[Clean AI] Confidence for ${s.partnerTeam}: netValue=${s.netValue}, categoryScore=${categoryScore.toFixed(2)}, AI said "${s.confidence}", Calculated="${newConfidence}"`);
      
      return {
        ...s,
        confidence: newConfidence,
      };
    });
    
    // Filter out unrealistic trades (huge lopsided wins that would never be accepted)
    // Trades with > 40 net value are very unlikely to be accepted in real leagues
    const realisticSuggestions = suggestionsWithRealConfidence.filter(s => {
      // Block trades that are TOO lopsided (> 40 value difference) - these are veto-bait
      if (Math.abs(s.netValue) > 40) {
        console.warn("[Clean AI] Filtered: Trade too lopsided (netValue:", s.netValue, ") - unlikely to be accepted");
        return false;
      }
      
      // For trades with > 25 net value, mark as Speculative but still show
      // (confidence scoring already handles this)
      
      return true;
    });
    
    console.log("🔥 AI: Final suggestions after realism filter:", realisticSuggestions.length);
    
    return realisticSuggestions;

  } catch (error) {
    console.error("[Clean AI] Error:", error);
    throw error;
  }
}

