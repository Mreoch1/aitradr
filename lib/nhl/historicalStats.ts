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
 */
export async function fetchNHLPlayerSeasonStats(
  nhlPlayerId: number,
  season: string
): Promise<{ statName: string; value: number; gamesPlayed: number }[]> {
  try {
    // Use api.nhle.com - the correct NHL API domain
    // Endpoint: /stats/rest/en/skater/summary for skaters, /goalie/summary for goalies
    // Query params: season=YYYYYYYY, cayenneExp=playerId=XXXXX, factCayenneExp=gamesPlayed>0
    
    // Try skater endpoint first
    const skaterUrl = `https://api.nhle.com/stats/rest/en/skater/summary?season=${season}&factCayenneExp=gamesPlayed%3E0&cayenneExp=playerId%3D${nhlPlayerId}`;
    
    console.log(`[NHL API] Fetching stats for player ${nhlPlayerId}, season ${season}`);
    let response = await fetch(skaterUrl);
    
    let data: any;
    if (response.ok) {
      data = await response.json();
    } else {
      // Try goalie endpoint if skater fails
      const goalieUrl = `https://api.nhle.com/stats/rest/en/goalie/summary?season=${season}&factCayenneExp=gamesPlayed%3E0&cayenneExp=playerId%3D${nhlPlayerId}`;
      response = await fetch(goalieUrl);
      
      if (!response.ok) {
        console.warn(`[NHL API] Failed to fetch stats: ${response.status} ${response.statusText}`);
        return [];
      }
      data = await response.json();
    }
    
    if (!data.data || data.data.length === 0) {
      console.warn(`[NHL API] No stats found for player ${nhlPlayerId}, season ${season}`);
      return [];
    }
    
    // Get the first stat entry (should be the season stats)
    const seasonStats = data.data[0];
    if (!seasonStats) {
      return [];
    }
    
    const gamesPlayed = seasonStats.gamesPlayed || 0;
    const stats: { statName: string; value: number; gamesPlayed: number }[] = [];
    
    // Map NHL stats to our stat names
    // The API returns different field names than the old API
    // Note: hits, blockedShots, and faceoffs won are not available in the summary endpoint
    const statMapping: Record<string, string> = {
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
    
    for (const [nhlKey, ourStatName] of Object.entries(statMapping)) {
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

