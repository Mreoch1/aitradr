/**
 * NHL API integration for fetching historical player statistics
 * NHL API is publicly accessible and provides historical data
 */

interface NHLPlayer {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
}

interface NHLStat {
  assists: number;
  goals: number;
  points: number;
  plusMinus: number;
  penaltyMinutes: number;
  powerPlayGoals: number;
  powerPlayPoints: number;
  shortHandedGoals: number;
  shortHandedPoints: number;
  gameWinningGoals: number;
  shots: number;
  faceOffPct: number;
  hits: number;
  blockedShots: number;
  games: number;
}

interface NHLPlayerStatsResponse {
  stats: Array<{
    splits: Array<{
      season: string;
      stat: NHLStat;
    }>;
  }>;
}

/**
 * Map NHL stat names to our internal stat names
 */
const NHL_STAT_MAP: Record<string, string> = {
  goals: "Goals",
  assists: "Assists",
  points: "Points",
  plusMinus: "Plus/Minus",
  penaltyMinutes: "Penalty Minutes",
  powerPlayPoints: "Power Play Points",
  shortHandedPoints: "Shorthanded Points",
  gameWinningGoals: "Game-Winning Goals",
  shots: "Shots on Goal",
  hits: "Hits",
  blockedShots: "Blocked Shots",
  games: "Games Played",
  // Note: faceOffPct is skipped - would need faceoff attempts to calculate total faceoffs won
};

/**
 * Get NHL player ID from player name
 * This is a simplified lookup - in production you'd want a more robust matching system
 */
export async function findNHLPlayerId(playerName: string): Promise<number | null> {
  try {
    // Use records.nhl.com for player lookup - this API works
    const encodedName = encodeURIComponent(playerName);
    const searchUrl = `https://records.nhl.com/site/api/player?search=${encodedName}`;
    
    const response = await fetch(searchUrl);
    if (!response.ok) return null;
    
    const data = await response.json();
    const players = data.data || [];
    
    // Try to find exact match first
    const normalizedSearch = playerName.toLowerCase().trim();
    for (const player of players) {
      const fullName = player.fullName || `${player.firstName || ''} ${player.lastName || ''}`.trim();
      if (fullName.toLowerCase() === normalizedSearch) {
        return player.id;
      }
    }
    
    // If no exact match, return first result (best guess)
    if (players.length > 0 && players[0].id) {
      return players[0].id;
    }
    
    return null;
  } catch (error) {
    console.error(`[NHL API] Error finding player ID for ${playerName}:`, error);
    return null;
  }
}

/**
 * Fetch historical stats for an NHL player by player ID and season
 * Uses api.nhle.com with the correct endpoint structure
 * Fetches from multiple endpoints to get all stats: summary, realtime (hits/blocks), and faceoffs
 */
/**
 * Retry fetch with exponential backoff for rate limiting
 */
async function fetchWithRetry(
  url: string,
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url);
    
    if (response.status === 429) {
      // Rate limited - wait with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[NHL API] Rate limited (429), waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    
    return response;
  }
  
  // Final attempt
  return await fetch(url);
}

export async function fetchNHLPlayerSeasonStats(
  nhlPlayerId: number,
  season: string
): Promise<{ statName: string; value: number; gamesPlayed: number }[]> {
  try {
    console.log(`[NHL API] Fetching stats for player ${nhlPlayerId}, season ${season}`);
    
    // NHL API uses season format like "20232024" but we need to ensure we're querying correctly
    // The API might return all seasons in one call, so we need to filter by season
    const summaryUrl = `https://api.nhle.com/stats/rest/en/skater/summary?season=${season}&factCayenneExp=gamesPlayed%3E0&cayenneExp=playerId%3D${nhlPlayerId}`;
    const realtimeUrl = `https://api.nhle.com/stats/rest/en/skater/realtime?season=${season}&factCayenneExp=gamesPlayed%3E0&cayenneExp=playerId%3D${nhlPlayerId}`;
    const faceoffUrl = `https://api.nhle.com/stats/rest/en/skater/faceoffwins?season=${season}&factCayenneExp=gamesPlayed%3E0&cayenneExp=playerId%3D${nhlPlayerId}`;
    
    // Debug: Log URLs for specific players
    if (nhlPlayerId === 8477492 || nhlPlayerId === 8477956) { // MacKinnon or McDavid
      console.log(`[NHL API] DEBUG: Player ${nhlPlayerId}, Season ${season}, URL: ${summaryUrl}`);
    }
    
    // Try skater endpoints first with retry logic
    let summaryResponse = await fetchWithRetry(summaryUrl);
    let realtimeResponse = await fetchWithRetry(realtimeUrl);
    let faceoffResponse = await fetchWithRetry(faceoffUrl);
    
    // If summary fails, try goalie endpoint
    if (!summaryResponse.ok) {
      const goalieUrl = `https://api.nhle.com/stats/rest/en/goalie/summary?season=${season}&factCayenneExp=gamesPlayed%3E0&cayenneExp=playerId%3D${nhlPlayerId}`;
      summaryResponse = await fetchWithRetry(goalieUrl);
      
      if (!summaryResponse.ok) {
        console.warn(`[NHL API] Failed to fetch stats after retries: ${summaryResponse.status} ${summaryResponse.statusText}`);
        return [];
      }
    }
    
    const summaryData: any = await summaryResponse.json();
    
    if (!summaryData.data || summaryData.data.length === 0) {
      console.warn(`[NHL API] No stats found for player ${nhlPlayerId}, season ${season}`);
      return [];
    }
    
    // The NHL API returns data sorted by games played (descending), with the first entry being
    // typically the most recent season or career total. The API's season parameter doesn't
    // actually filter properly - it returns all available data.
    // 
    // Strategy: When querying for a specific season, we need to identify which entry corresponds
    // to that season. Since entries don't have explicit season fields, we'll try to use the
    // season parameter from the URL to determine which entry we want.
    // 
    // For season "20232024" (2023-24 season), we want the entry for that season
    // For season "20242025" (2024-25 season, current), we want the most recent entry
    
    const requestedSeasonYear = parseInt(season.substring(0, 4)); // "2023" from "20232024"
    const currentYear = new Date().getFullYear();
    
    let seasonStats: any;
    
    // If requesting the current season (2024-25 = 2024), use the first entry (most recent)
    // If requesting last season (2023-24 = 2023), we need to find the right entry
    // The API typically returns: [0] = current/most recent, [1] = previous, etc.
    if (requestedSeasonYear === currentYear - 1) {
      // Requesting 2023-24 season - this should be the second entry (index 1) if current season data exists
      // But if current season data doesn't exist yet, it might be first entry
      // Try to find by looking for an entry with games played around 82 (full season) or check if it's the previous entry
      if (summaryData.data.length > 1) {
        // Use the second entry if available (previous season)
        seasonStats = summaryData.data[1];
        console.log(`[NHL API] Requesting ${requestedSeasonYear}-${requestedSeasonYear + 1} season, using entry [1] (games: ${seasonStats.gamesPlayed || 0})`);
      } else {
        // Only one entry available, use it
        seasonStats = summaryData.data[0];
        console.warn(`[NHL API] Only one entry available for ${season}, using it`);
      }
    } else if (requestedSeasonYear === currentYear) {
      // Requesting current season (2024-25) - use first entry (most recent)
      seasonStats = summaryData.data[0];
      console.log(`[NHL API] Requesting ${requestedSeasonYear}-${requestedSeasonYear + 1} season (current), using entry [0] (games: ${seasonStats.gamesPlayed || 0})`);
    } else {
      // Older season - try to find by index (older seasons are later in array)
      // This is a best-guess approach
      const seasonIndex = currentYear - requestedSeasonYear;
      if (seasonIndex >= 0 && seasonIndex < summaryData.data.length) {
        seasonStats = summaryData.data[seasonIndex];
        console.log(`[NHL API] Requesting ${requestedSeasonYear}-${requestedSeasonYear + 1} season (${seasonIndex} years ago), using entry [${seasonIndex}]`);
      } else {
        // Fallback to first entry
        seasonStats = summaryData.data[0];
        console.warn(`[NHL API] Could not determine correct entry for ${season}, using first entry`);
      }
    }
    
    if (!seasonStats) {
      return [];
    }
    
    // Debug: Log what we're actually using for specific players
    if (nhlPlayerId === 8477492 || nhlPlayerId === 8477956) { // MacKinnon or McDavid
      console.log(`[NHL API] DEBUG: Using entry with season=${seasonStats.season || 'N/A'}, requested=${season}, goals=${seasonStats.goals || 0}, games=${seasonStats.gamesPlayed || 0}`);
    }
    
    const gamesPlayed = seasonStats.gamesPlayed || 0;
    const stats: { statName: string; value: number; gamesPlayed: number }[] = [];
    
    // Map NHL stats from summary endpoint to our stat names
    const summaryStatMapping: Record<string, string> = {
      goals: "Goals",
      assists: "Assists",
      points: "Points",
      plusMinus: "Plus/Minus",
      penaltyMinutes: "Penalty Minutes",
      ppPoints: "Power Play Points",
      shPoints: "Shorthanded Points",
      gameWinningGoals: "Game-Winning Goals",
      shots: "Shots on Goal",
    };
    
    for (const [nhlKey, ourStatName] of Object.entries(summaryStatMapping)) {
      const value = seasonStats[nhlKey];
      if (value !== undefined && value !== null) {
        const finalValue: number = typeof value === "number" ? value : 0;
        stats.push({
          statName: ourStatName,
          value: finalValue,
          gamesPlayed,
        });
      }
    }
    
    // Fetch hits and blocked shots from realtime endpoint
    if (realtimeResponse.ok) {
      try {
        const realtimeData: any = await realtimeResponse.json();
        if (realtimeData.data && realtimeData.data.length > 0) {
          const realtimeStats = realtimeData.data[0];
          
          // Add hits
          if (realtimeStats.hits !== undefined && realtimeStats.hits !== null) {
            stats.push({
              statName: "Hits",
              value: typeof realtimeStats.hits === "number" ? realtimeStats.hits : 0,
              gamesPlayed,
            });
          }
          
          // Add blocked shots
          if (realtimeStats.blockedShots !== undefined && realtimeStats.blockedShots !== null) {
            stats.push({
              statName: "Blocks",
              value: typeof realtimeStats.blockedShots === "number" ? realtimeStats.blockedShots : 0,
              gamesPlayed,
            });
          }
        }
      } catch (error) {
        console.warn(`[NHL API] Error parsing realtime stats:`, error);
      }
    }
    
    // Fetch faceoffs won from faceoff endpoint
    if (faceoffResponse.ok) {
      try {
        const faceoffData: any = await faceoffResponse.json();
        if (faceoffData.data && faceoffData.data.length > 0) {
          const faceoffStats = faceoffData.data[0];
          
          // Add faceoffs won (totalFaceoffWins)
          if (faceoffStats.totalFaceoffWins !== undefined && faceoffStats.totalFaceoffWins !== null) {
            stats.push({
              statName: "Faceoffs Won",
              value: typeof faceoffStats.totalFaceoffWins === "number" ? faceoffStats.totalFaceoffWins : 0,
              gamesPlayed,
            });
          }
        }
      } catch (error) {
        console.warn(`[NHL API] Error parsing faceoff stats:`, error);
      }
    }
    
    console.log(`[NHL API] Fetched ${stats.length} stats for player ${nhlPlayerId}, season ${season}`);
    return stats;
  } catch (error) {
    console.error(`[NHL API] Error fetching stats for player ${nhlPlayerId}, season ${season}:`, error);
    return [];
  }
}

/**
 * Get the last 2 seasons (e.g., if current is 2024, returns ["20232024", "20222023"])
 */
export function getLastTwoSeasons(currentSeason?: string): string[] {
  const currentYear = currentSeason 
    ? parseInt(currentSeason.substring(0, 4))
    : new Date().getFullYear();
  
  // NHL season format: "20232024" for 2023-24 season
  const season1 = `${currentYear - 1}${currentYear}`;
  const season2 = `${currentYear - 2}${currentYear - 1}`;
  
  return [season1, season2];
}

