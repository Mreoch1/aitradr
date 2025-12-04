/**
 * Quick script to sync a league by its key
 */
import prisma from "../lib/prisma";
import { toFixedSafe } from "../lib/utils/numberFormat";
import { buildAllTeamProfiles, storeTeamProfiles } from "../lib/ai/teamProfile";

async function syncLeague() {
  const leagueKey = process.argv[2] || "465.l.9080";

  console.log("🔍 Searching for league:", leagueKey);

  // Try various normalizations
  const normalizedKey = leagueKey.replace(/\.1\./g, '.l.');
  const reverseKey = leagueKey.replace(/\.l\./g, '.1.');

  try {
    const league = await prisma.league.findFirst({
      where: {
        OR: [
          { leagueKey: leagueKey },
          { leagueKey: normalizedKey },
          { leagueKey: reverseKey },
        ],
      },
      include: { teams: true }
    });

    if (!league) {
      console.error("❌ League not found. Tried:", leagueKey, normalizedKey, reverseKey);
      process.exit(1);
    }

    console.log("✅ Found league:", league.name);
    console.log("📊 Teams:", league.teams.length);
    console.log("🔑 League ID:", league.id);

    console.log("\n🤖 Building team profiles...");
    const profiles = await buildAllTeamProfiles(league.id);
    console.log("✅ Built", profiles.length, "profiles");

    console.log("\n💾 Storing profiles...");
    await storeTeamProfiles(league.id, profiles);
    console.log("✅ Profiles cached successfully");

    console.log("\n✨ Done! AI suggestions should now work.");

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

syncLeague();

