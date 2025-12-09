/**
 * Script to import historical stats from uploaded CSV files
 * Converts data/nhl_players_stats.csv and data/nhl_goalies_stats.csv to historical-stats.json format
 * 
 * Run with: npx tsx scripts/import-csv-historical-stats.ts
 */

import fs from "fs";
import path from "path";

interface HistoricalStatsData {
  [playerName: string]: {
    [season: string]: {
      [statName: string]: number;
    };
  };
}

// Map CSV column names to our internal stat names
const SKATER_STAT_MAP: Record<string, string> = {
  G: "Goals",
  A: "Assists",
  P: "Points",
  "+/-": "Plus/Minus",
  PIM: "Penalty Minutes",
  PPP: "Power Play Points",
  SHP: "Shorthanded Points",
  GWG: "Game-Winning Goals",
  SOG: "Shots on Goal",
  FW: "Faceoffs Won",
  HIT: "Hits",
  BLK: "Blocks",
};

// Map CSV column names to our internal goalie stat names
const GOALIE_STAT_MAP: Record<string, string> = {
  W: "Wins",
  L: "Losses",
  GA: "Goals Against",
  GAA: "Goals Against Average",
  SV: "Saves",
  "SV%": "Save Percentage",
  SHO: "Shutouts",
};

// Convert season format "2023/24" -> "2023", "2024/25" -> "2024"
function parseSeason(seasonStr: string): string {
  const match = seasonStr.match(/(\d{4})\/(\d{2})/);
  if (!match) {
    throw new Error(`Invalid season format: ${seasonStr}`);
  }
  return match[1]; // Return the starting year (e.g., "2023" from "2023/24")
}

// Aggregate stats for players who played on multiple teams
function aggregatePlayerStats(statsByTeam: Map<string, any>): any {
  const aggregated: any = {};
  let totalGP = 0;
  
  // Sum up all stats across teams
  for (const teamStats of statsByTeam.values()) {
    for (const [key, value] of Object.entries(teamStats)) {
      if (key === "GP") {
        totalGP += Number(value) || 0;
      } else if (key === "team" || key === "season" || key === "player") {
        // Skip metadata
        continue;
      } else if (typeof value === "number" || !isNaN(Number(value))) {
        aggregated[key] = (aggregated[key] || 0) + Number(value);
      }
    }
  }
  
  // Calculate averages for rate stats (GAA, SV%) - weighted by games played
  if (totalGP > 0 && statsByTeam.size > 1) {
    // For goalies: GAA and SV% need special handling
    // GAA: sum GA / sum minutes (approximate as GP * 60)
    // SV%: sum SV / sum SA
    if (aggregated.GA !== undefined && aggregated.GAA !== undefined) {
      // Recalculate GAA from total GA and GP
      aggregated.GAA = totalGP > 0 ? aggregated.GA / totalGP : aggregated.GAA;
    }
    
    if (aggregated.SV !== undefined && aggregated.SA !== undefined && aggregated["SV%"] !== undefined) {
      // Recalculate SV% from total SV and SA
      aggregated["SV%"] = aggregated.SA > 0 ? aggregated.SV / aggregated.SA : aggregated["SV%"];
    }
  }
  
  aggregated.GP = totalGP;
  return aggregated;
}

function parsePlayersCSV(): HistoricalStatsData {
  console.log("[Import CSV] Parsing players CSV...");
  
  const csvPath = path.join(process.cwd(), "data", "nhl_players_stats.csv");
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.trim().split("\n");
  
  const header = lines[0].split(",");
  const headerIndex: Record<string, number> = {};
  header.forEach((col, idx) => {
    headerIndex[col.trim()] = idx;
  });
  
  const historicalStats: HistoricalStatsData = {};
  
  // Track stats by player/season/team for aggregation
  const playerStatsMap = new Map<string, Map<string, Map<string, any>>>();
  
  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    // Parse CSV (handle quoted values)
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const season = values[headerIndex.season];
    const player = values[headerIndex.player];
    const team = values[headerIndex.team];
    
    if (!season || !player) continue;
    
    const seasonYear = parseSeason(season);
    
    // Initialize maps if needed
    if (!playerStatsMap.has(player)) {
      playerStatsMap.set(player, new Map());
    }
    const seasonMap = playerStatsMap.get(player)!;
    if (!seasonMap.has(seasonYear)) {
      seasonMap.set(seasonYear, new Map());
    }
    const teamMap = seasonMap.get(seasonYear)!;
    
    // Store stats by team
    const stats: any = {
      season,
      player,
      team,
    };
    
    for (const [csvKey, ourKey] of Object.entries(SKATER_STAT_MAP)) {
      const idx = headerIndex[csvKey];
      if (idx !== undefined && values[idx] !== undefined) {
        const value = parseFloat(values[idx]);
        if (!isNaN(value)) {
          stats[csvKey] = value;
        }
      }
    }
    
    // Also store GP if available
    if (headerIndex.GP !== undefined && values[headerIndex.GP] !== undefined) {
      stats.GP = parseFloat(values[headerIndex.GP]) || 0;
    }
    
    teamMap.set(team, stats);
  }
  
  // Aggregate and convert to final format
  for (const [player, seasonMap] of playerStatsMap.entries()) {
    historicalStats[player] = {};
    
    for (const [seasonYear, teamMap] of seasonMap.entries()) {
      const aggregated = aggregatePlayerStats(teamMap);
      
      // Convert to our stat format
      historicalStats[player][seasonYear] = {};
      
      for (const [csvKey, ourKey] of Object.entries(SKATER_STAT_MAP)) {
        if (aggregated[csvKey] !== undefined) {
          historicalStats[player][seasonYear][ourKey] = aggregated[csvKey];
        }
      }
    }
  }
  
  console.log(`[Import CSV] Processed ${Object.keys(historicalStats).length} skaters`);
  return historicalStats;
}

function parseGoaliesCSV(existingStats: HistoricalStatsData): void {
  console.log("[Import CSV] Parsing goalies CSV...");
  
  const csvPath = path.join(process.cwd(), "data", "nhl_goalies_stats.csv");
  const content = fs.readFileSync(csvPath, "utf-8");
  const lines = content.trim().split("\n");
  
  const header = lines[0].split(",");
  const headerIndex: Record<string, number> = {};
  header.forEach((col, idx) => {
    headerIndex[col.trim()] = idx;
  });
  
  const playerStatsMap = new Map<string, Map<string, Map<string, any>>>();
  
  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    // Parse CSV
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const season = values[headerIndex.season];
    const player = values[headerIndex.player];
    const team = values[headerIndex.team];
    
    if (!season || !player) continue;
    
    const seasonYear = parseSeason(season);
    
    // Initialize maps if needed
    if (!playerStatsMap.has(player)) {
      playerStatsMap.set(player, new Map());
    }
    const seasonMap = playerStatsMap.get(player)!;
    if (!seasonMap.has(seasonYear)) {
      seasonMap.set(seasonYear, new Map());
    }
    const teamMap = seasonMap.get(seasonYear)!;
    
    // Store stats by team
    const stats: any = {
      season,
      player,
      team,
    };
    
    for (const [csvKey, ourKey] of Object.entries(GOALIE_STAT_MAP)) {
      const idx = headerIndex[csvKey];
      if (idx !== undefined && values[idx] !== undefined) {
        const value = parseFloat(values[idx]);
        if (!isNaN(value)) {
          stats[csvKey] = value;
        }
      }
    }
    
    if (headerIndex.GP !== undefined && values[headerIndex.GP] !== undefined) {
      stats.GP = parseFloat(values[headerIndex.GP]) || 0;
    }
    
    teamMap.set(team, stats);
  }
  
  // Aggregate and add to existing stats
  for (const [player, seasonMap] of playerStatsMap.entries()) {
    if (!existingStats[player]) {
      existingStats[player] = {};
    }
    
    for (const [seasonYear, teamMap] of seasonMap.entries()) {
      const aggregated = aggregatePlayerStats(teamMap);
      
      if (!existingStats[player][seasonYear]) {
        existingStats[player][seasonYear] = {};
      }
      
      // Convert to our stat format
      for (const [csvKey, ourKey] of Object.entries(GOALIE_STAT_MAP)) {
        if (aggregated[csvKey] !== undefined) {
          existingStats[player][seasonYear][ourKey] = aggregated[csvKey];
        }
      }
    }
  }
  
  console.log(`[Import CSV] Processed goalies (added/updated in existing stats)`);
}

function importCSVStats() {
  console.log("[Import CSV] Starting CSV import...");
  
  // Parse skaters first
  const historicalStats = parsePlayersCSV();
  
  // Then add goalies
  parseGoaliesCSV(historicalStats);
  
  // Write to JSON file
  const outputPath = path.join(process.cwd(), "data", "historical-stats.json");
  fs.writeFileSync(outputPath, JSON.stringify(historicalStats, null, 2), "utf-8");
  
  console.log("\n[Import CSV] ===== IMPORT COMPLETE =====");
  console.log(`[Import CSV] Total players: ${Object.keys(historicalStats).length}`);
  
  // Count seasons
  let totalSeasons = 0;
  for (const playerData of Object.values(historicalStats)) {
    totalSeasons += Object.keys(playerData).length;
  }
  console.log(`[Import CSV] Total player-seasons: ${totalSeasons}`);
  console.log(`[Import CSV] Output file: ${outputPath}`);
  console.log(`[Import CSV] File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
  
  // Show sample
  const samplePlayers = ["Connor McDavid", "Nathan MacKinnon", "Artemi Panarin"];
  console.log("\n[Import CSV] Sample data:");
  for (const player of samplePlayers) {
    if (historicalStats[player]) {
      const seasons = Object.keys(historicalStats[player]).sort();
      console.log(`  ${player}:`);
      for (const season of seasons) {
        const goals = historicalStats[player][season]["Goals"] || 0;
        const points = historicalStats[player][season]["Points"] || 0;
        console.log(`    ${season}: ${goals}G, ${points}P`);
      }
    }
  }
}

importCSVStats();

