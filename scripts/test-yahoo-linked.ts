import "dotenv/config";

interface YahooStatusResponse {
  linked: boolean;
  authenticated: boolean;
  yahooUserId?: string;
  expiresAt?: string | null;
  linkedAt?: string;
  error?: string;
}

interface YahooMetadataResponse {
  ok: boolean;
  gameKey?: string;
  season?: string;
  statDefinitionsSummary?: {
    count: number;
    sample: Array<{ id: string; name: string; displayName?: string }>;
  };
  error?: string;
}

interface YahooLeague {
  leagueKey: string;
  name: string;
  season: string;
  sport: string;
  teamCount?: number;
}

interface YahooLeaguesResponse {
  ok: boolean;
  leagues?: YahooLeague[];
  error?: string;
}

interface YahooStanding {
  teamKey: string;
  teamName: string;
  managerName?: string;
  wins: number;
  losses: number;
  ties: number;
  rank?: number;
  pointsFor?: number;
  pointsAgainst?: number;
}

interface YahooStandingsResponse {
  ok: boolean;
  leagueKey?: string;
  standings?: YahooStanding[];
  error?: string;
}

interface YahooRosterEntry {
  playerKey: string;
  playerName: string;
  teamAbbr?: string;
  positions?: string[];
  yahooPosition?: string;
  isBench?: boolean;
  isInjured?: boolean;
}

interface YahooRosterTeam {
  teamKey: string;
  teamName: string;
  managerName?: string;
  entries: YahooRosterEntry[];
}

interface YahooRosterResponse {
  ok: boolean;
  leagueKey?: string;
  rosters?: YahooRosterTeam[];
  error?: string;
}

async function testYahooLinked() {
  const baseUrl = "http://localhost:3000";
  let sessionCookie: string | null = null;

  try {
    console.log("=== Testing Yahoo Linked Account Endpoints ===\n");

    // Step 1: Sign in
    console.log("1. Signing in as yahoo-test@example.com...");
    const signinResponse = await fetch(`${baseUrl}/api/auth/signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "yahoo-test@example.com",
        password: "password123",
      }),
    });

    const setCookieHeader = signinResponse.headers.get("set-cookie");
    if (setCookieHeader) {
      sessionCookie = setCookieHeader.split(";")[0];
      console.log("   ✓ Session cookie captured");
    } else {
      const signinData = await signinResponse.json();
      console.error("   ✗ No session cookie:", JSON.stringify(signinData, null, 2));
      process.exit(1);
    }

    if (!sessionCookie) {
      console.error("   ✗ Failed to get session cookie");
      process.exit(1);
    }

    const cookieHeader = sessionCookie;

    // Step 2: Test /api/auth/yahoo/status
    console.log("\n2. Testing /api/auth/yahoo/status...");
    const statusResponse = await fetch(`${baseUrl}/api/auth/yahoo/status`, {
      headers: { Cookie: cookieHeader },
    });

    const statusData: YahooStatusResponse = await statusResponse.json();
    console.log("   Status:", statusResponse.status);
    if (statusResponse.status === 200) {
      console.log("   ✓ linked:", statusData.linked);
      console.log("   ✓ authenticated:", statusData.authenticated);
      if (statusData.linked) {
        console.log("   ✓ yahooUserId:", statusData.yahooUserId || "(not present)");
        console.log("   ✓ expiresAt:", statusData.expiresAt || "(not present)");
      } else {
        console.log("   ✗ Yahoo account not linked");
        console.log("   Full response:", JSON.stringify(statusData, null, 2));
        process.exit(1);
      }
    } else {
      console.error("   ✗ Unexpected status:", statusResponse.status);
      console.error("   Response:", JSON.stringify(statusData, null, 2));
      process.exit(1);
    }

    // Step 3: Test /api/yahoo/metadata
    console.log("\n3. Testing /api/yahoo/metadata...");
    const metadataResponse = await fetch(`${baseUrl}/api/yahoo/metadata`, {
      headers: { Cookie: cookieHeader },
    });

    const metadataData: YahooMetadataResponse = await metadataResponse.json();
    console.log("   Status:", metadataResponse.status);
    if (metadataResponse.status === 200 && metadataData.ok) {
      console.log("   ✓ gameKey:", metadataData.gameKey);
      console.log("   ✓ season:", metadataData.season);
      if (metadataData.statDefinitionsSummary) {
        console.log("   ✓ statDefinitions count:", metadataData.statDefinitionsSummary.count);
      }
    } else {
      console.error("   ✗ Request failed or not ok");
      console.error("   Response:", JSON.stringify(metadataData, null, 2));
      process.exit(1);
    }

    // Step 4: Test /api/yahoo/leagues
    console.log("\n4. Testing /api/yahoo/leagues...");
    const leaguesResponse = await fetch(`${baseUrl}/api/yahoo/leagues`, {
      headers: { Cookie: cookieHeader },
    });

    const leaguesData: YahooLeaguesResponse = await leaguesResponse.json();
    console.log("   Status:", leaguesResponse.status);
    if (leaguesResponse.status === 200 && leaguesData.ok && leaguesData.leagues) {
      console.log("   ✓ Number of leagues:", leaguesData.leagues.length);
      leaguesData.leagues.forEach((league, idx) => {
        console.log(`   League ${idx + 1}:`);
        console.log(`     - leagueKey: ${league.leagueKey}`);
        console.log(`     - name: ${league.name}`);
        console.log(`     - season: ${league.season}`);
        console.log(`     - sport: ${league.sport}`);
        console.log(`     - teamCount: ${league.teamCount || "(not present)"}`);
      });

      // Step 5: Choose target league
      const targetLeague = leaguesData.leagues.find((l) => l.sport === "nhl") || leaguesData.leagues[0];
      const targetLeagueKey = targetLeague.leagueKey;
      console.log(`\n   Selected target league: ${targetLeague.name} (${targetLeagueKey})`);

      // Step 6: Test /api/yahoo/standings
      console.log("\n5. Testing /api/yahoo/standings...");
      const standingsResponse = await fetch(
        `${baseUrl}/api/yahoo/standings?leagueKey=${encodeURIComponent(targetLeagueKey)}`,
        {
          headers: { Cookie: cookieHeader },
        }
      );

      const standingsData: YahooStandingsResponse = await standingsResponse.json();
      console.log("   Status:", standingsResponse.status);
      if (standingsResponse.status === 200 && standingsData.ok && standingsData.standings) {
        console.log("   ✓ Number of teams:", standingsData.standings.length);
        console.log("\n   Top 3 teams:");
        standingsData.standings
          .sort((a, b) => (a.rank || 999) - (b.rank || 999))
          .slice(0, 3)
          .forEach((team, idx) => {
            console.log(`   ${idx + 1}. ${team.teamName} (${team.managerName || "N/A"})`);
            console.log(`      Rank: ${team.rank || "N/A"}, W: ${team.wins}, L: ${team.losses}, T: ${team.ties}`);
          });
      } else {
        console.error("   ✗ Request failed or not ok");
        console.error("   Response:", JSON.stringify(standingsData, null, 2));
        process.exit(1);
      }

      // Step 7: Test /api/yahoo/roster
      console.log("\n6. Testing /api/yahoo/roster...");
      const rosterResponse = await fetch(
        `${baseUrl}/api/yahoo/roster?leagueKey=${encodeURIComponent(targetLeagueKey)}`,
        {
          headers: { Cookie: cookieHeader },
        }
      );

      const rosterData: YahooRosterResponse = await rosterResponse.json();
      console.log("   Status:", rosterResponse.status);
      if (rosterResponse.status === 200 && rosterData.ok && rosterData.rosters) {
        console.log("   ✓ Number of teams with rosters:", rosterData.rosters.length);
        if (rosterData.rosters.length > 0) {
          const firstTeam = rosterData.rosters[0];
          console.log(`\n   First team: ${firstTeam.teamName} (${firstTeam.managerName || "N/A"})`);
          console.log(`   ✓ Number of players: ${firstTeam.entries.length}`);
          console.log("\n   First 5 players:");
          firstTeam.entries.slice(0, 5).forEach((player, idx) => {
            console.log(`   ${idx + 1}. ${player.playerName}`);
            console.log(`      Positions: ${(player.positions || []).join(", ") || "N/A"}`);
            console.log(`      Yahoo Position: ${player.yahooPosition || "N/A"}`);
            console.log(`      Team: ${player.teamAbbr || "N/A"}`);
            console.log(`      Bench: ${player.isBench ? "Yes" : "No"}`);
            console.log(`      Injured: ${player.isInjured ? "Yes" : "No"}`);
          });
        }
      } else {
        console.error("   ✗ Request failed or not ok");
        console.error("   Response:", JSON.stringify(rosterData, null, 2));
        process.exit(1);
      }

      console.log("\n=== All Yahoo Linked Tests Passed ===");
    } else {
      console.error("   ✗ Request failed or no leagues");
      console.error("   Response:", JSON.stringify(leaguesData, null, 2));
      process.exit(1);
    }
  } catch (error) {
    console.error("Test error:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    process.exit(1);
  }
}

testYahooLinked();

