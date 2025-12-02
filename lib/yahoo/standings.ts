import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getYahooFantasyClientForRequest } from "@/lib/yahoo/fantasyClient";
import { parseYahooXml, normalizeYahooNode, findFirstPath } from "@/lib/yahoo/normalize";
import { prisma } from "@prisma/client";
import { syncUserLeagues } from "@/lib/yahoo/leagues";

export interface YahooTeamStanding {
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

function extractStandingsFromResponse(parsed: any, leagueKey: string): YahooTeamStanding[] {
  const teamsArray = findFirstPath(parsed, [
    "fantasy_content.league.standings.teams.team",
    "fantasy_content.league.standings.teams",
    "fantasy_content.league.teams.team",
    "fantasy_content.league.teams",
    "fantasy_content.league.0.standings.0.teams.0.team",
    "fantasy_content.league.0.standings.0.teams",
    "fantasy_content.league.0.teams.0.team",
    "fantasy_content.league.0.teams",
  ]);

  if (!teamsArray) {
    throw new Error(`No standings found for league ${leagueKey}`);
  }

  const standings: YahooTeamStanding[] = [];
  const teamsList = Array.isArray(teamsArray) ? teamsArray : [teamsArray];

  for (const team of teamsList) {
    const normalized = normalizeYahooNode(team);
    if (!normalized || !normalized.team_key) continue;

    const teamKey = normalized.team_key?.toString() || "";
    const teamName = normalized.name?.toString() || "";

    let managerName: string | undefined;
    if (normalized.managers) {
      const managers = normalizeYahooNode(normalized.managers);
      if (managers.manager) {
        const manager = normalizeYahooNode(managers.manager);
        managerName = manager.nickname?.toString() || manager.name?.toString();
      }
    }

    const standingsData = normalized.team_standings || normalized.standings;
    const outcomeTotals = standingsData?.outcome_totals || {};
    const wins = parseInt(outcomeTotals.wins?.toString() || "0", 10);
    const losses = parseInt(outcomeTotals.losses?.toString() || "0", 10);
    const ties = parseInt(outcomeTotals.ties?.toString() || "0", 10);

    const rank = standingsData?.rank
      ? parseInt(standingsData.rank.toString(), 10)
      : undefined;

    const pointsFor = standingsData?.points_for
      ? parseFloat(standingsData.points_for.toString())
      : undefined;

    const pointsAgainst = standingsData?.points_against
      ? parseFloat(standingsData.points_against.toString())
      : undefined;

    if (teamKey && teamName) {
      standings.push({
        teamKey,
        teamName,
        managerName,
        wins,
        losses,
        ties,
        rank,
        pointsFor,
        pointsAgainst,
      });
    }
  }

  if (standings.length === 0) {
    throw new Error(`No standings found for league ${leagueKey}`);
  }

  return standings;
}

export async function fetchLeagueStandings(
  request: NextRequest,
  leagueKey: string
): Promise<YahooTeamStanding[]> {
  const client = await getYahooFantasyClientForRequest(request);
  const endpoint = `league/${leagueKey}/standings`;
  const xmlResponse = await client.request(endpoint);
  const parsed = await parseYahooXml(xmlResponse);

  return extractStandingsFromResponse(parsed, leagueKey);
}

export async function syncLeagueStandings(
  request: NextRequest,
  leagueKey: string
): Promise<Array<{
  teamKey: string;
  teamName: string;
  managerName?: string;
  wins: number;
  losses: number;
  ties: number;
  rank?: number;
  pointsFor?: number;
  pointsAgainst?: number;
}>> {
  const session = await getSession();

  if (!session) {
    throw new Error("Not authenticated");
  }

  // Normalize league key - handle both 'l' and '1' formats
  // Yahoo uses 'l' in API responses but URLs might have '1'
  // Also handle case where database might have '1' instead of 'l'
  const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
  const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');
  
  console.log("[Yahoo Standings] Looking for league:", { 
    original: leagueKey, 
    normalized: normalizedLeagueKey,
    reverseNormalized: reverseNormalizedKey 
  });

  // Try multiple variations of the league key
  let league = await prisma.league.findFirst({
    where: {
      userId: session.userId,
      OR: [
        { leagueKey: normalizedLeagueKey },
        { leagueKey: reverseNormalizedKey },
        { leagueKey: leagueKey },
      ],
    },
  });

  if (!league) {
    console.log("[Yahoo Standings] League not in DB, syncing leagues...");
    await syncUserLeagues(request);
    league = await prisma.league.findFirst({
      where: {
        userId: session.userId,
        OR: [
          { leagueKey: normalizedLeagueKey },
          { leagueKey: reverseNormalizedKey },
          { leagueKey: leagueKey },
        ],
      },
    });
  }

  if (!league) {
    throw new Error(`League not found for user: ${leagueKey} (normalized: ${normalizedLeagueKey})`);
  }

  // Use the league key from database for API calls
  const apiLeagueKey = league.leagueKey;
  console.log("[Yahoo Standings] Using league key for API:", apiLeagueKey);

  const standings = await fetchLeagueStandings(request, apiLeagueKey);

  const result = [];

  for (const standing of standings) {
    const team = await prisma.team.upsert({
      where: {
        leagueId_teamKey: {
          leagueId: league.id,
          teamKey: standing.teamKey,
        },
      },
      update: {
        name: standing.teamName,
        managerName: standing.managerName,
        updatedAt: new Date(),
      },
      create: {
        userId: session.userId,
        leagueId: league.id,
        teamKey: standing.teamKey,
        name: standing.teamName,
        managerName: standing.managerName,
      },
    });

    await prisma.teamStanding.upsert({
      where: {
        teamId: team.id,
      },
      update: {
        wins: standing.wins,
        losses: standing.losses,
        ties: standing.ties,
        rank: standing.rank,
        pointsFor: standing.pointsFor,
        pointsAgainst: standing.pointsAgainst,
        updatedAt: new Date(),
      },
      create: {
        teamId: team.id,
        wins: standing.wins,
        losses: standing.losses,
        ties: standing.ties,
        rank: standing.rank,
        pointsFor: standing.pointsFor,
        pointsAgainst: standing.pointsAgainst,
      },
    });

    result.push({
      teamKey: standing.teamKey,
      teamName: standing.teamName,
      managerName: standing.managerName,
      wins: standing.wins,
      losses: standing.losses,
      ties: standing.ties,
      rank: standing.rank,
      pointsFor: standing.pointsFor,
      pointsAgainst: standing.pointsAgainst,
    });
  }

  return result;
}

