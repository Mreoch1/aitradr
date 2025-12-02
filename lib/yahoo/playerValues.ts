/**
 * Player value calculation and management.
 * 
 * Uses actual player stats from Yahoo Fantasy API to calculate trade values.
 * Formula weights all Yahoo Fantasy scoring categories to match their rankings.
 */

import { prisma } from "@prisma/client";

/**
 * Calculate player value based on actual stats.
 * Formula: 2 * goals + 1.5 * assists + 0.3 * shots + 0.4 * hits + 0.4 * blocks
 * For goalies: Uses wins, saves, and save percentage
 */
function calculatePlayerValueFromStats(
  stats: Array<{ statName: string; value: number }>,
  position?: string | null
): number {
  // Normalize stat names for lookup
  const normalizeStatName = (name: string) =>
    name.toLowerCase().trim().replace(/\s+/g, " ").replace(/\./g, "");

  const statMap = new Map<string, number>();
  for (const stat of stats) {
    const normalized = normalizeStatName(stat.statName);
    statMap.set(normalized, stat.value);
  }

  // Goalie-specific calculation
  if (position === "G") {
    const wins = statMap.get("wins") || statMap.get("w") || 0;
    const losses = statMap.get("losses") || statMap.get("l") || 0;
    const saves = statMap.get("saves") || statMap.get("sv") || 0;
    const savePercentage = statMap.get("save percentage") || statMap.get("sv%") || 0;
    const shutouts = statMap.get("shutouts") || statMap.get("sho") || 0;
    const goalsAgainst = statMap.get("goals against") || statMap.get("ga") || 0;
    const gaa = statMap.get("goals against average") || statMap.get("gaa") || 0;
    
    // Yahoo stores SV% as whole number (915 for 91.5%)
    // Normalize to decimal: if > 100, divide by 1000; if > 1, divide by 100
    let normalizedSvPct = savePercentage;
    if (savePercentage > 100) {
      normalizedSvPct = savePercentage / 1000;
    } else if (savePercentage > 1) {
      normalizedSvPct = savePercentage / 100;
    }
    
    // Goalie formula weighted to match Yahoo rankings
    // Elite skaters (MacKinnon) should rank higher than elite goalies (Wedgewood)
    // Scale adjusted so top goalies ~150-180, matching their typical rank position
    return (
      8 * wins +                    // Wins: 8 points each
      0.10 * saves +                // Saves: 0.10 per save  
      50 * normalizedSvPct +        // SV%: 50 * percentage (e.g., 50 * 0.920 = 46)
      12 * shutouts -               // Shutouts: 12 points each
      4 * losses -                  // Losses: -4 points each (significant penalty)
      0.3 * goalsAgainst            // GA: -0.3 per goal against
    );
  }

  // Skater formula weighted for standard Yahoo categories
  const goals = statMap.get("goals") || statMap.get("g") || 0;
  const assists = statMap.get("assists") || statMap.get("a") || 0;
  const points = statMap.get("points") || statMap.get("p") || 0;
  const plusMinus = statMap.get("plus/minus") || statMap.get("+/-") || statMap.get("plusminus") || 0;
  const pim = statMap.get("penalty minutes") || statMap.get("pim") || 0;
  const ppp = statMap.get("power play points") || statMap.get("ppp") || 0;
  const shp = statMap.get("short handed points") || statMap.get("shp") || statMap.get("shorthanded points") || 0;
  const gwg = statMap.get("game winning goals") || statMap.get("gwg") || 0;
  const shots = statMap.get("shots") || statMap.get("shots on goal") || statMap.get("sog") || 0;
  const faceoffs = statMap.get("faceoffs won") || statMap.get("fw") || statMap.get("faceoff wins") || 0;
  const hits = statMap.get("hits") || statMap.get("hit") || 0;
  const blocks = statMap.get("blocks") || statMap.get("blocked shots") || statMap.get("blk") || 0;
  
  // Comprehensive formula matching Yahoo's scoring categories:
  return (
    4 * goals +                     // Goals: 4 points each (most valuable)
    3 * assists +                   // Assists: 3 points each
    0.5 * plusMinus +               // +/-: 0.5 per point
    0.08 * pim +                    // PIM: 0.08 per minute
    2 * ppp +                       // PPP: 2 points each (power play is important)
    3 * shp +                       // SHP: 3 points each (rare and valuable)
    2.5 * gwg +                     // GWG: 2.5 points each
    0.15 * shots +                  // SOG: 0.15 per shot
    0.02 * faceoffs +               // FW: 0.02 per faceoff won
    0.25 * hits +                   // HIT: 0.25 per hit
    0.3 * blocks                    // BLK: 0.3 per block
  );
}

/**
 * Fallback calculation based on position if stats are not available
 */
function calculatePlayerValueFromPosition(player: {
  primaryPosition?: string | null;
  positions?: string | null;
}): number {
  const positionValues: Record<string, number> = {
    C: 50,
    LW: 48,
    RW: 48,
    D: 45,
    G: 55,
  };

  const position = player.primaryPosition || "";
  if (position && positionValues[position]) {
    return positionValues[position];
  }

  if (player.positions) {
    try {
      const positions = JSON.parse(player.positions) as string[];
      if (Array.isArray(positions) && positions.length > 0) {
        const firstPos = positions[0];
        if (positionValues[firstPos]) {
          return positionValues[firstPos];
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return 40;
}

/**
 * Calculate and store player value for a league.
 * Creates or updates PlayerValue record.
 * Uses actual stats if available, falls back to position-based calculation.
 */
export async function calculateAndStorePlayerValue(
  playerId: string,
  leagueId: string
): Promise<number> {
  // Defensive check for Prisma client
  if (!prisma) {
    throw new Error("Prisma client is not initialized");
  }
  
  if (!prisma.playerValue) {
    console.error("prisma.playerValue is undefined. Available models:", Object.keys(prisma).filter(key => !key.startsWith('$')));
    throw new Error("Prisma client does not have playerValue model. Please restart the server after running 'npx prisma generate'");
  }

  const player = await prisma.player.findUnique({
    where: { id: playerId },
  });

  if (!player) {
    throw new Error(`Player not found: ${playerId}`);
  }

  // Try to get stats first
  const playerStats = await prisma.playerStat.findMany({
    where: {
      playerId,
      leagueId,
    },
    select: {
      statName: true,
      value: true,
    },
  });

  let score: number;
  if (playerStats.length > 0) {
    // Use stats-based calculation
    score = calculatePlayerValueFromStats(
      playerStats,
      player.primaryPosition
    );
  } else {
    // Fallback to position-based calculation
    score = calculatePlayerValueFromPosition({
      primaryPosition: player.primaryPosition,
      positions: player.positions,
    });
  }

  // Store breakdown as JSON for reference
  const breakdown = {
    method: playerStats.length > 0 ? "stats" : "position",
    statsCount: playerStats.length,
    position: player.primaryPosition,
  };

  await prisma.playerValue.upsert({
    where: {
      playerId_leagueId: {
        playerId,
        leagueId,
      },
    },
    update: {
      score,
      breakdown: JSON.stringify(breakdown),
    },
    create: {
      playerId,
      leagueId,
      score,
      breakdown: JSON.stringify(breakdown),
    },
  });

  return score;
}

/**
 * Ensure all players in a league have calculated values.
 * This is a batch operation that calculates values for all players
 * that don't have values yet, or updates existing values.
 * Also recalculates draft pick values based on player values.
 */
export async function ensureLeaguePlayerValues(leagueId: string): Promise<void> {
  // Get all players that have roster entries in this league
  const rosterEntries = await prisma.rosterEntry.findMany({
    where: { leagueId },
    select: {
      playerId: true,
    },
    distinct: ["playerId"],
  });

  const playerIds = rosterEntries.map((entry) => entry.playerId);

  console.log(`[PlayerValues] Calculating values for ${playerIds.length} players`);

  // Calculate values for all players
  for (const playerId of playerIds) {
    await calculateAndStorePlayerValue(playerId, leagueId);
  }
  
  console.log(`[PlayerValues] Player values calculated, now calculating draft pick values`);
  
  // Calculate draft pick values based on player values
  await calculateDraftPickValues(leagueId);
}

/**
 * Get player value for a specific player in a league.
 * Returns 0 if no value is calculated yet.
 */
export async function getPlayerValue(
  playerId: string,
  leagueId: string
): Promise<number> {
  const playerValue = await prisma.playerValue.findUnique({
    where: {
      playerId_leagueId: {
        playerId,
        leagueId,
      },
    },
  });

  return playerValue?.score ?? 0;
}

/**
 * Calculate draft pick values dynamically based on actual player values.
 * Each round represents the average value of players in that draft range.
 * 
 * Logic:
 * - Get all player values in the league, sorted highest to lowest
 * - Divide into "draft rounds" based on percentiles
 * - Round 1 = average of top ~6% of players (equivalent to first round picks)
 * - Round 2 = average of next ~6% of players
 * - And so on...
 */
export async function calculateDraftPickValues(leagueId: string): Promise<void> {
  console.log(`[DraftPicks] Calculating dynamic draft pick values for league`);
  
  // Get all player values in the league, sorted by score descending
  const playerValues = await prisma.playerValue.findMany({
    where: { leagueId },
    orderBy: { score: 'desc' },
    select: { score: true },
  });
  
  if (playerValues.length === 0) {
    console.warn(`[DraftPicks] No player values found for league`);
    return;
  }
  
  console.log(`[DraftPicks] Found ${playerValues.length} player values to analyze`);
  
  // Calculate values for 16 rounds
  const totalPlayers = playerValues.length;
  const playersPerRound = Math.max(Math.floor(totalPlayers / 16), 1);
  
  for (let round = 1; round <= 16; round++) {
    const startIdx = (round - 1) * playersPerRound;
    const endIdx = Math.min(round * playersPerRound, totalPlayers);
    
    // Get players in this draft round range
    const roundPlayers = playerValues.slice(startIdx, endIdx);
    
    if (roundPlayers.length === 0) {
      // For later rounds, use diminishing value
      const score = Math.max(5, 85 - (round * 5));
      await prisma.draftPickValue.upsert({
        where: {
          leagueId_round: { leagueId, round },
        },
        update: { score },
        create: { leagueId, round, score },
      });
      console.log(`[DraftPicks] Round ${round}: ${score.toFixed(1)} (no players, using fallback)`);
      continue;
    }
    
    // Calculate average value for this round
    const avgValue = roundPlayers.reduce((sum, p) => sum + p.score, 0) / roundPlayers.length;
    
    // Store the draft pick value
    await prisma.draftPickValue.upsert({
      where: {
        leagueId_round: { leagueId, round },
      },
      update: { score: avgValue },
      create: { leagueId, round, score: avgValue },
    });
    
    console.log(`[DraftPicks] Round ${round}: ${avgValue.toFixed(1)} (avg of ${roundPlayers.length} players, range: ${roundPlayers[0].score.toFixed(1)}-${roundPlayers[roundPlayers.length - 1].score.toFixed(1)})`);
  }
  
  console.log(`[DraftPicks] Draft pick values calculated successfully`);
}

