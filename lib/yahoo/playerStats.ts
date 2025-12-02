/**
 * Player stats fetching and management from Yahoo Fantasy API
 */

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getYahooFantasyClientForRequest } from "@/lib/yahoo/fantasyClient";
import { parseYahooXml, normalizeYahooNode, findFirstPath } from "@/lib/yahoo/normalize";
import { prisma } from "@prisma/client";
import { getStatDefinitionsForCurrentGame } from "@/lib/yahoo/statDefinitions";

export interface PlayerStatData {
  statId: string;
  statName: string;
  value: number;
}

/**
 * Fetch player stats from Yahoo Fantasy API
 * Tries multiple endpoints: league players with stats, then individual player stats
 */
export async function fetchPlayerStats(
  request: NextRequest,
  playerKey: string,
  leagueKey?: string
): Promise<PlayerStatData[]> {
  const client = await getYahooFantasyClientForRequest(request);
  
  // First, try to get stats from league players endpoint if leagueKey is provided
  if (leagueKey) {
    try {
      const leagueEndpoint = `league/${leagueKey}/players;player_keys=${playerKey}/stats`;
      console.log(`[PlayerStats] Trying league players endpoint: ${leagueEndpoint}`);
      const xmlResponse = await client.request(leagueEndpoint);
      const parsed = await parseYahooXml(xmlResponse);
      
      // Try to find stats in league players response
      const statsArray = findFirstPath(parsed, [
        "fantasy_content.league.0.players.0.player.0.player_stats.0.stats.0.stat",
        "fantasy_content.league.0.players.0.player.0.player_stats.0.stat",
        "fantasy_content.league.players.player.player_stats.stats.stat",
        "fantasy_content.league.players.player.player_stats.stat",
      ]);
      
      if (statsArray) {
        console.log(`[PlayerStats] Found stats via league players endpoint for ${playerKey}`);
        const statsList = Array.isArray(statsArray) ? statsArray : [statsArray];
        
        // Load stat definitions
        const statDefinitions = await getStatDefinitionsForCurrentGame(request);
        if (statDefinitions && Object.keys(statDefinitions.byId).length > 0) {
          const playerStats: PlayerStatData[] = [];
          for (const statNode of statsList) {
            const stat = normalizeYahooNode(statNode);
            const statId = stat.stat_id?.toString() || stat["@_stat_id"]?.toString() || "";
            const value = parseFloat(stat.value?.toString() || stat["#text"]?.toString() || "0") || 0;
            if (!statId) continue;
            const statDef = statDefinitions.byId[statId];
            const statName = statDef?.name || statDef?.display_name || `Stat ${statId}`;
            playerStats.push({ statId, statName, value });
          }
          return playerStats;
        }
      }
    } catch (error) {
      console.warn(`[PlayerStats] League players endpoint failed for ${playerKey}, trying individual endpoint:`, error);
    }
  }
  
  // Fallback to individual player stats endpoint
  const endpoint = `player/${playerKey}/stats`;
  
  try {
    console.log(`[PlayerStats] Fetching stats for player ${playerKey} from endpoint: ${endpoint}`);
    const xmlResponse = await client.request(endpoint);
    console.log(`[PlayerStats] Received XML response (length: ${xmlResponse.length}) for player ${playerKey}`);
    const parsed = await parseYahooXml(xmlResponse);
    console.log(`[PlayerStats] Parsed XML for player ${playerKey}. Top-level keys:`, Object.keys(parsed || {}));
    
    // Find player stats in the response
    const statsArray = findFirstPath(parsed, [
      "fantasy_content.player.0.player_stats.0.stats.0.stat",
      "fantasy_content.player.0.player_stats.0.stat",
      "fantasy_content.player.player_stats.stats.stat",
      "fantasy_content.player.player_stats.stat",
    ]);
    
    if (!statsArray) {
      console.warn(`[PlayerStats] No stats array found in response for player ${playerKey}`);
      console.log(`[PlayerStats] Parsed response keys:`, Object.keys(parsed || {}));
      // Try to find what we actually got
      if (parsed?.fantasy_content) {
        console.log(`[PlayerStats] fantasy_content keys:`, Object.keys(parsed.fantasy_content || {}));
        if (parsed.fantasy_content.player) {
          const playerNode = normalizeYahooNode(parsed.fantasy_content.player);
          console.log(`[PlayerStats] player node keys:`, Object.keys(playerNode || {}));
        }
      }
      return [];
    }
    
    const statsList = Array.isArray(statsArray) ? statsArray : [statsArray];
    
    // Load stat definitions - this is critical for getting stat names
    let statDefinitions;
    try {
      statDefinitions = await getStatDefinitionsForCurrentGame(request);
      if (!statDefinitions || Object.keys(statDefinitions.byId).length === 0) {
        console.error(`[PlayerStats] Stat definitions are empty for player ${playerKey}`);
        // Return empty array if we can't get stat definitions
        return [];
      }
      console.log(`[PlayerStats] Loaded ${Object.keys(statDefinitions.byId).length} stat definitions for player ${playerKey}`);
    } catch (error) {
      console.error(`[PlayerStats] Failed to load stat definitions for player ${playerKey}:`, error);
      return [];
    }
    
    const playerStats: PlayerStatData[] = [];
    
    for (const statNode of statsList) {
      const stat = normalizeYahooNode(statNode);
      
      // Try multiple ways to get statId
      const statId = stat.stat_id?.toString() || 
                     stat["@_stat_id"]?.toString() || 
                     stat.statId?.toString() ||
                     stat["stat_id"]?.toString() ||
                     "";
      
      // Try multiple ways to get value
      const value = parseFloat(
        stat.value?.toString() || 
        stat["#text"]?.toString() || 
        stat["value"]?.toString() ||
        "0"
      ) || 0;
      
      if (!statId) {
        console.warn(`[PlayerStats] Skipping stat with no statId for player ${playerKey}. Raw stat node keys:`, Object.keys(stat));
        continue;
      }
      
      // Get stat name from definitions
      const statDef = statDefinitions.byId[statId];
      if (!statDef) {
        console.warn(`[PlayerStats] Stat definition not found for statId "${statId}" (player ${playerKey}). Sample available statIds:`, Object.keys(statDefinitions.byId).slice(0, 5));
        // Log the first few stat definitions to see their format
        if (Object.keys(statDefinitions.byId).length > 0) {
          const sampleDef = statDefinitions.byId[Object.keys(statDefinitions.byId)[0]];
          console.warn(`[PlayerStats] Sample stat definition format:`, { stat_id: sampleDef.stat_id, name: sampleDef.name });
        }
        // Skip stats without definitions rather than using statId as name
        continue;
      }
      const statName = statDef.name || statDef.display_name || `Stat ${statId}`;
      
      playerStats.push({
        statId,
        statName,
        value,
      });
    }
    
    if (playerStats.length > 0) {
      console.log(`[PlayerStats] Fetched ${playerStats.length} stats for player ${playerKey}. Sample:`, playerStats.slice(0, 3));
    }
    
    return playerStats;
  } catch (error) {
    console.error(`Error fetching stats for player ${playerKey}:`, error);
    return [];
  }
}

/**
 * Sync player stats for a league by fetching team rosters with stats
 * This is the most reliable way to get Yahoo Fantasy stats
 */
export async function syncLeaguePlayerStats(
  request: NextRequest,
  leagueKey: string
): Promise<void> {
  const session = await getSession();
  if (!session) {
    throw new Error("Not authenticated");
  }
  
  // Normalize league key
  const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
  const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');
  
  // Find the league
  const league = await prisma.league.findFirst({
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
    throw new Error(`League not found: ${leagueKey}`);
  }
  
  console.log(`[PlayerStats] Syncing stats for league ${leagueKey} using teams/roster approach`);
  
  try {
    // First, fetch rosters to get all player keys
    const rosterEndpoint = `league/${leagueKey}/teams;out=roster`;
    console.log(`[PlayerStats] Fetching teams with rosters: ${rosterEndpoint}`);
    
    const client = await getYahooFantasyClientForRequest(request);
    const rosterXmlResponse = await client.request(rosterEndpoint);
    const parsed = await parseYahooXml(rosterXmlResponse);
    
    // Load stat definitions first
    let statDefinitions;
    try {
      console.log(`[PlayerStats] Attempting to load stat definitions`);
      statDefinitions = await getStatDefinitionsForCurrentGame(request);
      if (!statDefinitions || Object.keys(statDefinitions.byId).length === 0) {
        console.error(`[PlayerStats] Stat definitions are empty or invalid`);
        throw new Error("Stat definitions not available");
      }
      console.log(`[PlayerStats] Loaded ${Object.keys(statDefinitions.byId).length} stat definitions`);
    } catch (error) {
      console.error(`[PlayerStats] Failed to load stat definitions:`, error);
      if (error instanceof Error) {
        console.error(`[PlayerStats] Error message:`, error.message);
        console.error(`[PlayerStats] Error stack:`, error.stack);
      }
      throw error;
    }
    
    // Find teams in response
    const teamsArray = findFirstPath(parsed, [
      "fantasy_content.league.0.teams.0.team",
      "fantasy_content.league.teams.team",
    ]);
    
    if (!teamsArray) {
      console.error(`[PlayerStats] No teams found in response`);
      return;
    }
    
    const teamsList = Array.isArray(teamsArray) ? teamsArray : [teamsArray];
    console.log(`[PlayerStats] Found ${teamsList.length} teams`);
    
    // Get player key to ID mapping
    const allPlayers = await prisma.player.findMany({
      select: { id: true, playerKey: true },
    });
    const playerKeyToId = new Map<string, string>();
    allPlayers.forEach(p => playerKeyToId.set(p.playerKey, p.id));
    
    // Collect all player keys
    const allPlayerKeys: string[] = [];
    for (const teamNode of teamsList) {
      const team = normalizeYahooNode(teamNode);
      
      const rosterArray = findFirstPath(team, [
        "roster.0.players.0.player",
        "roster.players.player",
      ]);
      
      if (!rosterArray) continue;
      
      const playersList = Array.isArray(rosterArray) ? rosterArray : [rosterArray];
      
      for (const playerNode of playersList) {
        const player = normalizeYahooNode(playerNode);
        const playerKey = player.player_key?.toString() || player["@_player_key"]?.toString() || "";
        if (playerKey) {
          allPlayerKeys.push(playerKey);
        }
      }
    }
    
    console.log(`[PlayerStats] Found ${allPlayerKeys.length} unique players across all teams`);
    
    // Fetch stats for all players in batches (Yahoo has a limit on URL length)
    const batchSize = 25;
    let totalStatsStored = 0;
    
    for (let i = 0; i < allPlayerKeys.length; i += batchSize) {
      const batch = allPlayerKeys.slice(i, i + batchSize);
      const playerKeysParam = batch.join(',');
      const statsEndpoint = `league/${leagueKey}/players;player_keys=${playerKeysParam}/stats`;
      
      console.log(`[PlayerStats] Fetching stats batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allPlayerKeys.length / batchSize)} (${batch.length} players)`);
      
      try {
        const statsXmlResponse = await client.request(statsEndpoint);
        const statsParsed = await parseYahooXml(statsXmlResponse);
        
        const playersWithStatsArray = findFirstPath(statsParsed, [
          "fantasy_content.league.0.players.0.player",
          "fantasy_content.league.players.player",
        ]);
        
        if (!playersWithStatsArray) {
          console.warn(`[PlayerStats] No players found in stats response for batch`);
          continue;
        }
        
        const playersWithStatsList = Array.isArray(playersWithStatsArray) ? playersWithStatsArray : [playersWithStatsArray];
        
        for (const playerNode of playersWithStatsList) {
          const player = normalizeYahooNode(playerNode);
          const playerKey = player.player_key?.toString() || player["@_player_key"]?.toString() || "";
          
          if (!playerKey) continue;
          
          const playerId = playerKeyToId.get(playerKey);
          if (!playerId) continue;
          
          const statsArray = findFirstPath(player, [
            "player_stats.0.stats.0.stat",
            "player_stats.stats.stat",
            "player_stats.stat",
          ]);
          
          if (!statsArray) {
            console.warn(`[PlayerStats] No stats in response for player ${playerKey}`);
            continue;
          }
          
          const statsList = Array.isArray(statsArray) ? statsArray : [statsArray];
          
          // Delete existing stats
          await prisma.playerStat.deleteMany({
            where: { playerId, leagueId: league.id },
          });
          
          // Insert new stats
          for (const statNode of statsList) {
            const stat = normalizeYahooNode(statNode);
            const statId = stat.stat_id?.toString() || stat["@_stat_id"]?.toString() || "";
            const value = parseFloat(stat.value?.toString() || stat["#text"]?.toString() || "0") || 0;
            
            if (!statId) continue;
            
            const statDef = statDefinitions.byId[statId];
            if (!statDef) continue;
            
            const statName = statDef.name || statDef.display_name || `Stat ${statId}`;
            
            await prisma.playerStat.create({
              data: { playerId, leagueId: league.id, statId, statName, value },
            });
            totalStatsStored++;
          }
        }
      } catch (error) {
        console.error(`[PlayerStats] Error fetching stats batch:`, error);
        // Continue with other batches
      }
    }
    
    console.log(`[PlayerStats] Successfully stored ${totalStatsStored} stats for ${allPlayerKeys.length} players across ${teamsList.length} teams`);
    
  } catch (error) {
    console.error(`[PlayerStats] Error syncing stats via teams endpoint:`, error);
    throw error;
  }
}

