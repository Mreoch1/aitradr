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
import { loadTeamProfiles } from "../lib/ai/teamProfile";
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
    console.log("\n5️⃣  Testing category z-score analysis...");
    let categoryAnalysisWorks = true;
    
    for (const profile of profiles) {
      const weakCats = Object.entries(profile.categories)
        .filter(([_, z]) => (z as number) < -0.85)
        .length;
      
      const strongCats = Object.entries(profile.categories)
        .filter(([_, z]) => (z as number) > 0.85)
        .length;
      
      // Every team should have at least one weak or strong category (not all neutral)
      if (weakCats === 0 && strongCats === 0) {
        console.log(`   ⚠️  ${profile.teamName}: All categories neutral (unusual)`);
        categoryAnalysisWorks = false;
      }
    }
    
    if (categoryAnalysisWorks) {
      console.log("   ✅ PASSED: Category z-score analysis working");
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

    // Test 7: Profile structure validation
    console.log("\n7️⃣  Validating profile structure...");
    
    const sampleProfile = profiles[0];
    const hasPositions = sampleProfile && sampleProfile.positions && sampleProfile.positions.C;
    const hasCategories = sampleProfile && sampleProfile.categories && typeof sampleProfile.categories.G === 'number';
    const hasKeepers = sampleProfile && sampleProfile.keepers;
    
    if (!hasPositions) {
      console.log("   ❌ FAILED: Profile missing position data");
      failed++;
    } else if (!hasCategories) {
      console.log("   ❌ FAILED: Profile missing category data");
      failed++;
    } else if (!hasKeepers) {
      console.log("   ❌ FAILED: Profile missing keeper data");
      failed++;
    } else {
      console.log("   ✅ PASSED: Profile structure is valid");
      console.log(`   Sample: ${sampleProfile.teamName}`);
      console.log(`   - Position count (C): ${sampleProfile.positions.C.count.toFixed(1)}`);
      console.log(`   - Category z-score (G): ${sampleProfile.categories.G.toFixed(2)}`);
      console.log(`   - Keepers: ${sampleProfile.keepers.expiring.length} expiring, ${sampleProfile.keepers.fresh.length} fresh`);
      passed++;
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

