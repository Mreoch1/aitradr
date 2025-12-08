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

interface NHLTeamsResponse {
  teams: Array<{
    id: number;
    name: string;
  }>;
}

interface NHLRosterResponse {
  roster: Array<{
    person: {
      id: number;
      fullName: string;
      firstName?: string;
      lastName?: string;
    };
  }>;
}

const playerNameToNHLIdCache = new Map<string, number>();

/**
 * Make HTTPS request and return JSON
 * Use fetch for Vercel serverless compatibility
 */
async function httpsGet(url: string): Promise<any> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AiTradr/1.0',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Failed to fetch: ${error}`);
  }
}

interface NHLPlayerSearchResponse {
  people: Array<{
    id: number;
    fullName: string;
    firstName?: string;
    lastName?: string;
  }>;
}

/**
 * Search for a player directly using NHL API search endpoint
 */
async function searchNHLPlayerByName(playerName: string): Promise<number | null> {
  try {
    // Use records.nhl.com for player lookup - this API works
    // The statsapi.web.nhl.com domain doesn't exist (NXDOMAIN)
    const encodedName = encodeURIComponent(playerName);
    const searchUrl = `https://records.nhl.com/site/api/player?search=${encodedName}`;
    
    const searchData: any = await httpsGet(searchUrl);
    const people = searchData.data || [];
    
    if (people.length === 0) {
      return null;
    }
    
    // Try to find exact match first
    const normalizedSearch = normalizePlayerName(playerName);
    for (const person of people) {
      const fullName = person.fullName || `${person.firstName || ''} ${person.lastName || ''}`.trim();
      if (fullName) {
        const normalizedPerson = normalizePlayerName(fullName);
        if (normalizedPerson === normalizedSearch) {
          return person.id;
        }
      }
    }
    
    // If no exact match, return first result (best guess)
    if (people.length > 0 && people[0].id) {
      return people[0].id;
    }
    
    return null;
  } catch (error) {
    console.error(`[NHL Lookup] Error searching for player "${playerName}":`, error);
    return null;
  }
}

/**
 * Build a lookup map of player names to NHL IDs by fetching all current rosters
 * This is expensive but only needs to be done once or periodically
 */
export async function buildPlayerNameToNHLIdMap(): Promise<Map<string, number>> {
  const lookup = new Map<string, number>();
  
  try {
    console.log("[NHL Lookup] Building player name to NHL ID map...");
    
    // Get all teams using api.nhle.com - the correct NHL API domain
    const teamsData: any = await httpsGet("https://api.nhle.com/stats/rest/en/team");
    const teams = teamsData.data || [];
    
    console.log(`[NHL Lookup] Found ${teams.length} teams`);
    
    let totalPlayersAdded = 0;
    
    // For each team, get roster
    // Note: api.nhle.com doesn't have a direct roster endpoint, so we'll use records.nhl.com
    // or build the lookup from the player search results
    for (const team of teams) {
      try {
        // Use records.nhl.com for roster data
        const rosterUrl = `https://records.nhl.com/site/api/player?teamId=${team.id}`;
        const rosterData: any = await httpsGet(rosterUrl);
        const roster = rosterData.data || [];
        
        for (const player of roster) {
          const playerId = player.id;
          const fullName = player.fullName || `${player.firstName || ''} ${player.lastName || ''}`.trim();
          
          if (playerId && fullName) {
            // Store the full name as-is (will be normalized during lookup)
            const fullNameLower = fullName.toLowerCase().trim();
            if (!lookup.has(fullNameLower)) {
              lookup.set(fullNameLower, playerId);
              totalPlayersAdded++;
            }
            
            // Also store "First Last" format if available
            if (player.firstName && player.lastName) {
              const firstLast = `${player.firstName} ${player.lastName}`.toLowerCase().trim();
              if (!lookup.has(firstLast)) {
                lookup.set(firstLast, playerId);
                totalPlayersAdded++;
              }
              
              // Store normalized version too
              const normalized = normalizePlayerName(firstLast);
              if (normalized !== firstLast && !lookup.has(normalized)) {
                lookup.set(normalized, playerId);
                totalPlayersAdded++;
              }
            }
            
            // Store normalized version of full name
            const normalized = normalizePlayerName(fullNameLower);
            if (normalized !== fullNameLower && !lookup.has(normalized)) {
              lookup.set(normalized, playerId);
              totalPlayersAdded++;
            }
          }
        }
        
        // Rate limiting: wait 50ms between teams
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        console.warn(`[NHL Lookup] Error fetching roster for team ${team.id}:`, error);
      }
    }
    
    console.log(`[NHL Lookup] Built lookup map with ${lookup.size} unique entries (${totalPlayersAdded} total variations)`);
    return lookup;
  } catch (error) {
    console.error("[NHL Lookup] Error building player lookup map:", error);
    return lookup;
  }
}

/**
 * Normalize player name for matching (remove special characters, handle accents)
 */
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Find NHL player ID from player name using the lookup map
 */
export async function findNHLPlayerIdByName(
  playerName: string,
  lookupMap?: Map<string, number>
): Promise<number | null> {
  // Always try direct API search first if lookup map is empty or small
  if (!lookupMap || lookupMap.size === 0) {
    console.log(`[NHL Lookup] Lookup map is empty (size: ${lookupMap?.size || 0}), using direct API search for: ${playerName}`);
    const directSearchResult = await searchNHLPlayerByName(playerName);
    if (directSearchResult) {
      const normalizedName = normalizePlayerName(playerName);
      playerNameToNHLIdCache.set(normalizedName, directSearchResult);
      return directSearchResult;
    }
    console.warn(`[NHL Lookup] ❌ Could not find NHL ID for: "${playerName}" - lookup map empty and direct search failed`);
    return null;
  }

  // Use cache if available
  const normalizedName = normalizePlayerName(playerName);
  if (playerNameToNHLIdCache.size > 0) {
    const cached = playerNameToNHLIdCache.get(normalizedName);
    if (cached) {
      console.log(`[NHL Lookup] ✅ Found cached NHL ID ${cached} for: ${playerName}`);
      return cached;
    }
  }
  
  // Try exact match first (normalized)
  const nhlId = lookupMap.get(normalizedName);
  if (nhlId) {
    playerNameToNHLIdCache.set(normalizedName, nhlId);
    console.log(`[NHL Lookup] ✅ Found NHL ID ${nhlId} for: ${playerName} (exact match)`);
    return nhlId;
  }
  
  // Try matching against normalized lookup map entries
  for (const [lookupName, id] of lookupMap.entries()) {
    const normalizedLookupName = normalizePlayerName(lookupName);
    
    // Exact match after normalization
    if (normalizedLookupName === normalizedName) {
      playerNameToNHLIdCache.set(normalizedName, id);
      console.log(`[NHL Lookup] ✅ Found NHL ID ${id} for: ${playerName} (normalized match)`);
      return id;
    }
    
    // Partial matching - check if last names match (most reliable)
    const nameParts = normalizedName.split(' ');
    const lookupParts = normalizedLookupName.split(' ');
    
    if (nameParts.length >= 2 && lookupParts.length >= 2) {
      // Match if last names match and first name initial matches
      const lastNameMatch = nameParts[nameParts.length - 1] === lookupParts[lookupParts.length - 1];
      const firstNameMatch = nameParts[0] === lookupParts[0] || 
                             nameParts[0][0] === lookupParts[0][0];
      
      if (lastNameMatch && firstNameMatch) {
        playerNameToNHLIdCache.set(normalizedName, id);
        console.log(`[NHL Lookup] ✅ Found NHL ID ${id} for: ${playerName} (last name + first initial match)`);
        return id;
      }
    }
    
    // Fallback: substring matching
    if (normalizedLookupName.includes(normalizedName) || normalizedName.includes(normalizedLookupName)) {
      // Only use substring if it's substantial (at least 5 characters)
      if (normalizedName.length >= 5 || normalizedLookupName.length >= 5) {
        playerNameToNHLIdCache.set(normalizedName, id);
        console.log(`[NHL Lookup] ✅ Found NHL ID ${id} for: ${playerName} (substring match)`);
        return id;
      }
    }
  }
  
  // If lookup map failed, try direct API search as fallback
  console.log(`[NHL Lookup] Lookup map search failed for "${playerName}", trying direct API search...`);
  const directSearchResult = await searchNHLPlayerByName(playerName);
  if (directSearchResult) {
    console.log(`[NHL Lookup] ✅ Found NHL ID ${directSearchResult} for "${playerName}" via direct search`);
    playerNameToNHLIdCache.set(normalizedName, directSearchResult);
    return directSearchResult;
  }
  
  // Log a sample of lookup map entries for debugging
  if (lookupMap.size > 0) {
    const sampleEntries = Array.from(lookupMap.entries()).slice(0, 5);
    console.warn(`[NHL Lookup] ❌ Could not find NHL ID for: "${playerName}" (normalized: "${normalizedName}"). Lookup map size: ${lookupMap.size}. Sample entries: ${sampleEntries.map(([n, id]) => `${n}(${id})`).join(', ')}`);
  } else {
    console.warn(`[NHL Lookup] ❌ Could not find NHL ID for: "${playerName}" - lookup map is empty`);
  }
  
  return null;
}

