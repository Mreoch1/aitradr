/**
 * Player name to NHL ID lookup
 * Since NHL API doesn't have a direct search, we'll build a lookup cache
 */

import https from 'https';

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
 */
function httpsGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON: ${e}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Build a lookup map of player names to NHL IDs by fetching all current rosters
 * This is expensive but only needs to be done once or periodically
 */
export async function buildPlayerNameToNHLIdMap(): Promise<Map<string, number>> {
  const lookup = new Map<string, number>();
  
  try {
    console.log("[NHL Lookup] Building player name to NHL ID map...");
    
    // Get all teams
    const teamsData: NHLTeamsResponse = await httpsGet("https://statsapi.web.nhl.com/api/v1/teams");
    const teams = teamsData.teams || [];
    
    console.log(`[NHL Lookup] Found ${teams.length} teams`);
    
    // For each team, get roster
    for (const team of teams) {
      try {
        const rosterUrl = `https://statsapi.web.nhl.com/api/v1/teams/${team.id}/roster`;
        const rosterData: NHLRosterResponse = await httpsGet(rosterUrl);
        const roster = rosterData.roster || [];
        
        for (const rosterEntry of roster) {
          const person = rosterEntry.person;
          if (person?.id && person?.fullName) {
            // Store the full name as-is (will be normalized during lookup)
            const fullName = person.fullName.toLowerCase().trim();
            lookup.set(fullName, person.id);
            
            // Also store "First Last" format if available
            if (person.firstName && person.lastName) {
              const firstLast = `${person.firstName} ${person.lastName}`.toLowerCase().trim();
              lookup.set(firstLast, person.id);
              
              // Store normalized version too
              const normalized = normalizePlayerName(firstLast);
              if (normalized !== firstLast) {
                lookup.set(normalized, person.id);
              }
            }
            
            // Store normalized version of full name
            const normalized = normalizePlayerName(fullName);
            if (normalized !== fullName) {
              lookup.set(normalized, person.id);
            }
          }
        }
        
        // Rate limiting: wait 50ms between teams
        await new Promise(resolve => setTimeout(resolve, 50));
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
  if (!lookupMap || lookupMap.size === 0) {
    console.warn(`[NHL Lookup] Lookup map is empty, cannot find NHL ID for: ${playerName}`);
    return null;
  }

  // Use cache if available
  const normalizedName = normalizePlayerName(playerName);
  if (playerNameToNHLIdCache.size > 0) {
    const cached = playerNameToNHLIdCache.get(normalizedName);
    if (cached) return cached;
  }
  
  // Try exact match first (normalized)
  const nhlId = lookupMap.get(normalizedName);
  if (nhlId) {
    playerNameToNHLIdCache.set(normalizedName, nhlId);
    return nhlId;
  }
  
  // Try matching against normalized lookup map entries
  for (const [lookupName, id] of lookupMap.entries()) {
    const normalizedLookupName = normalizePlayerName(lookupName);
    
    // Exact match after normalization
    if (normalizedLookupName === normalizedName) {
      playerNameToNHLIdCache.set(normalizedName, id);
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
        return id;
      }
    }
    
    // Fallback: substring matching
    if (normalizedLookupName.includes(normalizedName) || normalizedName.includes(normalizedLookupName)) {
      // Only use substring if it's substantial (at least 5 characters)
      if (normalizedName.length >= 5 || normalizedLookupName.length >= 5) {
        playerNameToNHLIdCache.set(normalizedName, id);
        return id;
      }
    }
  }
  
  // Log a sample of lookup map entries for debugging
  if (lookupMap.size > 0) {
    const sampleEntries = Array.from(lookupMap.entries()).slice(0, 3);
    console.warn(`[NHL Lookup] Could not find NHL ID for: "${playerName}" (normalized: "${normalizedName}"). Sample lookup entries: ${sampleEntries.map(([n]) => n).join(', ')}`);
  } else {
    console.warn(`[NHL Lookup] Could not find NHL ID for: "${playerName}" - lookup map is empty`);
  }
  
  return null;
}

