# Deployment Guide: Profile-Based AI Trade System

## 🚀 Quick Start (Post-Deployment)

After deploying the new profile-based AI system, follow these steps to get it running:

### Step 1: Initial Profile Build

For each league in your database, run:

```bash
npx tsx scripts/rebuild-team-profiles.ts <leagueId>
```

This will:
- Calculate league-wide position averages (with dual eligibility)
- Calculate category z-scores for all teams
- Store profiles in the `team_profiles` table

**Expected time:** ~5-10 seconds per league

---

### Step 2: Verify System Health

```bash
npx tsx scripts/test-ai-system.ts <leagueId>
```

This runs a 7-point verification:
- ✅ League exists
- ✅ Profiles are cached
- ✅ Profiles are fresh
- ✅ Dual eligibility works
- ✅ Category analysis works
- ✅ Player data is complete
- ✅ AI payload builds

**Expected output:** "🎉 ALL TESTS PASSED!"

---

### Step 3: Test AI Suggestions

1. Go to `/league/<leagueKey>/trade` in the UI
2. Click **"🤖 GET AI TRADE SUGGESTIONS"**
3. Verify you get 3-5 category-aware suggestions

**Expected behavior:**
- Suggestions reference weak categories
- Trade reasoning mentions positional balance
- Confidence scores (high/medium/low) are included

---

## 📦 What Was Deployed

### Database Changes
- ✅ New `team_profiles` table
- ✅ Schema migrated with `prisma db push`
- ✅ One-to-one relationship: `Team ↔ TeamProfile`

### API Endpoints
- ✅ **New:** `/api/league/[leagueKey]/ai-suggestions-v2` (profile-based)
- ✅ **Updated:** `/api/league/[leagueKey]/force-sync` (builds profiles)
- ✅ **Updated:** `/api/league/[leagueKey]/sync-stats` (rebuilds profiles)
- ✅ **Preserved:** `/api/league/[leagueKey]/ai-suggestions` (old system, for comparison)

### Core Libraries
- ✅ `lib/ai/teamProfile.ts` - Profile building logic
- ✅ `lib/ai/profileBasedTradeAnalyzer.ts` - AI analyzer with structured prompt
- ✅ Admin scripts for debugging and maintenance

---

## 🔄 Automated Profile Refresh

Profiles are automatically rebuilt when:
1. User clicks **"⚡ FORCE SYNC"** in the UI
2. User clicks **"SYNC STATS"** in the UI
3. Daily cron job runs (if configured)

**Manual refresh:**
```bash
npx tsx scripts/rebuild-team-profiles.ts <leagueId>
```

---

## 🧪 Testing in Production

### Test 1: Inspect a Team Profile

```bash
# Find team ID
npx tsx scripts/list-teams.ts <leagueId>

# Inspect specific team
npx tsx scripts/inspect-team-profile.ts <teamId>
```

**What to check:**
- Position counts use fractional counting (e.g., 4.5 C, not 5 C)
- Weak categories are identified (z-score <= -0.75)
- Surplus/shortage positions are marked
- Multi-position players are tracked

---

### Test 2: Verify AI Suggestions

In the UI, click "🤖 GET AI TRADE SUGGESTIONS" and verify:

**✅ Good Suggestions:**
```json
{
  "confidence": "high",
  "partnerTeamName": "Smok'n Pipes",
  "youGive": ["Cole Caufield"],
  "youGet": ["Moritz Seider"],
  "valueDelta": -12,
  "categoryImpact": ["Blocks +18%", "Hits +12%"],
  "positionImpact": "Strengthens D, maintains RW flexibility",
  "reasoning": "This trade addresses your weak Blocks and Hits..."
}
```

**❌ Bad Suggestions (should not appear):**
- Pure value swaps with no category fit
- Elite downgrades (e.g., McDavid for depth players)
- Trades that create positional violations
- "Garbage" players (value < 90) unless filling critical need

---

## 🐛 Troubleshooting

### Issue: "Team profiles not found"

**Cause:** Profiles haven't been built yet.

**Fix:**
```bash
npx tsx scripts/rebuild-team-profiles.ts <leagueId>
```

---

### Issue: AI suggests unrealistic trades

**Cause 1:** Profiles are stale (old stats).

**Fix:** Run Force Sync from UI or:
```bash
curl -X POST https://your-domain.com/api/league/<leagueKey>/force-sync
```

**Cause 2:** AI is being too creative.

**Fix:** Adjust system prompt in `lib/ai/profileBasedTradeAnalyzer.ts`:
- Increase minimum value thresholds
- Add more elite protection rules
- Tighten category gain requirements

---

### Issue: Position counts look wrong

**Cause:** Player positions not synced from Yahoo.

**Fix:**
1. Run Force Sync (pulls latest positions from Yahoo)
2. Rebuild profiles
3. Verify with: `npx tsx scripts/inspect-team-profile.ts <teamId>`

---

### Issue: All categories showing as "neutral"

**Cause:** League-wide stats may be missing or uniform.

**Fix:**
1. Verify player stats exist: `SELECT COUNT(*) FROM player_stats WHERE "leagueId" = '<leagueId>';`
2. If zero, run Force Sync
3. Rebuild profiles

---

## 📊 Performance Monitoring

### Expected Response Times

| Operation | Time | Notes |
|-----------|------|-------|
| **Load team profiles** | < 100ms | Cached in database |
| **Build team profiles** | 5-10s | Only on sync |
| **AI analysis (v2)** | 3-5s | Uses cached profiles |
| **AI analysis (v1)** | 10-15s | Recalculates every time |

### Database Impact

- **Storage per team:** ~2KB JSON in `profileData` column
- **10-team league:** ~20KB total
- **Minimal impact:** Profiles are only rebuilt on data refresh

---

## 🔐 Security Considerations

### API Endpoints

All AI endpoints require:
- ✅ Valid session (authenticated user)
- ✅ Yahoo account linked
- ✅ Team ownership verification

### Admin Scripts

Scripts require:
- ✅ Database access (via `DATABASE_URL`)
- ✅ Server-side execution only
- ❌ Not exposed to web

---

## 📈 Metrics to Track

### Success Metrics

1. **AI Suggestion Click Rate**
   - Track how often users click "Get AI Suggestions"
   - Goal: > 50% of active users per week

2. **Suggestion Quality**
   - Track how many suggestions are accepted
   - Monitor user feedback on relevance

3. **Profile Freshness**
   - Monitor profile age via `lastUpdated` timestamp
   - Alert if > 48 hours old

4. **System Health**
   - Run `test-ai-system.ts` weekly
   - Monitor failure rate

---

## 🔄 Rollback Plan

If issues arise, rollback is simple:

1. **Change UI to call old endpoint:**
   ```typescript
   // In app/league/[leagueKey]/trade/page.tsx
   const response = await fetch(`/api/league/${leagueKey}/ai-suggestions`, { // Old endpoint
     method: 'POST' 
   });
   ```

2. **Deploy:**
   ```bash
   git revert HEAD~3
   git push origin main
   ```

3. **Old system still works:**
   - Original analyzer is preserved in `lib/ai/tradeAnalyzer.ts`
   - `/api/league/[leagueKey]/ai-suggestions` endpoint unchanged

---

## 🎯 Success Criteria

The deployment is successful when:

- ✅ All leagues have team profiles cached
- ✅ `test-ai-system.ts` passes for all leagues
- ✅ AI suggestions mention category improvements
- ✅ Trade reasoning includes positional balance
- ✅ No elite downgrade suggestions appear
- ✅ Dual eligibility is reflected in position counts
- ✅ Response time < 5 seconds per suggestion

---

## 📞 Support

If you encounter issues:

1. **Run diagnostics:**
   ```bash
   npx tsx scripts/test-ai-system.ts <leagueId>
   ```

2. **Check profile status:**
   ```bash
   npx tsx scripts/list-teams.ts <leagueId>
   ```

3. **Inspect specific team:**
   ```bash
   npx tsx scripts/inspect-team-profile.ts <teamId>
   ```

4. **Check logs:**
   - Vercel: Check function logs for AI endpoint
   - Look for `[AI Suggestions V2]` and `[Team Profile]` prefixes

---

## 🚀 Next Steps

After successful deployment:

1. **Monitor usage** for first week
2. **Collect feedback** on suggestion quality
3. **Tune weights** if needed (category vs. value balance)
4. **Consider enhancements:**
   - Injury-aware suggestions
   - Schedule analysis
   - 3-way trade support
   - Historical learning

---

## 📚 Additional Resources

- **AI System Documentation:** `AI_TRADE_SYSTEM.md`
- **Admin Scripts Guide:** `scripts/README.md`
- **Project Overview:** `PROJECT.md`

---

## ✅ Deployment Checklist

Before marking deployment complete:

- [ ] Database schema updated (`team_profiles` table exists)
- [ ] Prisma client regenerated
- [ ] Build succeeds locally
- [ ] Build succeeds on Vercel
- [ ] Team profiles built for all leagues
- [ ] `test-ai-system.ts` passes
- [ ] AI suggestions work in UI
- [ ] Old endpoint preserved as fallback
- [ ] Admin scripts tested
- [ ] Documentation reviewed
- [ ] Rollback plan understood

---

**Deployment Date:** December 4, 2025  
**System Version:** Profile-Based AI v2  
**Status:** ✅ Production Ready

