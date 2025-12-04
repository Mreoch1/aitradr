/**
 * Admin Script: Test AI System
 * 
 * Comprehensive test of the profile-based AI trade suggestion system.
 * Verifies:
 * - Team profiles exist and are fresh
 * - Player data is complete
 * - AI payload builds correctly
 * - Dual eligibility counting works
 * - Category analysis is accurate
 * 
 * Usage:
 *   npx tsx scripts/test-ai-system.ts <leagueId>
 */

import prisma from "../lib/prisma";
import { loadTeamProfiles, type Player } from "../lib/ai/teamProfile";
import { buildAIPayload } from "../lib/ai/profileBasedTradeAnalyzer";
import { calculateKeeperBonus } from "../lib/keeper/types";

async function testAISystem() {
  const leagueId = process.argv[2];

  if (!leagueId) {
    console.error("❌ Usage: npx tsx scripts/test-ai-system.ts <leagueId>");
    process.exit(1);
  }

  console.log("🧪 Testing AI Trade System");
  console.log("─".repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;

  try {
    // Test 1: League exists
    console.log("1️⃣  Checking league exists...");
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { teams: true }
    });

    if (!league) {
      console.log("   ❌ FAILED: League not found");
      failed++;
      process.exit(1);
    }
    console.log(`   ✅ PASSED: League "${league.name}" found with ${league.teams.length} teams`);
    passed++;

    // Test 2: Team profiles exist
    console.log("\n2️⃣  Checking team profiles are cached...");
    const profiles = await loadTeamProfiles(leagueId);
    
    if (profiles.length === 0) {
      console.log("   ❌ FAILED: No team profiles found");
      console.log("   Run: npx tsx scripts/rebuild-team-profiles.ts", leagueId);
      failed++;
    } else if (profiles.length !== league.teams.length) {
      console.log(`   ⚠️  WARNING: ${profiles.length} profiles but ${league.teams.length} teams`);
      console.log("   Some teams may be missing profiles");
      passed++;
    } else {
      console.log(`   ✅ PASSED: All ${profiles.length} team profiles cached`);
      passed++;
    }

    // Test 3: Profile freshness
    console.log("\n3️⃣  Checking profile freshness...");
    const oldestProfile = profiles.reduce((oldest, p) => {
      const pTime = new Date(p.lastUpdated).getTime();
      const oTime = new Date(oldest.lastUpdated).getTime();
      return pTime < oTime ? p : oldest;
    });
    const age = Date.now() - new Date(oldestProfile.lastUpdated).getTime();
    const ageHours = age / 1000 / 60 / 60;
    
    if (ageHours > 24) {
      console.log(`   ⚠️  WARNING: Oldest profile is ${ageHours.toFixed(1)}h old`);
      console.log(`   Team: ${oldestProfile.teamName}`);
      console.log("   Consider running Force Sync to refresh");
    } else {
      console.log(`   ✅ PASSED: Profiles are fresh (${ageHours.toFixed(1)}h old)`);
    }
    passed++;

    // Test 4: Dual eligibility counting
    console.log("\n4️⃣  Testing dual eligibility counting...");
    let dualEligFound = false;
    let dualEligCorrect = true;
    
    for (const profile of profiles) {
      if (profile.flexSkaters > 0) {
        dualEligFound = true;
        
        // Check that fractional counting is working
        // Sum of all position counts should be close to roster size (minus goalies)
        const totalPosCount = Object.values(profile.positions)
          .filter((_, i) => i < 4) // Skip goalies
          .reduce((sum, pos) => sum + pos.count, 0);
        
        const rosterSize = profile.rosterPlayerIds.length;
        const expectedSkaters = rosterSize - profile.positions.G.count;
        
        // Allow small variance (0.5) for rounding
        if (Math.abs(totalPosCount - expectedSkaters) > 0.5) {
          console.log(`   ⚠️  ${profile.teamName}: Position sum (${totalPosCount.toFixed(1)}) != skaters (${expectedSkaters.toFixed(1)})`);
          dualEligCorrect = false;
        }
      }
    }
    
    if (!dualEligFound) {
      console.log("   ⚠️  WARNING: No multi-position players found (unusual)");
    } else if (dualEligCorrect) {
      console.log("   ✅ PASSED: Fractional counting is accurate");
      passed++;
    } else {
      console.log("   ❌ FAILED: Fractional counting has errors");
      failed++;
    }

    // Test 5: Category analysis
    console.log("\n5️⃣  Testing category strength analysis...");
    let categoryAnalysisWorks = true;
    
    for (const profile of profiles) {
      const weakCats = Object.entries(profile.skaterCategories)
        .filter(([_, cat]) => cat.strength === "weak")
        .length;
      
      const strongCats = Object.entries(profile.skaterCategories)
        .filter(([_, cat]) => cat.strength === "strong")
        .length;
      
      // Every team should have at least one weak or strong category (not all neutral)
      if (weakCats === 0 && strongCats === 0) {
        console.log(`   ⚠️  ${profile.teamName}: All categories neutral (unusual)`);
        categoryAnalysisWorks = false;
      }
    }
    
    if (categoryAnalysisWorks) {
      console.log("   ✅ PASSED: Category strength classification working");
      passed++;
    } else {
      console.log("   ❌ FAILED: Category analysis may have issues");
      failed++;
    }

    // Test 6: Player data completeness
    console.log("\n6️⃣  Checking player data completeness...");
    const playersFromDB = await prisma.player.findMany({
      include: {
        rosterEntries: {
          where: { leagueId },
        },
        playerValues: {
          where: { leagueId },
        },
        playerStats: {
          where: { leagueId },
        },
      },
    });

    const rosteredPlayers = playersFromDB.filter(p => p.rosterEntries.length > 0);
    const playersWithValues = rosteredPlayers.filter(p => p.playerValues.length > 0);
    const playersWithStats = rosteredPlayers.filter(p => p.playerStats.length > 0);
    
    console.log(`   Total rostered players: ${rosteredPlayers.length}`);
    console.log(`   Players with values: ${playersWithValues.length}`);
    console.log(`   Players with stats: ${playersWithStats.length}`);
    
    if (playersWithValues.length < rosteredPlayers.length * 0.9) {
      console.log("   ❌ FAILED: Less than 90% of players have values");
      console.log("   Run Force Sync to recalculate values");
      failed++;
    } else {
      console.log("   ✅ PASSED: Player value coverage is good");
      passed++;
    }

    // Test 7: AI Payload generation
    console.log("\n7️⃣  Testing AI payload generation...");
    
    // Get draft pick values for keeper bonus calculation
    const draftPickValues = await prisma.draftPickValue.findMany({
      where: { leagueId },
      orderBy: { round: 'asc' }
    });
    const pickValueMap = new Map(draftPickValues.map(pv => [pv.round, pv.score]));

    // Build player pool
    const players: Player[] = [];
    for (const dbPlayer of rosteredPlayers) {
      const rosterEntry = dbPlayer.rosterEntries[0];
      const playerValue = dbPlayer.playerValues[0];
      if (!rosterEntry || !playerValue) continue;

      let positions: ("C" | "LW" | "RW" | "D" | "G")[] = [];
      try {
        const parsed = typeof dbPlayer.positions === 'string' 
          ? JSON.parse(dbPlayer.positions) 
          : dbPlayer.positions;
        if (Array.isArray(parsed)) {
          positions = parsed.filter((p: string) => 
            ["C", "LW", "RW", "D", "G"].includes(p)
          ) as ("C" | "LW" | "RW" | "D" | "G")[];
        }
      } catch (e) {}

      const isGoalie = positions.includes("G");
      let valueBase = playerValue.score;
      let valueKeeper = valueBase;

      if (rosterEntry.isKeeper && rosterEntry.originalDraftRound && rosterEntry.yearsRemaining !== null) {
        const draftRoundAvg = pickValueMap.get(rosterEntry.originalDraftRound) ?? 100;
        const keeperBonus = calculateKeeperBonus(
          valueBase,
          rosterEntry.originalDraftRound,
          draftRoundAvg,
          rosterEntry.yearsRemaining
        );
        valueKeeper = valueBase + keeperBonus;
      }

      const categories: any = {};
      for (const stat of dbPlayer.playerStats) {
        const name = stat.statName.toLowerCase();
        const value = stat.value;
        if (!isGoalie) {
          if (name.includes("goal") && !name.includes("against")) categories.G = value;
          if (name.includes("assist")) categories.A = value;
        } else {
          if (name.includes("win")) categories.W = value;
        }
      }

      players.push({
        id: dbPlayer.id,
        name: dbPlayer.name,
        teamId: rosterEntry.teamId,
        nhlTeam: dbPlayer.teamAbbr || "?",
        positions,
        isGoalie,
        valueBase,
        valueKeeper,
        categories,
      });
    }

    if (players.length === 0) {
      console.log("   ❌ FAILED: No players in player pool");
      failed++;
    } else {
      const targetTeamId = league.teams[0].id;
      const payload = buildAIPayload(profiles, players, targetTeamId);
      
      console.log(`   Players in payload: ${payload.players.length}`);
      console.log(`   Teams in payload: ${payload.teamProfiles.length}`);
      console.log(`   Categories tracked: ${payload.league.categories.skater.length} skater, ${payload.league.categories.goalie.length} goalie`);
      
      if (payload.players.length > 0 && payload.teamProfiles.length > 0) {
        console.log("   ✅ PASSED: AI payload builds successfully");
        passed++;
      } else {
        console.log("   ❌ FAILED: AI payload is incomplete");
        failed++;
      }
    }

    // Summary
    console.log("\n" + "─".repeat(60));
    console.log("📊 TEST SUMMARY");
    console.log("─".repeat(60));
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    
    if (failed === 0) {
      console.log("\n🎉 ALL TESTS PASSED! AI system is ready to use.");
      console.log("\nTo test AI suggestions in production:");
      console.log("  1. Go to your league's Trade Builder page");
      console.log("  2. Click '🤖 GET AI TRADE SUGGESTIONS'");
      console.log("  3. Review the category-aware suggestions");
    } else {
      console.log("\n⚠️  Some tests failed. Review errors above and:");
      console.log("  1. Run Force Sync to refresh all data");
      console.log(`  2. Run: npx tsx scripts/rebuild-team-profiles.ts ${leagueId}`);
      console.log("  3. Re-run this test");
    }

  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testAISystem();

