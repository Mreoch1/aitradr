/**
 * Admin Script: Rebuild Team Profiles
 * 
 * Manually rebuilds team profiles for a specific league.
 * Useful for debugging or if profiles get out of sync.
 * 
 * Usage:
 *   npx tsx scripts/rebuild-team-profiles.ts <leagueId>
 */

import prisma from "../lib/prisma";
import { buildAllTeamProfiles, storeTeamProfiles } from "../lib/ai/teamProfile";

async function rebuildProfiles() {
  const leagueId = process.argv[2];

  if (!leagueId) {
    console.error("❌ Usage: npx tsx scripts/rebuild-team-profiles.ts <leagueId>");
    process.exit(1);
  }

  console.log("🔄 Rebuilding team profiles for league:", leagueId);

  try {
    // Verify league exists
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { teams: true }
    });

    if (!league) {
      console.error("❌ League not found:", leagueId);
      process.exit(1);
    }

    console.log("✅ League found:", league.name);
    console.log("📊 Teams:", league.teams.length);

    // Build profiles
    console.log("\n🤖 Building team profiles...");
    const profiles = await buildAllTeamProfiles(leagueId);
    console.log("✅ Built", profiles.length, "profiles");

    // Display summary
    console.log("\n📈 Profile Summary:");
    for (const profile of profiles) {
      console.log("\n🏒", profile.teamName);
      console.log("  Positions:");
      for (const [pos, summary] of Object.entries(profile.positions)) {
        const status = 
          summary.surplusScore > 0.7 ? "✅ SURPLUS" :
          summary.surplusScore < -0.7 ? "⚠️  SHORTAGE" :
          "➖ NEUTRAL";
        console.log(`    ${pos}: ${summary.count.toFixed(1)} (${summary.surplusScore > 0 ? '+' : ''}${summary.surplusScore.toFixed(1)}) ${status}`);
      }
      
      console.log("  Weak Categories:");
      const weakCats = Object.entries(profile.skaterCategories)
        .filter(([_, cat]) => cat.strength === "weak")
        .map(([name]) => name);
      console.log(`    ${weakCats.length > 0 ? weakCats.join(", ") : "None"}`);
      
      console.log(`  Flex Skaters: ${profile.flexSkaters}`);
    }

    // Store profiles
    console.log("\n💾 Storing profiles to database...");
    await storeTeamProfiles(leagueId, profiles);
    console.log("✅ Profiles stored successfully");

    console.log("\n✨ Complete! Team profiles are now cached and ready for AI suggestions.");

  } catch (error) {
    console.error("❌ Error rebuilding profiles:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

rebuildProfiles();

