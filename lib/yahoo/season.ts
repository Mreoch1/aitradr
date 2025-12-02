import { NextRequest } from "next/server";
import { getYahooFantasyClientForRequest } from "@/lib/yahoo/fantasyClient";
import { parseYahooXml, findFirstPath } from "@/lib/yahoo/normalize";

const seasonCache = new Map<string, string>();

function extractYearFromSeason(seasonValue: any): string {
  if (typeof seasonValue === "string") {
    const yearMatch = seasonValue.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      return yearMatch[0];
    }
  } else if (typeof seasonValue === "number") {
    const yearStr = seasonValue.toString();
    if (yearStr.length === 4) {
      return yearStr;
    }
  }

  throw new Error("Could not determine season from game response");
}

export async function getSeasonForGame(
  gameKey: string,
  request: NextRequest
): Promise<string> {
  if (seasonCache.has(gameKey)) {
    return seasonCache.get(gameKey)!;
  }

  const client = await getYahooFantasyClientForRequest(request);
  const endpoint = `game/${gameKey}`;
  const xmlResponse = await client.request(endpoint);
  const parsed = await parseYahooXml(xmlResponse);

  const seasonValue = findFirstPath(parsed, [
    "fantasy_content.game.0.season",
    "fantasy_content.game.season",
    "fantasy_content.game.0[\"season\"]",
  ]);

  if (!seasonValue) {
    throw new Error("Could not determine season from game response");
  }

  const year = extractYearFromSeason(seasonValue);
  seasonCache.set(gameKey, year);

  return year;
}

export async function getSeasonForCurrentGame(
  request: NextRequest
): Promise<string> {
  const { getYahooGameKey } = await import("@/lib/yahoo/config");
  const gameKey = getYahooGameKey();

  if (!gameKey) {
    throw new Error("YAHOO_GAME_KEY is not configured");
  }

  return getSeasonForGame(gameKey, request);
}

