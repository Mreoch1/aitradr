# Admin Scripts

Collection of administrative and debugging scripts for AiTradr.

## Prerequisites

```bash
npm install -g tsx  # TypeScript execution engine
```

All scripts require database access via `DATABASE_URL` in `.env`.

---

## AI Trade System Scripts

### 🧪 Test AI System

**Purpose:** Comprehensive verification of the profile-based AI trade suggestion system.

**Usage:**
```bash
npx tsx scripts/test-ai-system.ts <leagueId>
```

**What it checks:**
- ✅ League exists and has teams
- ✅ Team profiles are cached
- ✅ Profiles are fresh (< 24 hours old)
- ✅ Dual eligibility fractional counting works
- ✅ Category strength analysis is accurate
- ✅ Player data completeness (values and stats)
- ✅ AI payload generation succeeds

**Example output:**
```
🧪 Testing AI Trade System
1️⃣  Checking league exists...
   ✅ PASSED: League "atfh2" found with 10 teams
2️⃣  Checking team profiles are cached...
   ✅ PASSED: All 10 team profiles cached
...
📊 TEST SUMMARY
✅ Passed: 7
❌ Failed: 0
🎉 ALL TESTS PASSED! AI system is ready to use.
```

---

### 🔄 Rebuild Team Profiles

**Purpose:** Manually rebuild team profiles for a league (bypasses cache).

**Usage:**
```bash
npx tsx scripts/rebuild-team-profiles.ts <leagueId>
```

**When to use:**
- After bulk data changes
- When profiles are stale or corrupted
- For debugging profile generation
- After schema changes

**Example output:**
```
🔄 Rebuilding team profiles for league: abc123
✅ League found: atfh2
📊 Teams: 10

🤖 Building team profiles...
✅ Built 10 profiles

📈 Profile Summary:

🏒 Mooninites
  Positions:
    C: 4.5 (+0.3) ➖ NEUTRAL
    LW: 4.2 (-0.5) ➖ NEUTRAL
    RW: 3.1 (-1.1) ⚠️  SHORTAGE
    D: 4.8 (+0.8) ✅ SURPLUS
    G: 4.0 (+0.2) ➖ NEUTRAL
  Weak Categories:
    BLK, HIT
  Flex Skaters: 5

...

💾 Storing profiles to database...
✅ Profiles stored successfully
✨ Complete! Team profiles are now cached and ready for AI suggestions.
```

---

### 🔍 Inspect Team Profile

**Purpose:** View detailed profile data for a specific team.

**Usage:**
```bash
npx tsx scripts/inspect-team-profile.ts <teamId>
```

**What it shows:**
- Position analysis with surplus/shortage indicators
- Category strength breakdown (z-scores)
- Roster composition by position
- Multi-position players (flex value)
- Strategic recommendations

**Example output:**
```
🏒 Team: Mooninites
📋 League: atfh2
👤 Manager: Michael
📊 Roster Size: 23

⏰ Profile Last Updated: 12/4/2025, 6:00:00 PM

📍 POSITION ANALYSIS
Pos  | Count | Surplus | Status
C    |   4.5 |  +0.3  | ➖ NEUTRAL
LW   |   4.2 |  -0.5  | ➖ NEUTRAL
RW   |   3.1 |  -1.1  | ❌ SHORTAGE
D    |   4.8 |  +0.8  | ✅ SURPLUS
G    |   4.0 |  +0.2  | ➖ NEUTRAL

🔀 Flex Skaters (multi-position): 5

🏒 SKATER CATEGORIES
Category | Z-Score | Strength
BLK      |  -1.12  | ⚠️  WEAK
HIT      |  -0.89  | ⚠️  WEAK
PIM      |  -0.45  | ➖ NEUTRAL
...

🔀 Multi-Position Players:
  • Macklin Celebrini (C, 170)
  • Cole Caufield (LW/RW, 157)
  • Mikko Rantanen (LW/RW, 156)
  ...

💡 STRATEGIC RECOMMENDATIONS
⚠️  Target these categories for improvement: BLK, HIT
⚠️  Positional shortages to address: RW
✅ Trade from surplus positions: D
```

---

### 📋 List Teams

**Purpose:** List all teams in a league with their IDs and profile status.

**Usage:**
```bash
npx tsx scripts/list-teams.ts <leagueId>
```

**What it shows:**
- Team names and IDs
- Roster sizes
- Profile cache status
- Profile age

**Example output:**
```
🏒 League: atfh2
📅 Season: 2024
🔑 League Key: 427.l.12345
📊 Teams: 10

Team Name                      | Team ID                        | Roster | Profile
────────────────────────────────────────────────────────────────────────────────
Mooninites                     | cm2abc123                      |     23 | ✅ (15m ago)
Smok'n Pipes                   | cm2def456                      |     22 | ✅ (15m ago)
mismanagewhome?                | cm2ghi789                      |     23 | ✅ (15m ago)
...

✅ Teams with profiles: 10

To inspect a specific team:
  npx tsx scripts/inspect-team-profile.ts <teamId>
```

---

## Finding IDs

### Find League ID

**Method 1: From URL**
```
URL: /league/427.l.12345/trade
1. Copy the league key: 427.l.12345
2. Query database:
   SELECT id FROM leagues WHERE "leagueKey" = '427.l.12345';
```

**Method 2: From Database**
```sql
SELECT id, name, "leagueKey" FROM leagues WHERE name LIKE '%atfh%';
```

### Find Team ID

**Method 1: Use `list-teams.ts` script (easiest)**
```bash
npx tsx scripts/list-teams.ts <leagueId>
```

**Method 2: From Database**
```sql
SELECT id, name FROM teams WHERE "leagueId" = '<leagueId>';
```

---

## Typical Workflows

### 🚀 Initial Setup (New League)

```bash
# 1. Force sync from UI or API
curl -X POST https://aitradr.vercel.app/api/league/427.l.12345/force-sync

# 2. Verify profiles were created
npx tsx scripts/list-teams.ts <leagueId>

# 3. Test the AI system
npx tsx scripts/test-ai-system.ts <leagueId>

# 4. Inspect a specific team
npx tsx scripts/inspect-team-profile.ts <teamId>
```

### 🔧 Debugging Profile Issues

```bash
# 1. List teams and check profile status
npx tsx scripts/list-teams.ts <leagueId>

# 2. If profiles are missing or stale, rebuild
npx tsx scripts/rebuild-team-profiles.ts <leagueId>

# 3. Verify the fix
npx tsx scripts/test-ai-system.ts <leagueId>
```

### 📊 Analyzing a Team's Needs

```bash
# 1. Find team ID
npx tsx scripts/list-teams.ts <leagueId>

# 2. Inspect team profile
npx tsx scripts/inspect-team-profile.ts <teamId>

# Output will show:
# - Weak categories to target
# - Positional shortages to fill
# - Surplus positions to trade from
```

### 🧹 Data Refresh Workflow

```bash
# Daily routine:
# 1. Force sync from UI (pulls fresh Yahoo data)
# 2. Profiles are automatically rebuilt
# 3. AI suggestions are now based on latest stats

# Or manually:
curl -X POST https://aitradr.vercel.app/api/league/427.l.12345/force-sync
```

---

## Troubleshooting

### "No profiles found"

**Cause:** Team profiles haven't been built yet.

**Fix:**
```bash
npx tsx scripts/rebuild-team-profiles.ts <leagueId>
```

### "Profile is X hours old"

**Cause:** Stats haven't been synced recently.

**Fix:** Run Force Sync from the UI or:
```bash
curl -X POST https://aitradr.vercel.app/api/league/427.l.12345/force-sync
```

### "Player data incomplete"

**Cause:** Player values or stats are missing.

**Fix:** Force sync will recalculate everything:
```bash
curl -X POST https://aitradr.vercel.app/api/league/427.l.12345/force-sync
```

### "Position counting looks wrong"

**Cause:** Player positions may not be synced from Yahoo.

**Fix:**
1. Force sync to re-pull positions
2. Rebuild profiles
3. Verify with inspect-team-profile.ts

---

## Script Dependencies

All scripts use:
- `prisma` - Database access
- `../lib/ai/teamProfile` - Profile building logic
- `../lib/ai/profileBasedTradeAnalyzer` - AI payload generation
- `../lib/keeper/types` - Keeper bonus calculations

---

## Adding New Scripts

Template:
```typescript
/**
 * Admin Script: <Name>
 * 
 * <Description>
 * 
 * Usage:
 *   npx tsx scripts/<filename>.ts <args>
 */

import prisma from "../lib/prisma";

async function main() {
  const arg = process.argv[2];

  if (!arg) {
    console.error("❌ Usage: npx tsx scripts/<filename>.ts <arg>");
    process.exit(1);
  }

  try {
    // Your logic here
    console.log("✅ Done!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
```

---

## Performance Notes

- **`test-ai-system.ts`:** ~2-5 seconds (database queries only)
- **`rebuild-team-profiles.ts`:** ~5-10 seconds for 10 teams (includes z-score calculations)
- **`inspect-team-profile.ts`:** < 1 second (single DB query)
- **`list-teams.ts`:** < 1 second (single DB query)

All scripts are safe to run in production as they only read data (except `rebuild-team-profiles.ts` which writes profiles).

