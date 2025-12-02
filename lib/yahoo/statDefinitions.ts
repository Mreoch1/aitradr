import { NextRequest } from "next/server";
import { getYahooFantasyClientForRequest } from "@/lib/yahoo/fantasyClient";
import { parseYahooXml, findFirstPath } from "@/lib/yahoo/normalize";

export interface YahooStatDefinition {
  stat_id: string;
  name: string;
  display_name?: string;
  sort_order?: number;
  position_type?: string;
  is_composed_stat?: boolean;
}

interface StatDefinitionsCache {
  gameKey: string;
  stats: YahooStatDefinition[];
  byId: Record<string, YahooStatDefinition>;
  byName: Record<string, YahooStatDefinition>;
}

const statDefinitionsCache = new Map<string, StatDefinitionsCache>();

function normalizeStatName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\./g, "");
}

export async function fetchStatDefinitionsForGame(
  gameKey: string,
  request: NextRequest
): Promise<StatDefinitionsCache> {
  console.log(`[StatDefinitions] Checking cache for game key: ${gameKey}`);
  
  if (statDefinitionsCache.has(gameKey)) {
    const cached = statDefinitionsCache.get(gameKey)!;
    console.log(`[StatDefinitions] Using cached definitions, count: ${cached.stats.length}`);
    return cached;
  }

  console.log(`[StatDefinitions] Fetching stat definitions for game ${gameKey}`);
  
  const client = await getYahooFantasyClientForRequest(request);
  const endpoint = `game/${gameKey}/stat_categories`;
  
  console.log(`[StatDefinitions] Calling endpoint: ${endpoint}`);
  const xmlResponse = await client.request(endpoint);
  console.log(`[StatDefinitions] Received response length: ${xmlResponse.length}`);
  
  const parsed = await parseYahooXml(xmlResponse);
  console.log(`[StatDefinitions] Parsed XML, top-level keys:`, Object.keys(parsed || {}));

  const statsArray = findFirstPath(parsed, [
    "fantasy_content.game.0.stat_categories.0.stats.0.stat",
    "fantasy_content.game.0.stat_categories.0.stat",
    "fantasy_content.game.stat_categories.stats.stat",
    "fantasy_content.game.stat_categories.stat",
  ]);

  if (!statsArray) {
    console.error(`[StatDefinitions] Could not find stat categories in response`);
    console.error(`[StatDefinitions] Parsed structure:`, JSON.stringify(parsed, null, 2).substring(0, 2000));
    throw new Error("Could not find stat categories in response");
  }
  
  console.log(`[StatDefinitions] Found stats array, is array: ${Array.isArray(statsArray)}`);
  if (Array.isArray(statsArray)) {
    console.log(`[StatDefinitions] Stats array length: ${statsArray.length}`);
  }

  const statsList = Array.isArray(statsArray) ? statsArray : [statsArray];
  const stats: YahooStatDefinition[] = statsList.map((stat: any) => {
    const statId = stat.stat_id?.toString() || stat["@_stat_id"]?.toString() || "";
    const statName = stat.name || stat["#text"] || "";

    return {
      stat_id: statId,
      name: statName,
      display_name: stat.display_name || statName,
      sort_order: typeof stat.sort_order === "number" ? stat.sort_order : undefined,
      position_type: stat.position_type,
      is_composed_stat: stat.is_composed_stat === "1" || stat.is_composed_stat === true,
    };
  });

  const byId: Record<string, YahooStatDefinition> = {};
  const byName: Record<string, YahooStatDefinition> = {};

  for (const stat of stats) {
    if (stat.stat_id) {
      byId[stat.stat_id] = stat;
    }
    if (stat.name) {
      const normalized = normalizeStatName(stat.name);
      byName[normalized] = stat;
    }
  }

  const cacheEntry: StatDefinitionsCache = {
    gameKey,
    stats,
    byId,
    byName,
  };

  console.log(`[StatDefinitions] Processed ${stats.length} stat definitions`);
  console.log(`[StatDefinitions] Sample stat IDs:`, Object.keys(byId).slice(0, 10));
  console.log(`[StatDefinitions] First 3 stats:`, stats.slice(0, 3));

  statDefinitionsCache.set(gameKey, cacheEntry);
  return cacheEntry;
}

export async function getStatDefinitionsForCurrentGame(
  request: NextRequest
): Promise<StatDefinitionsCache> {
  const { getYahooGameKey } = await import("@/lib/yahoo/config");
  const gameKey = getYahooGameKey();

  if (!gameKey) {
    throw new Error("YAHOO_GAME_KEY is not configured");
  }

  return fetchStatDefinitionsForGame(gameKey, request);
}

export function getStatIdByNameCached(
  gameKey: string,
  candidateNames: string[]
): string | null {
  const cache = statDefinitionsCache.get(gameKey);
  if (!cache) {
    return null;
  }

  for (const name of candidateNames) {
    const normalized = normalizeStatName(name);
    const stat = cache.byName[normalized];
    if (stat) {
      return stat.stat_id;
    }
  }

  return null;
}

