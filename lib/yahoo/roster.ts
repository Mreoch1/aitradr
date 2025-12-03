import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getYahooFantasyClientForRequest } from "@/lib/yahoo/fantasyClient";
import { parseYahooXml, normalizeYahooNode, findFirstPath } from "@/lib/yahoo/normalize";
import prisma from "@/lib/prisma";
import { syncUserLeagues } from "@/lib/yahoo/leagues";
import { syncLeagueStandings } from "@/lib/yahoo/standings";

export interface YahooPlayer {
  playerKey: string;
  name: string;
  teamAbbr?: string;
  positions?: string[];
  primaryPosition?: string;
  status?: string;
}

export interface YahooRosterEntry {
  teamKey: string;
  playerKey: string;
  yahooPosition?: string;
  isBench: boolean;
  isInjuredList: boolean;
}

function flattenYahooPlayerNode(node: any): YahooPlayer | null {
  if (!node) return null;

  const normalized = normalizeYahooNode(node);
  const playerKey = normalized.player_key?.toString() || normalized["@_player_key"]?.toString() || "";
  
  if (!playerKey) return null;

  const name = normalized.name?.full?.toString() || 
               normalized.name?.toString() || 
               normalized["#text"] || 
               "";

  const teamAbbr = normalized.editorial_team_abbr?.toString() || 
                   normalized.team_abbr?.toString();

  let positions: string[] | undefined;
  if (normalized.eligible_positions) {
    const posNode = normalizeYahooNode(normalized.eligible_positions);
    if (posNode.position) {
      const posList = Array.isArray(posNode.position) ? posNode.position : [posNode.position];
      positions = posList.map((p: any) => p.toString()).filter(Boolean);
    }
  }

  const primaryPosition = normalized.primary_position?.toString() || 
                         normalized.position?.toString();

  const status = normalized.status?.toString();

  return {
    playerKey,
    name,
    teamAbbr,
    positions,
    primaryPosition,
    status,
  };
}

function flattenYahooRosterTeamNode(teamNode: any): { teamKey: string; entries: YahooRosterEntry[] } | null {
  if (!teamNode) return null;

  const normalized = normalizeYahooNode(teamNode);
  const teamKey = normalized.team_key?.toString() || normalized["@_team_key"]?.toString() || "";
  
  if (!teamKey) return null;

  const entries: YahooRosterEntry[] = [];
  const roster = normalized.roster || normalized.roster_players;

  if (!roster) return { teamKey, entries: [] };

  const rosterNode = normalizeYahooNode(roster);
  const players = rosterNode.players?.player || rosterNode.player || [];

  const playersList = Array.isArray(players) ? players : [players];

  for (const playerNode of playersList) {
    if (!playerNode) continue;

    const player = normalizeYahooNode(playerNode);
    const playerKey = player.player_key?.toString() || player["@_player_key"]?.toString() || "";
    
    if (!playerKey) continue;

    const selectedPosition = player.selected_position || player.position;
    const positionNode = normalizeYahooNode(selectedPosition);
    const yahooPosition = positionNode.position?.toString() || 
                         positionNode["#text"]?.toString() || 
                         positionNode.toString();

    const isBench = yahooPosition === "BN" || yahooPosition === "Bench";
    const isInjuredList = yahooPosition === "IR" || 
                        yahooPosition === "IR+" || 
                        yahooPosition === "IL" ||
                        yahooPosition === "IL+";

    entries.push({
      teamKey,
      playerKey,
      yahooPosition,
      isBench,
      isInjuredList,
    });
  }

  return { teamKey, entries };
}

export async function fetchLeagueRosters(
  request: NextRequest,
  leagueKey: string
): Promise<Array<{ teamKey: string; entries: YahooRosterEntry[]; players: YahooPlayer[] }>> {
  const client = await getYahooFantasyClientForRequest(request);
  
  let endpoint = `league/${leagueKey}/teams;out=roster`;
  let xmlResponse: string;
  let parsed: any;

  try {
    xmlResponse = await client.request(endpoint);
    parsed = await parseYahooXml(xmlResponse);
  } catch (error) {
    endpoint = `league/${leagueKey}/teams`;
    xmlResponse = await client.request(endpoint);
    parsed = await parseYahooXml(xmlResponse);
  }

  const teamsArray = findFirstPath(parsed, [
    "fantasy_content.league.teams.team",
    "fantasy_content.league.teams",
    "fantasy_content.league.0.teams.0.team",
    "fantasy_content.league.0.teams",
  ]);

  if (!teamsArray) {
    throw new Error(`No rosters found for league ${leagueKey}`);
  }

  const teamsList = Array.isArray(teamsArray) ? teamsArray : [teamsArray];
  const result: Array<{ teamKey: string; entries: YahooRosterEntry[]; players: YahooPlayer[] }> = [];

  for (const teamNode of teamsList) {
    const teamData = flattenYahooRosterTeamNode(teamNode);
    if (!teamData) continue;

    const players: YahooPlayer[] = [];
    const roster = normalizeYahooNode(teamNode.roster || teamNode.roster_players);
    const playersList = roster?.players?.player || roster?.player || [];
    const playersArray = Array.isArray(playersList) ? playersList : [playersList];

    for (const playerNode of playersArray) {
      const player = flattenYahooPlayerNode(playerNode);
      if (player) {
        players.push(player);
      }
    }

    if (teamData.entries.length > 0 || players.length > 0) {
      result.push({
        teamKey: teamData.teamKey,
        entries: teamData.entries,
        players,
      });
    }
  }

  if (result.length === 0) {
    throw new Error(`No rosters found for league ${leagueKey}`);
  }

  return result;
}

export async function syncLeagueRosters(
  request: NextRequest,
  leagueKey: string
): Promise<Array<{
  teamKey: string;
  teamName: string;
  managerName?: string;
  entries: Array<{
    playerKey: string;
    playerName: string;
    primaryPosition?: string;
    yahooPosition?: string;
    isBench: boolean;
    isInjuredList: boolean;
  }>;
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
  
  console.log("[Yahoo Roster] Looking for league:", { 
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
    console.log("[Yahoo Roster] League not in DB, syncing leagues...");
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
  console.log("[Yahoo Roster] Using league key for API:", apiLeagueKey);

  const rosters = await fetchLeagueRosters(request, apiLeagueKey);

  await prisma.rosterEntry.deleteMany({
    where: {
      userId: session.userId,
      leagueId: league.id,
    },
  });

  const result: Array<{
    teamKey: string;
    teamName: string;
    managerName?: string;
    entries: Array<{
      playerKey: string;
      playerName: string;
      primaryPosition?: string;
      yahooPosition?: string;
      isBench: boolean;
      isInjuredList: boolean;
    }>;
  }> = [];

  for (const roster of rosters) {
    // Create or update the team
    const team = await prisma.team.upsert({
      where: {
        leagueId_teamKey: {
          leagueId: league.id,
          teamKey: roster.teamKey,
        },
      },
      update: {
        name: roster.teamName,
        managerName: roster.managerName,
        updatedAt: new Date(),
      },
      create: {
        userId: session.userId,
        leagueId: league.id,
        teamKey: roster.teamKey,
        name: roster.teamName,
        managerName: roster.managerName,
      },
    });
    
    console.log(`[Yahoo Roster] Team upserted: ${team.name} (${team.teamKey})`);

    const entries: Array<{
      playerKey: string;
      playerName: string;
      primaryPosition?: string;
      yahooPosition?: string;
      isBench: boolean;
      isInjuredList: boolean;
    }> = [];

    for (const player of roster.players) {
      const playerRecord = await prisma.player.upsert({
        where: { playerKey: player.playerKey },
        update: {
          name: player.name,
          teamAbbr: player.teamAbbr,
          positions: player.positions ? JSON.stringify(player.positions) : null,
          primaryPosition: player.primaryPosition,
          status: player.status,
          updatedAt: new Date(),
        },
        create: {
          playerKey: player.playerKey,
          name: player.name,
          teamAbbr: player.teamAbbr,
          positions: player.positions ? JSON.stringify(player.positions) : null,
          primaryPosition: player.primaryPosition,
          status: player.status,
        },
      });

      const entry = roster.entries.find((e) => e.playerKey === player.playerKey);
      if (entry) {
        await prisma.rosterEntry.create({
          data: {
            userId: session.userId,
            leagueId: league.id,
            teamId: team.id,
            playerId: playerRecord.id,
            yahooPosition: entry.yahooPosition,
            isBench: entry.isBench,
            isInjuredList: entry.isInjuredList,
          },
        });

        entries.push({
          playerKey: player.playerKey,
          playerName: player.name,
          primaryPosition: player.primaryPosition,
          yahooPosition: entry.yahooPosition,
          isBench: entry.isBench,
          isInjuredList: entry.isInjuredList,
        });
      }
    }

    result.push({
      teamKey: roster.teamKey,
      teamName: team.name,
      managerName: team.managerName || undefined,
      entries,
    });
  }

  return result;
}

