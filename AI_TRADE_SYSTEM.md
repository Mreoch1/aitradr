# AI Trade Suggestions System v2

## Overview

This document describes the profile-based AI trade suggestion system implemented in AiTradr. This system uses cached team analysis, dual-eligibility position counting, and category-aware trade matching to generate intelligent, realistic trade suggestions.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     DAILY DATA REFRESH                       │
│  (Force Sync / Stats Sync)                                  │
│                                                              │
│  1. Sync Yahoo rosters                                      │
│  2. Sync player stats                                       │
│  3. Calculate player values (z-scores)                      │
│  4. Populate keeper data                                    │
│  5. Build & cache TeamProfiles ◄─── NEW                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   TEAM PROFILE CACHE                         │
│  (Stored in database as JSON)                               │
│                                                              │
│  For each team:                                             │
│  • Position counts (with dual eligibility fractional)       │
│  • Position surplus/shortage scores                         │
│  • Category z-scores (12 skater, 5 goalie)                 │
│  • Category strengths (strong/neutral/weak)                 │
│  • Flex skater count (multi-position players)              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  AI TRADE SUGGESTIONS                        │
│  (Called when user clicks "Get AI Suggestions")            │
│                                                              │
│  1. Load cached TeamProfiles                                │
│  2. Build player pool with keeper values                    │
│  3. Send structured payload to AI                           │
│  4. AI analyzes with sophisticated algorithm                │
│  5. Return 3-5 best trade suggestions                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Dual-Eligibility Position Counting

**Problem:** Traditional counting treats a C/RW as a full C and a full RW, inflating roster size.

**Solution:** Fractional counting with eligibility weights.

**Algorithm:**
```typescript
for each player:
  weight = 1 / player.positions.length
  for each position in player.positions:
    positions[position].count += weight
```

**Examples:**
- **Pure C:** Counts as 1.0 C
- **C/RW:** Counts as 0.5 C + 0.5 RW
- **C/LW/RW:** Counts as 0.33 C + 0.33 LW + 0.33 RW

**Flex Bonus:** Teams with many multi-position players get a small flexibility bonus (+0.1 per flex skater) when calculating positional surplus.

---

### 2. Position Surplus/Shortage

**Formula:**
```
surplusScore = teamPositionCount - leagueAvgPositionCount + (0.1 × flexSkaters)
```

**Classification:**
- **Surplus:** surplusScore > +0.7 (team has more than average)
- **Neutral:** -0.7 ≤ surplusScore ≤ +0.7
- **Shortage:** surplusScore < -0.7 (team has fewer than average)

**Example:**
- League average C: 4.2
- Team has: 3.5 C (from fractional counting)
- Flex skaters: 5
- surplusScore = 3.5 - 4.2 + (0.1 × 5) = -0.2 (neutral)

---

### 3. Category Strength Analysis

**Z-Score Calculation:**
```
zScore = (teamTotal - leagueMean) / leagueStdDev
```

**Classification:**
- **Strong:** zScore ≥ +0.75 (top third of league)
- **Neutral:** -0.75 < zScore < +0.75 (middle third)
- **Weak:** zScore ≤ -0.75 (bottom third)

**Categories Tracked:**
- **Skaters (12):** G, A, P, +/-, PIM, PPP, SHP, GWG, SOG, FW, HIT, BLK
- **Goalies (5):** W, GAA, SV, SV%, SHO

---

### 4. AI Algorithm

The AI follows this decision tree:

#### Step 1: Identify Target Team Needs
```
weak_categories = categories where zScore <= -0.75
positional_shortages = positions where surplusScore < -0.7
positional_surpluses = positions where surplusScore > +0.7
```

#### Step 2: Find Compatible Trade Partners
```
for each other_team:
  if other_team is_strong_where(target is_weak)
     AND other_team is_weak_where(target is_strong):
       add to compatible_partners
```

#### Step 3: Generate Trade Candidates
```
Rules:
- Only 1-for-1, 2-for-1, or 2-for-2 trades
- Players must have valueBase >= 100 OR fill a critical category need
- No "garbage" players (value < 90) unless filling a massive hole
```

#### Step 4: Apply Positional Safety Checks
```
After trade simulation, BOTH teams must maintain:
- C >= 3.0 (fractional)
- LW >= 3.0
- RW >= 3.0
- D >= 4.0
- G >= 3.0

If violated, reject the trade.
```

#### Step 5: Score the Trade
```
valueDelta = (keeper value gained) - (keeper value lost) by target
categoryGain = sum of improvements in target's weak categories (-12 to +12 scale)
positionFix = bonus if both teams fix a positional shortage

tradeScore = valueDelta × 1.0 + categoryGain × 2.5 + positionFix

Interpretation:
- Category fit is 2.5x more important than pure value
- Positional fixes add bonus points
```

#### Step 6: Elite Trade Protection
```
if target is trading away elite player (valueKeeper >= 160):
  if valueDelta < -10% AND categoryGain < 10:
    reject trade (blocks elite downgrades)
```

#### Step 7: Anti-Sidegrade Filter
```
if abs(valueDelta) < 6 AND categoryGain <= 2:
  reject trade (no meaningless swaps)
```

---

## Trade Scoring Examples

### Example 1: Category-Fixing Trade (High Score)

**Trade:**
- You give: Caufield (value 157, strong in G/PPP)
- You get: Seider (value 145, strong in BLK/HIT)

**Analysis:**
- valueDelta = -12 (losing value)
- categoryGain = +15 (you're weak in BLK/HIT, strong in G/PPP)
- positionFix = +5 (both teams improve positional balance)

**Trade Score = -12 × 1.0 + 15 × 2.5 + 5 = 30.5** ✅ Good Trade

**Reasoning:** Despite losing raw value, you're fixing two weak categories and improving positional flexibility. The category gain more than compensates for the value loss.

---

### Example 2: Pure Value Swap (Low Score)

**Trade:**
- You give: Larkin (value 155)
- You get: Rantanen (value 156)

**Analysis:**
- valueDelta = +1 (negligible)
- categoryGain = -2 (you're already strong in categories Rantanen provides)
- positionFix = 0 (no positional improvement)

**Trade Score = 1 × 1.0 + (-2) × 2.5 + 0 = -4** ❌ Rejected (sidegrade)

**Reasoning:** This is a cosmetic swap. No strategic value. Both players provide similar categories you're already strong in.

---

### Example 3: Elite Downgrade (Blocked)

**Trade:**
- You give: McDavid (value 165, keeper)
- You get: Suzuki (value 152) + Hagel (value 154)

**Analysis:**
- valueDelta = +141 (massive gain)
- Elite downgrade check: You're trading away elite (165), receiving non-elite (152, 154)
- categoryGain = +3 (moderate improvement)

**Result: BLOCKED** ❌

**Reasoning:** Even though the raw value is higher, you're downgrading from a franchise cornerstone. The AI protects against this unless category gain is exceptional (≥10).

---

## Database Schema

### TeamProfile Table

```prisma
model TeamProfile {
  id          String   @id @default(cuid())
  teamId      String   @unique
  team        Team     @relation(...)
  leagueId    String
  league      League   @relation(...)
  profileData Json     // Stores complete TeamProfile structure
  lastUpdated DateTime @updatedAt
  createdAt   DateTime @default(now())
}
```

### TeamProfile JSON Structure

```typescript
{
  teamId: "abc123",
  teamName: "Mooninites",
  positions: {
    C: { count: 4.5, surplusScore: 0.3 },
    LW: { count: 4.2, surplusScore: -0.5 },
    RW: { count: 3.1, surplusScore: -1.1 },  // Shortage!
    D: { count: 4.8, surplusScore: 0.8 },    // Surplus!
    G: { count: 4.0, surplusScore: 0.2 }
  },
  flexSkaters: 5,  // Players with 2+ positions
  skaterCategories: {
    G: { zScore: 1.2, strength: "strong" },
    BLK: { zScore: -1.1, strength: "weak" }, // Weak category!
    HIT: { zScore: -0.9, strength: "weak" },
    // ... rest
  },
  goalieCategories: {
    W: { zScore: 0.3, strength: "neutral" },
    // ... rest
  },
  rosterPlayerIds: ["player1", "player2", ...],
  lastUpdated: "2025-12-04T18:00:00Z"
}
```

---

## API Endpoints

### POST `/api/league/[leagueKey]/ai-suggestions-v2`

**Purpose:** Generate AI trade suggestions using cached profiles

**Request:** POST (no body required)

**Response:**
```json
{
  "ok": true,
  "suggestions": [
    {
      "confidence": "high",
      "partnerTeamName": "Smok'n Pipes",
      "partnerTeamId": "team123",
      "youGive": ["Cole Caufield"],
      "youGet": ["Moritz Seider"],
      "valueDelta": -12,
      "categoryImpact": ["Blocks +18%", "Hits +12%"],
      "positionImpact": "Strengthens D (1.0), weakens LW (1.0), maintains RW flexibility",
      "reasoning": "This trade directly addresses your weak Blocks and Hits categories..."
    }
  ],
  "myTeamName": "Mooninites",
  "profilesUsed": true,
  "profileTimestamp": "2025-12-04T18:00:00Z"
}
```

**Error Cases:**
- Team profiles not cached: "Please run 'Force Sync' first"
- Yahoo account not linked: "Yahoo account not linked"
- Team not found: "Your team could not be identified"

---

### POST `/api/league/[leagueKey]/force-sync`

**Purpose:** Full data refresh + rebuild team profiles

**Steps:**
1. Sync rosters from Yahoo
2. Sync player stats from Yahoo
3. Calculate player values (z-scores)
4. Populate keeper data
5. **Build and cache team profiles** (NEW)

**Response:**
```json
{
  "ok": true,
  "message": "Teams, stats, values, keepers, and AI profiles refreshed successfully"
}
```

---

### POST `/api/league/[leagueKey]/sync-stats`

**Purpose:** Stats refresh + value recalc + profile rebuild

**Steps:**
1. Sync player stats from Yahoo
2. Recalculate player values
3. **Rebuild team profiles** (NEW)

**Response:**
```json
{
  "ok": true,
  "message": "Player stats synced, values recalculated, and AI profiles refreshed"
}
```

---

## File Structure

```
lib/ai/
├── teamProfile.ts
│   ├── buildTeamProfile()          // Build single team profile
│   ├── buildAllTeamProfiles()      // Build all teams in league
│   ├── storeTeamProfiles()         // Save to database
│   └── loadTeamProfiles()          // Load from database
│
├── profileBasedTradeAnalyzer.ts
│   ├── buildAIPayload()            // Construct structured payload
│   ├── analyzeTrades()             // Call AI with payload
│   └── SYSTEM_PROMPT               // AI algorithm instructions
│
└── tradeAnalyzer.ts                // Old system (kept for comparison)

app/api/league/[leagueKey]/
├── ai-suggestions-v2/              // NEW profile-based endpoint
├── ai-suggestions/                 // OLD direct analysis endpoint
├── force-sync/                     // Updated to build profiles
└── sync-stats/                     // Updated to rebuild profiles

prisma/schema.prisma
└── TeamProfile model               // NEW table for caching
```

---

## Usage Guide

### For Users

#### Step 1: Initial Setup (One-Time)

After connecting your Yahoo account:

1. Go to your league's Trade Builder page
2. Click **"⚡ FORCE SYNC"** to build the AI cache
3. Wait for sync to complete (~30 seconds)

#### Step 2: Get AI Suggestions

1. Click **"🤖 GET AI TRADE SUGGESTIONS"**
2. AI analyzes your team's needs and the entire league
3. Review 3-5 suggested trades with explanations

#### Step 3: Refresh Data (Daily)

- Click **"⚡ FORCE SYNC"** once per day to refresh stats and rebuild profiles
- Or click **"SYNC STATS"** for a lighter refresh

---

### For Developers

#### Adding a New Category

1. Update `skaterCategories` or `goalieCategories` in `TeamProfile` type
2. Add stat mapping in `buildTeamProfile()` function
3. Update AI system prompt to include the new category
4. Rebuild team profiles for all leagues

#### Adjusting Trade Scoring Weights

Edit `profileBasedTradeAnalyzer.ts`:

```typescript
// Current weights
tradeScore = valueDelta × 1.0 + categoryGain × 2.5 + positionFix

// To prioritize value over categories:
tradeScore = valueDelta × 2.0 + categoryGain × 1.0 + positionFix

// To make positional fit more important:
tradeScore = valueDelta × 1.0 + categoryGain × 2.5 + positionFix × 2.0
```

#### Modifying Positional Safety Floors

Edit the AI system prompt in `profileBasedTradeAnalyzer.ts`:

```typescript
// Current minimums
C >= 3.0, LW >= 3.0, RW >= 3.0, D >= 4.0, G >= 3.0

// To allow riskier trades:
C >= 2.5, LW >= 2.5, RW >= 2.5, D >= 3.5, G >= 2.5
```

---

## Performance Considerations

### Caching Strategy

- **Team profiles are cached** in the database as JSON
- Profiles are only rebuilt when stats/values change (daily max)
- AI endpoint loads cached profiles (fast, ~100ms)
- No real-time recalculation during AI analysis

### Token Usage

- Average AI call: ~3,000-4,000 tokens
- Structured payload keeps costs low
- Compact player data (rounded values, essential stats only)

### Database Load

- TeamProfile table: 1 row per team (typically 10 teams = 10 rows)
- JSON column stores ~2KB per team
- Total storage: ~20KB per league (negligible)

---

## Testing Checklist

### Manual Testing

- [ ] Force Sync builds team profiles
- [ ] AI suggestions load cached profiles
- [ ] Dual eligibility counts correctly (C/RW shows 0.5 C + 0.5 RW)
- [ ] Weak categories are identified correctly
- [ ] Trade suggestions make strategic sense
- [ ] Elite downgrades are blocked
- [ ] Sidegrades are rejected
- [ ] Positional safety is enforced

### Edge Cases

- [ ] Player with no positions (null handling)
- [ ] Team with no multi-position players
- [ ] Team that is strong in all categories
- [ ] Team that is weak in all categories
- [ ] Trade that creates positional violation
- [ ] Elite player trade with massive category gain

---

## Future Improvements

### Planned Features

1. **Injury-Aware Trades**
   - Discount injured players
   - Suggest trades to acquire players returning from IR

2. **Schedule Analysis**
   - Consider opponent schedules
   - Suggest trades for "easy playoff weeks"

3. **Multi-Team Trades**
   - Expand beyond 2-team trades
   - 3-way trades for complex needs

4. **Historical Performance**
   - Track suggestion success rate
   - Learn from accepted/rejected trades

5. **Custom Weights**
   - Allow users to prioritize specific categories
   - "I need blocks more than anything"

---

## Troubleshooting

### "Team profiles not found"

**Solution:** Click "Force Sync" to build the initial cache.

### AI suggestions seem random

**Cause:** Profiles may be stale (old stats).

**Solution:** Run "Force Sync" to refresh stats and rebuild profiles.

### Positional counts look wrong

**Cause:** Player positions not synced from Yahoo.

**Solution:** Run "Force Sync" to re-sync rosters.

### AI suggests unrealistic trades

**Cause:** AI creativity exceeds constraints.

**Solution:** Adjust system prompt to be more conservative, or increase minimum value thresholds.

---

## Comparison: Old vs. New System

| Feature | Old System | New System |
|---------|-----------|------------|
| **Position Counting** | Simple sum | Fractional (dual eligibility) |
| **Category Analysis** | Basic stat totals | Z-scores with strength classification |
| **Caching** | None (recalculates every call) | Cached team profiles |
| **AI Prompt** | Simple "analyze trades" | Sophisticated algorithm with rules |
| **Trade Scoring** | Value-focused | Category-focused (2.5x weight) |
| **Elite Protection** | None | Blocks elite downgrades |
| **Positional Safety** | None | Enforces minimum position counts |
| **Sidegrade Filter** | None | Rejects meaningless swaps |
| **Performance** | Slow (~10-15 seconds) | Fast (~3-5 seconds) |

---

## Conclusion

This system represents a complete overhaul of trade analysis, moving from a simple "here are some trades" approach to a strategic, category-aware, dual-eligibility-respecting fantasy hockey advisor.

The AI now thinks like a human fantasy manager:
- "What categories am I weak in?"
- "Who has what I need?"
- "Can I afford to lose this position?"
- "Is this trade worth it strategically?"

It's no longer about swapping similar players for the sake of it. It's about improving your team in a meaningful, H2H category-league context.

