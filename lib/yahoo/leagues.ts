import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getYahooFantasyClientForRequest } from "@/lib/yahoo/fantasyClient";
import { parseYahooXml, normalizeYahooNode, findFirstPath } from "@/lib/yahoo/normalize";
import prisma from "@/lib/prisma";

export interface YahooLeague {
  leagueKey: string;
  name: string;
  season: string;
  sport: string;
  teamCount?: number;
}

function extractLeaguesFromResponse(parsed: any): YahooLeague[] {
  // Try multiple path variations to match Yahoo's actual XML structure
  const leaguesArray = findFirstPath(parsed, [
    "fantasy_content.users.user.games.game.0.leagues.league",
    "fantasy_content.users.user.games.game.0.leagues",
    "fantasy_content.users.user.games.game.leagues.league",
    "fantasy_content.users.user.games.game.leagues",
    "fantasy_content.users.0.user.0.games.0.game.0.leagues.0.league",
    "fantasy_content.users.0.user.0.games.0.game.0.leagues",
    "fantasy_content.users.0.user.0.games.0.game",
    "fantasy_content.users.0.user",
  ]);
  
  // Also try to get game context for season/gameCode if leagues are nested in games
  let gameContext: any = null;
  const gamesPath = findFirstPath(parsed, [
    "fantasy_content.users.user.games.game",
    "fantasy_content.users.0.user.0.games.0.game",
  ]);
  if (gamesPath && Array.isArray(gamesPath) && gamesPath.length > 0) {
    gameContext = gamesPath[0];
  }

  if (!leaguesArray) {
    console.error("[Yahoo Leagues] No leagues found - full parsed structure:", JSON.stringify(parsed, null, 2).substring(0, 2000));
    throw new Error("No leagues found for user");
  }

  const leagues: YahooLeague[] = [];
  const processLeague = (league: any, gameContextOverride?: any): void => {
    if (!league) return;

    const normalized = normalizeYahooNode(league);

    if (Array.isArray(normalized)) {
      normalized.forEach(processLeague);
      return;
    }

    const leagueKey = normalized?.league_key || normalized?.["@_league_key"] || "";
    const name = normalized?.name || normalized?.["#text"] || "";
    // Season might be in the parent game object - use gameContext if available
    const season = normalized?.season || gameContextOverride?.season || gameContext?.season || "";
    // Game code might be in parent game object
    const gameCode = normalized?.game_code || normalized?.game_id || gameContextOverride?.code || gameContext?.code || "";
    const numTeams = normalized?.num_teams;
    
    if (leagueKey && name) {
      leagues.push({
        leagueKey: leagueKey.toString(),
        name: name.toString(),
        season: season ? season.toString() : "",
        sport: gameCode ? gameCode.toString() : "",
        teamCount: numTeams ? parseInt(numTeams.toString(), 10) : undefined,
      });
    }
  };

  // Handle different response structures
  if (Array.isArray(leaguesArray)) {
    leaguesArray.forEach((item: any) => {
      if (item && typeof item === "object") {
        if (item.league) {
          const leagueList = Array.isArray(item.league) ? item.league : [item.league];
          leagueList.forEach(processLeague);
        } else {
          processLeague(item);
        }
      }
    });
  } else if (leaguesArray && typeof leaguesArray === "object") {
    // Handle object structure - could be a single league or leagues container
    if (leaguesArray.league) {
      // Container with league(s) inside
      const leagueList = Array.isArray(leaguesArray.league)
        ? leaguesArray.league
        : [leaguesArray.league];
      leagueList.forEach((league: any) => processLeague(league, gameContext));
    } else if (leaguesArray.league_key || leaguesArray.name) {
      // Single league object - process it directly
      processLeague(leaguesArray, gameContext);
    } else {
      // Might be a games array - iterate through games to find leagues
      const gamesList = Array.isArray(leaguesArray) ? leaguesArray : [leaguesArray];
      gamesList.forEach((game: any) => {
        if (game && typeof game === "object" && game.leagues) {
          if (game.leagues.league) {
            const leagueList = Array.isArray(game.leagues.league)
              ? game.leagues.league
              : [game.leagues.league];
            leagueList.forEach(processLeague);
          }
        }
      });
    }
  }

  if (leagues.length === 0) {
    throw new Error("No leagues found for user");
  }

  return leagues;
}

export async function fetchUserLeagues(
  request: NextRequest
): Promise<YahooLeague[]> {
  const client = await getYahooFantasyClientForRequest(request);
  const endpoint = "users;use_login=1/games/leagues";
  const xmlResponse = await client.request(endpoint);
  const parsed = await parseYahooXml(xmlResponse);

  const leagues = extractLeaguesFromResponse(parsed);
  
  // Also try to fetch leagues for game 465 (NHL 2025/26) specifically
  // Sometimes leagues don't show up in the general games/leagues endpoint
  try {
    const game465Endpoint = "users;use_login=1/games;game_keys=465/leagues";
    console.log("[Yahoo Leagues] Also fetching leagues for game 465 (NHL 2025/26)");
    const game465Response = await client.request(game465Endpoint);
    const game465Parsed = await parseYahooXml(game465Response);
    const game465Leagues = extractLeaguesFromResponse(game465Parsed);
    
    // Merge leagues, avoiding duplicates
    const existingKeys = new Set(leagues.map(l => l.leagueKey));
    game465Leagues.forEach(league => {
      if (!existingKeys.has(league.leagueKey)) {
        leagues.push(league);
        console.log("[Yahoo Leagues] Found additional league from game 465:", league.leagueKey, league.name);
      }
    });
  } catch (error) {
    console.log("[Yahoo Leagues] Could not fetch game 465 leagues:", error instanceof Error ? error.message : String(error));
  }

  return leagues;
}

export async function syncUserLeagues(request: NextRequest): Promise<YahooLeague[]> {
  const session = await getSession();

  if (!session) {
    throw new Error("Not authenticated");
  }

  const leagues = await fetchUserLeagues(request);

  // Log all leagues returned by Yahoo
  console.log("[Yahoo Leagues] All leagues returned by Yahoo:");
  leagues.forEach((league, index) => {
    console.log(`[Yahoo Leagues] League ${index + 1}:`, {
      leagueKey: league.leagueKey,
      name: league.name,
      season: league.season,
      sport: league.sport,
      teamCount: league.teamCount,
    });
  });

  for (const league of leagues) {
    await prisma.league.upsert({
      where: {
        userId_leagueKey: {
          userId: session.userId,
          leagueKey: league.leagueKey,
        },
      },
      update: {
        name: league.name,
        season: league.season,
        sport: league.sport,
        teamCount: league.teamCount,
        updatedAt: new Date(),
      },
      create: {
        userId: session.userId,
        leagueKey: league.leagueKey,
        name: league.name,
        season: league.season,
        sport: league.sport,
        teamCount: league.teamCount,
      },
    });
  }

  const storedLeagues = await prisma.league.findMany({
    where: { userId: session.userId },
    select: {
      leagueKey: true,
      name: true,
      season: true,
      sport: true,
      teamCount: true,
    },
  });

  // Filter leagues by league name "ATFH2" OR season 2025/2026 OR league ID 9080
  const targetLeagueName = "ATFH2";
  const targetSeasons = ["2025", "2026"]; // Yahoo might use start year (2025) or end year (2026)
  const targetLeagueId = "9080"; // League ID from Yahoo
  const targetLeagueKey = process.env.TARGET_LEAGUE_KEY;
  const showAllLeagues = process.env.SHOW_ALL_LEAGUES === "true"; // Temporary flag to show all leagues

  console.log("[Yahoo Leagues] Filtering leagues:", {
    targetLeagueName,
    targetSeasons,
    targetLeagueId,
    targetLeagueKey: targetLeagueKey || "not set",
    showAllLeagues,
    totalStoredLeagues: storedLeagues.length,
  });

  // Log all available leagues for debugging
  console.log("[Yahoo Leagues] All available leagues:");
  storedLeagues.forEach((league, index) => {
    console.log(`[Yahoo Leagues]   ${index + 1}. Key: ${league.leagueKey}, Name: ${league.name}, Season: ${league.season}, Sport: ${league.sport}`);
  });

  let filteredLeagues = storedLeagues;

  // If showAllLeagues is enabled, return all leagues (for debugging)
  if (showAllLeagues) {
    console.log("[Yahoo Leagues] SHOW_ALL_LEAGUES=true, returning all leagues");
    return storedLeagues.map((league) => ({
      leagueKey: league.leagueKey,
      name: league.name,
      season: league.season,
      sport: league.sport,
      teamCount: league.teamCount ?? undefined,
    }));
  }

  // If TARGET_LEAGUE_KEY is set, filter to that specific league
  if (targetLeagueKey) {
    filteredLeagues = storedLeagues.filter((league) => league.leagueKey === targetLeagueKey);
    console.log("[Yahoo Leagues] Filtered to target league key:", targetLeagueKey, "Found:", filteredLeagues.length);
  } else {
    // Filter by league name "ATFH2" OR season 2025/2026 OR league ID 9080
    // League keys are in format: GAME_ID.l.LEAGUE_ID or GAME_ID.1.LEAGUE_ID
    filteredLeagues = storedLeagues.filter((league) => {
      const nameMatch = league.name === targetLeagueName || league.name.toLowerCase() === targetLeagueName.toLowerCase();
      const seasonMatch = targetSeasons.includes(league.season);
      // Check if league key ends with .9080 or contains .9080 (league ID 9080)
      const leagueIdMatch = league.leagueKey.endsWith(`.${targetLeagueId}`) || league.leagueKey.includes(`.${targetLeagueId}`);
      return nameMatch || seasonMatch || leagueIdMatch;
    });
    console.log("[Yahoo Leagues] Filtered by name/season/ID:", {
      targetLeagueName,
      targetSeasons,
      targetLeagueId,
      found: filteredLeagues.length,
    });

    // If multiple matches, prefer the one matching the name, then newest season
    if (filteredLeagues.length > 1) {
      filteredLeagues.sort((a, b) => {
        // First priority: name match
        const aNameMatch = a.name === targetLeagueName;
        const bNameMatch = b.name === targetLeagueName;
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        // Second priority: newest season
        const seasonA = parseInt(a.season) || 0;
        const seasonB = parseInt(b.season) || 0;
        return seasonB - seasonA;
      });
      console.log("[Yahoo Leagues] Sorted matches (name match first, then newest season)");
    }
  }

  // If no league matches, log all returned leagues for debugging
  if (filteredLeagues.length === 0) {
    console.error("[Yahoo Leagues] No matching league found. All available leagues:");
    storedLeagues.forEach((league) => {
      console.error(`[Yahoo Leagues]   - Key: ${league.leagueKey}, Name: ${league.name}, Season: ${league.season}, GameCode: ${league.sport}`);
    });
    console.warn("[Yahoo Leagues] Consider setting SHOW_ALL_LEAGUES=true in .env to see all leagues");
  }

  return filteredLeagues.map((league) => ({
    leagueKey: league.leagueKey,
    name: league.name,
    season: league.season,
    sport: league.sport,
    teamCount: league.teamCount ?? undefined,
  }));
}

