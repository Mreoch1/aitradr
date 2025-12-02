import "dotenv/config";

async function testPages() {
  const baseUrl = "http://localhost:3000";
  let sessionCookie: string | null = null;
  let targetLeagueKey: string | null = null;

  try {
    console.log("=== Testing Page Rendering ===\n");

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
      console.error("   ✗ No session cookie");
      process.exit(1);
    }

    const cookieHeader = sessionCookie;

    // Get a league key first
    console.log("\n2. Fetching leagues to get a target league key...");
    const leaguesResponse = await fetch(`${baseUrl}/api/yahoo/leagues`, {
      headers: { Cookie: cookieHeader },
    });

    const leaguesData = await leaguesResponse.json();
    if (leaguesData.ok && leaguesData.leagues && leaguesData.leagues.length > 0) {
      targetLeagueKey = leaguesData.leagues[0].leagueKey;
      console.log(`   ✓ Target league key: ${targetLeagueKey}`);
    } else {
      console.error("   ✗ Could not get league key");
      console.error("   Response:", JSON.stringify(leaguesData, null, 2));
      process.exit(1);
    }

    // Step 3: Test /dashboard
    console.log("\n3. Testing /dashboard page...");
    const dashboardResponse = await fetch(`${baseUrl}/dashboard`, {
      headers: { Cookie: cookieHeader },
    });

    console.log("   Status:", dashboardResponse.status);
    const dashboardHtml = await dashboardResponse.text();
    if (dashboardResponse.status === 200) {
      const hasYahooLinked = dashboardHtml.includes("Yahoo") || dashboardHtml.includes("yahoo");
      const hasYahooUserId = dashboardHtml.includes("yahooUserId") || dashboardHtml.includes("Yahoo User ID");
      console.log("   ✓ Contains 'Yahoo' text:", hasYahooLinked);
      console.log("   ✓ Contains Yahoo User ID indicator:", hasYahooUserId);
      if (!hasYahooLinked) {
        console.log("   ⚠ Warning: Dashboard HTML may not show Yahoo status");
      }
    } else {
      console.error("   ✗ Unexpected status:", dashboardResponse.status);
      console.error("   Response preview:", dashboardHtml.substring(0, 500));
      process.exit(1);
    }

    // Step 4: Test /leagues
    console.log("\n4. Testing /leagues page...");
    const leaguesPageResponse = await fetch(`${baseUrl}/leagues`, {
      headers: { Cookie: cookieHeader },
    });

    console.log("   Status:", leaguesPageResponse.status);
    const leaguesPageHtml = await leaguesPageResponse.text();
    if (leaguesPageResponse.status === 200) {
      // Check for league names from the API response
      const hasLeagueName = leaguesData.leagues.some((league: any) =>
        leaguesPageHtml.includes(league.name)
      );
      console.log("   ✓ Contains league name from API:", hasLeagueName);
      if (!hasLeagueName && leaguesData.leagues.length > 0) {
        console.log("   ⚠ Warning: League name not found in HTML");
        console.log("   Expected league name:", leaguesData.leagues[0].name);
      }
    } else {
      console.error("   ✗ Unexpected status:", leaguesPageResponse.status);
      console.error("   Response preview:", leaguesPageHtml.substring(0, 500));
      process.exit(1);
    }

    // Step 5: Get standings and roster data for league detail page
    console.log("\n5. Fetching standings and roster for league detail page...");
    const standingsResponse = await fetch(
      `${baseUrl}/api/yahoo/standings?leagueKey=${encodeURIComponent(targetLeagueKey)}`,
      {
        headers: { Cookie: cookieHeader },
      }
    );
    const standingsData = await standingsResponse.json();

    const rosterResponse = await fetch(
      `${baseUrl}/api/yahoo/roster?leagueKey=${encodeURIComponent(targetLeagueKey)}`,
      {
        headers: { Cookie: cookieHeader },
      }
    );
    const rosterData = await rosterResponse.json();

    // Step 6: Test /league/[leagueKey]
    console.log("\n6. Testing /league/[leagueKey] page...");
    const leagueDetailResponse = await fetch(
      `${baseUrl}/league/${encodeURIComponent(targetLeagueKey)}`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    console.log("   Status:", leagueDetailResponse.status);
    const leagueDetailHtml = await leagueDetailResponse.text();
    if (leagueDetailResponse.status === 200) {
      // Check for team names from standings
      let foundTeamNames = 0;
      if (standingsData.ok && standingsData.standings) {
        standingsData.standings.slice(0, 3).forEach((team: any) => {
          if (leagueDetailHtml.includes(team.teamName)) {
            foundTeamNames++;
          }
        });
      }
      console.log(`   ✓ Found ${foundTeamNames} team names from standings in HTML`);

      // Check for player names from roster
      let foundPlayerNames = 0;
      if (rosterData.ok && rosterData.rosters && rosterData.rosters.length > 0) {
        rosterData.rosters[0].entries.slice(0, 5).forEach((entry: any) => {
          if (leagueDetailHtml.includes(entry.playerName)) {
            foundPlayerNames++;
          }
        });
      }
      console.log(`   ✓ Found ${foundPlayerNames} player names from roster in HTML`);

      if (foundTeamNames === 0 && standingsData.ok && standingsData.standings.length > 0) {
        console.log("   ⚠ Warning: No team names found in HTML");
        console.log("   Expected team name:", standingsData.standings[0].teamName);
      }
      if (foundPlayerNames === 0 && rosterData.ok && rosterData.rosters.length > 0) {
        console.log("   ⚠ Warning: No player names found in HTML");
        if (rosterData.rosters[0].entries.length > 0) {
          console.log("   Expected player name:", rosterData.rosters[0].entries[0].playerName);
        }
      }
    } else {
      console.error("   ✗ Unexpected status:", leagueDetailResponse.status);
      console.error("   Response preview:", leagueDetailHtml.substring(0, 500));
      process.exit(1);
    }

    console.log("\n=== All Page Tests Completed ===");
  } catch (error) {
    console.error("Test error:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    process.exit(1);
  }
}

testPages();

