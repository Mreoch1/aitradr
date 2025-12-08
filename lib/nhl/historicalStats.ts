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
    // NHL API endpoint to search for players
    const searchUrl = `https://statsapi.web.nhl.com/api/v1/teams?expand=team.roster`;
    
    // For now, we'll need to search through teams or use a different approach
    // The NHL API doesn't have a direct player search, so we'll need to:
    // 1. Get all teams
    // 2. Get rosters for each team
    // 3. Match by name
    
    // This is a placeholder - we'll implement a more efficient lookup
    const response = await fetch(searchUrl);
    if (!response.ok) return null;
    
    const data = await response.json();
    
    // Search through all teams' rosters
    for (const team of data.teams || []) {
      if (!team.roster?.roster) continue;
      
      for (const rosterPlayer of team.roster.roster) {
        const person = rosterPlayer.person;
        if (person?.fullName?.toLowerCase() === playerName.toLowerCase()) {
          return person.id;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[NHL API] Error finding player ID for ${playerName}:`, error);
    return null;
  }
}

/**
 * Fetch historical stats for an NHL player by player ID and season
 */
export async function fetchNHLPlayerSeasonStats(
  nhlPlayerId: number,
  season: string
): Promise<{ statName: string; value: number; gamesPlayed: number }[]> {
  try {
    // NHL API endpoint for player stats by season
    // Format: https://statsapi.web.nhl.com/api/v1/people/{playerId}/stats?stats=statsSingleSeason&season={season}
    const url = `https://statsapi.web.nhl.com/api/v1/people/${nhlPlayerId}/stats?stats=statsSingleSeason&season=${season}`;
    
    console.log(`[NHL API] Fetching stats for player ${nhlPlayerId}, season ${season}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`[NHL API] Failed to fetch stats: ${response.status} ${response.statusText}`);
      return [];
    }
    
    const data: NHLPlayerStatsResponse = await response.json();
    
    if (!data.stats || data.stats.length === 0) {
      console.warn(`[NHL API] No stats found for player ${nhlPlayerId}, season ${season}`);
      return [];
    }
    
    // Get the first stat entry (should be the season stats)
    const seasonStats = data.stats[0]?.splits?.[0]?.stat;
    if (!seasonStats) {
      return [];
    }
    
    const gamesPlayed = seasonStats.games || 0;
    const stats: { statName: string; value: number; gamesPlayed: number }[] = [];
    
    // Map NHL stats to our stat names
    for (const [nhlKey, ourStatName] of Object.entries(NHL_STAT_MAP)) {
      if (nhlKey === "games") continue; // Skip games, we already have gamesPlayed
      
      const value = seasonStats[nhlKey as keyof NHLStat];
      if (value !== undefined && value !== null) {
        let finalValue: number = typeof value === "number" ? value : 0;
        
        // Special handling for faceoffs: NHL API gives percentage, we need total
        // We'll estimate based on games played and typical faceoff attempts per game
        // For now, we'll skip faceoffs won from historical data as it requires more complex calculation
        if (nhlKey === "faceOffPct") {
          continue; // Skip faceoff percentage - would need faceoff attempts to calculate total
        }
        
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

