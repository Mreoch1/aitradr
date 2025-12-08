/**
 * Player name to NHL ID lookup
 * Since NHL API doesn't have a direct search, we'll build a lookup cache
 */

interface NHLPlayerInfo {
  id: number;
  fullName: string;
  firstName: string;
  lastName: string;
}

const playerNameToNHLIdCache = new Map<string, number>();

/**
 * Build a lookup map of player names to NHL IDs by fetching all current rosters
 * This is expensive but only needs to be done once or periodically
 */
export async function buildPlayerNameToNHLIdMap(): Promise<Map<string, number>> {
  const lookup = new Map<string, number>();
  
  try {
    console.log("[NHL Lookup] Building player name to NHL ID map...");
    
    // Get all teams
    const teamsResponse = await fetch("https://statsapi.web.nhl.com/api/v1/teams");
    if (!teamsResponse.ok) {
      throw new Error("Failed to fetch teams");
    }
    
    const teamsData = await teamsResponse.json();
    const teams = teamsData.teams || [];
    
    console.log(`[NHL Lookup] Found ${teams.length} teams`);
    
    // For each team, get roster
    for (const team of teams) {
      try {
        const rosterUrl = `https://statsapi.web.nhl.com/api/v1/teams/${team.id}/roster`;
        const rosterResponse = await fetch(rosterUrl);
        
        if (!rosterResponse.ok) continue;
        
        const rosterData = await rosterResponse.json();
        const roster = rosterData.roster || [];
        
        for (const rosterEntry of roster) {
          const person = rosterEntry.person;
          if (person?.id && person?.fullName) {
            // Store multiple variations of the name for better matching
            const fullName = person.fullName.toLowerCase().trim();
            lookup.set(fullName, person.id);
            
            // Also store "First Last" format
            if (person.firstName && person.lastName) {
              const firstLast = `${person.firstName} ${person.lastName}`.toLowerCase().trim();
              lookup.set(firstLast, person.id);
            }
          }
        }
      } catch (error) {
        console.warn(`[NHL Lookup] Error fetching roster for team ${team.id}:`, error);
      }
    }
    
    console.log(`[NHL Lookup] Built lookup map with ${lookup.size} players`);
    return lookup;
  } catch (error) {
    console.error("[NHL Lookup] Error building player lookup map:", error);
    return lookup;
  }
}

/**
 * Find NHL player ID from player name using the lookup map
 */
export async function findNHLPlayerIdByName(
  playerName: string,
  lookupMap?: Map<string, number>
): Promise<number | null> {
  // Use cache if available
  if (playerNameToNHLIdCache.size > 0) {
    const cached = playerNameToNHLIdCache.get(playerName.toLowerCase().trim());
    if (cached) return cached;
  }
  
  // Use provided lookup map or build one
  const lookup = lookupMap || await buildPlayerNameToNHLIdMap();
  
  // Try exact match first
  const normalizedName = playerName.toLowerCase().trim();
  const nhlId = lookup.get(normalizedName);
  
  if (nhlId) {
    playerNameToNHLIdCache.set(normalizedName, nhlId);
    return nhlId;
  }
  
  // Try partial matching (e.g., "Connor McDavid" matches "Connor McDavid")
  for (const [name, id] of lookup.entries()) {
    if (name.includes(normalizedName) || normalizedName.includes(name)) {
      playerNameToNHLIdCache.set(normalizedName, id);
      return id;
    }
  }
  
  console.warn(`[NHL Lookup] Could not find NHL ID for player: ${playerName}`);
  return null;
}

