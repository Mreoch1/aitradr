/**
 * Admin Script: List Teams
 * 
 * List all teams in a league with their IDs and profile status.
 * 
 * Usage:
 *   npx tsx scripts/list-teams.ts <leagueId>
 */

import prisma from "../lib/prisma";

async function listTeams() {
  const leagueId = process.argv[2];

  if (!leagueId) {
    console.error("❌ Usage: npx tsx scripts/list-teams.ts <leagueId>");
    console.error("\nTo find leagueId, check your database or look in the URL:");
    console.error("  /league/<leagueKey>/trade → query leagues table by leagueKey");
    process.exit(1);
  }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: {
        teams: {
          include: {
            profile: true,
            rosterEntries: true
          },
          orderBy: {
            name: 'asc'
          }
        }
      }
    });

    if (!league) {
      console.error("❌ League not found:", leagueId);
      process.exit(1);
    }

    console.log("🏒 League:", league.name);
    console.log("📅 Season:", league.season);
    console.log("🔑 League Key:", league.leagueKey);
    console.log("📊 Teams:", league.teams.length);
    console.log();

    console.log("─".repeat(80));
    console.log("Team Name".padEnd(30), "| Team ID".padEnd(32), "| Roster | Profile");
    console.log("─".repeat(80));

    for (const team of league.teams) {
      const profileStatus = team.profile ? "✅" : "❌";
      const profileAge = team.profile 
        ? ` (${Math.round((Date.now() - new Date(team.profile.lastUpdated).getTime()) / 1000 / 60)}m ago)`
        : "";
      
      console.log(
        team.name.padEnd(30),
        `| ${team.id.padEnd(30)}`,
        `| ${team.rosterEntries.length.toString().padStart(6)}`,
        `| ${profileStatus}${profileAge}`
      );
    }

    console.log("─".repeat(80));

    const teamsWithProfiles = league.teams.filter(t => t.profile).length;
    const teamsWithoutProfiles = league.teams.length - teamsWithProfiles;

    console.log();
    console.log(`✅ Teams with profiles: ${teamsWithProfiles}`);
    if (teamsWithoutProfiles > 0) {
      console.log(`❌ Teams without profiles: ${teamsWithoutProfiles}`);
      console.log();
      console.log("To rebuild profiles:");
      console.log(`  npx tsx scripts/rebuild-team-profiles.ts ${leagueId}`);
    } else {
      console.log();
      console.log("To inspect a specific team:");
      console.log("  npx tsx scripts/inspect-team-profile.ts <teamId>");
    }

  } catch (error) {
    console.error("❌ Error listing teams:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

listTeams();

