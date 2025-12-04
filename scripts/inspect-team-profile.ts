/**
 * Admin Script: Inspect Team Profile
 * 
 * View detailed profile data for a specific team.
 * 
 * Usage:
 *   npx tsx scripts/inspect-team-profile.ts <teamId>
 */

import prisma from "../lib/prisma";
import type { TeamProfile } from "../lib/ai/teamProfile";

async function inspectProfile() {
  const teamId = process.argv[2];

  if (!teamId) {
    console.error("❌ Usage: npx tsx scripts/inspect-team-profile.ts <teamId>");
    console.error("\nTo find teamId, run: npx tsx scripts/list-teams.ts <leagueId>");
    process.exit(1);
  }

  try {
    // Load team with profile
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        profile: true,
        league: true,
        rosterEntries: {
          include: {
            player: {
              include: {
                playerValues: true
              }
            }
          }
        }
      }
    });

    if (!team) {
      console.error("❌ Team not found:", teamId);
      process.exit(1);
    }

    console.log("🏒 Team:", team.name);
    console.log("📋 League:", team.league.name);
    console.log("👤 Manager:", team.managerName || "Unknown");
    console.log("📊 Roster Size:", team.rosterEntries.length);

    if (!team.profile) {
      console.log("\n⚠️  No profile found for this team.");
      console.log("Run: npx tsx scripts/rebuild-team-profiles.ts", team.leagueId);
      process.exit(0);
    }

    const profile = team.profile.profileData as any as TeamProfile;

    console.log("\n⏰ Profile Last Updated:", new Date(profile.lastUpdated).toLocaleString());

    // Position Analysis
    console.log("\n📍 POSITION ANALYSIS");
    console.log("─".repeat(60));
    console.log("Pos  | Count | Surplus | Status");
    console.log("─".repeat(60));
    for (const [pos, summary] of Object.entries(profile.positions)) {
      const status = 
        summary.surplusScore > 0.7 ? "✅ SURPLUS" :
        summary.surplusScore < -0.7 ? "❌ SHORTAGE" :
        "➖ NEUTRAL";
      console.log(
        `${pos.padEnd(4)} | ${summary.count.toFixed(1).padStart(5)} | ${(summary.surplusScore > 0 ? '+' : '') + summary.surplusScore.toFixed(1).padStart(4)} | ${status}`
      );
    }
    console.log(`\n🔀 Flex Skaters (multi-position): ${profile.flexSkaters}`);

    // Category Analysis - Skaters
    console.log("\n🏒 SKATER CATEGORIES");
    console.log("─".repeat(60));
    console.log("Category | Z-Score | Strength");
    console.log("─".repeat(60));
    
    const sortedSkaterCats = Object.entries(profile.skaterCategories)
      .sort(([, a], [, b]) => a.zScore - b.zScore); // Weak first
    
    for (const [cat, summary] of sortedSkaterCats) {
      const icon = 
        summary.strength === "strong" ? "💪" :
        summary.strength === "weak" ? "⚠️ " :
        "➖";
      console.log(
        `${cat.padEnd(8)} | ${(summary.zScore > 0 ? '+' : '') + summary.zScore.toFixed(2).padStart(6)} | ${icon} ${summary.strength.toUpperCase()}`
      );
    }

    // Category Analysis - Goalies
    if (Object.values(profile.goalieCategories).some(c => c.zScore !== 0)) {
      console.log("\n🥅 GOALIE CATEGORIES");
      console.log("─".repeat(60));
      console.log("Category | Z-Score | Strength");
      console.log("─".repeat(60));
      
      for (const [cat, summary] of Object.entries(profile.goalieCategories)) {
        const icon = 
          summary.strength === "strong" ? "💪" :
          summary.strength === "weak" ? "⚠️ " :
          "➖";
        console.log(
          `${cat.padEnd(8)} | ${(summary.zScore > 0 ? '+' : '') + summary.zScore.toFixed(2).padStart(6)} | ${icon} ${summary.strength.toUpperCase()}`
        );
      }
    }

    // Roster Breakdown
    console.log("\n👥 ROSTER BREAKDOWN");
    console.log("─".repeat(60));
    
    // Count players by position
    const posCounts: Record<string, number> = {};
    const multiPosPlayers: string[] = [];
    
    for (const entry of team.rosterEntries) {
      const player = entry.player;
      const value = player.playerValues[0]?.score || 0;
      
      let positions: string[] = [];
      try {
        const parsed = typeof player.positions === 'string' 
          ? JSON.parse(player.positions) 
          : player.positions;
        if (Array.isArray(parsed)) {
          positions = parsed.filter(p => ["C", "LW", "RW", "D", "G"].includes(p));
        }
      } catch (e) {}
      
      const posStr = positions.join("/") || "?";
      posCounts[posStr] = (posCounts[posStr] || 0) + 1;
      
      if (positions.length > 1) {
        multiPosPlayers.push(`${player.name} (${posStr}, ${value.toFixed(0)})`);
      }
    }

    console.log("\nPlayers by Position:");
    for (const [pos, count] of Object.entries(posCounts).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${pos.padEnd(10)}: ${count}`);
    }

    if (multiPosPlayers.length > 0) {
      console.log("\n🔀 Multi-Position Players:");
      for (const player of multiPosPlayers.sort()) {
        console.log(`  • ${player}`);
      }
    }

    // Strategic Recommendations
    console.log("\n💡 STRATEGIC RECOMMENDATIONS");
    console.log("─".repeat(60));
    
    const weakCats = Object.entries(profile.skaterCategories)
      .filter(([_, cat]) => cat.strength === "weak")
      .sort(([, a], [, b]) => a.zScore - b.zScore)
      .map(([name]) => name);
    
    const shortages = Object.entries(profile.positions)
      .filter(([_, summary]) => summary.surplusScore < -0.7)
      .map(([pos]) => pos);
    
    const surpluses = Object.entries(profile.positions)
      .filter(([_, summary]) => summary.surplusScore > 0.7)
      .map(([pos]) => pos);

    if (weakCats.length > 0) {
      console.log(`\n⚠️  Target these categories for improvement: ${weakCats.join(", ")}`);
    }
    
    if (shortages.length > 0) {
      console.log(`\n⚠️  Positional shortages to address: ${shortages.join(", ")}`);
    }
    
    if (surpluses.length > 0) {
      console.log(`\n✅ Trade from surplus positions: ${surpluses.join(", ")}`);
    }

    if (weakCats.length === 0 && shortages.length === 0) {
      console.log("\n✨ Team looks balanced! No major weaknesses detected.");
    }

  } catch (error) {
    console.error("❌ Error inspecting profile:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

inspectProfile();

