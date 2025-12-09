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
// Supports both old format (GP,GS,W,L,GA,GAA,SV,SA,SV%,SHO) and new format (full names)
const GOALIE_STAT_MAP: Record<string, string> = {
  // New format (full names)
  "Wins": "Wins",
  "Losses": "Losses", // Not used in calculation but stored
  "Goals Against": "Goals Against", // Not directly used, but GAA is
  "Goals Against Average": "Goals Against Average",
  "Saves": "Saves",
  "Save Percentage": "Save Percentage",
  "Shutouts": "Shutouts",
  // Old format (abbreviations) - for backwards compatibility
  "W": "Wins",
  "L": "Losses",
  "GA": "Goals Against",
  "GAA": "Goals Against Average",
  "SV": "Saves",
  "SV%": "Save Percentage",
  "SHO": "Shutouts",
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
  // For goalies: GAA and SV% need special handling when aggregating across teams
  if (totalGP > 0 && statsByTeam.size > 1) {
    // GAA: Recalculate from total GA and total games
    // Note: GAA is per game, so we sum GA and divide by sum of GP
    if (aggregated.GA !== undefined && totalGP > 0) {
      aggregated.GAA = aggregated.GA / totalGP;
    }
    
    // SV%: Recalculate from total SV and total SA
    // SV% = Total Saves / Total Shots Against
    if (aggregated.SV !== undefined && aggregated.SA !== undefined && aggregated.SA > 0) {
      aggregated["SV%"] = aggregated.SV / aggregated.SA;
    }
  }
  
  // Ensure saves and save percentage are calculated if missing
  if (aggregated.SA !== undefined && aggregated.GA !== undefined) {
    // Calculate saves if missing
    if (!aggregated.SV || aggregated.SV === 0) {
      aggregated.SV = Math.max(0, aggregated.SA - aggregated.GA);
    }
    // Calculate save percentage if missing
    if ((!aggregated["SV%"] || aggregated["SV%"] === 0) && aggregated.SA > 0 && aggregated.SV > 0) {
      aggregated["SV%"] = aggregated.SV / aggregated.SA;
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
  
  // Detect format: new format has "Player Name" and "Season", old format has "season" and "player"
  const isNewFormat = headerIndex["Player Name"] !== undefined || headerIndex["Season"] !== undefined;
  
  // Map header keys based on format
  const seasonKey = isNewFormat ? "Season" : "season";
  const playerKey = isNewFormat ? "Player Name" : "player";
  const teamKey = isNewFormat ? "Team" : "team";
  
  console.log(`[Import CSV] Detected ${isNewFormat ? "new" : "old"} CSV format for goalies`);
  
  const playerStatsMap = new Map<string, Map<string, Map<string, any>>>();
  
  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.includes("League Average")) continue; // Skip league average rows
    
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
    
    const season = values[headerIndex[seasonKey]];
    const player = values[headerIndex[playerKey]];
    const team = values[headerIndex[teamKey]];
    
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
    
    // Map column names based on format
    const savesKey = isNewFormat ? "Saves" : "SV";
    const saKey = isNewFormat ? "Shots Against" : "SA";
    const gaKey = isNewFormat ? "Goals Against" : "GA";
    const gaaKey = isNewFormat ? "Goals Against Average" : "GAA";
    const svpKey = isNewFormat ? "Save Percentage" : "SV%";
    const winsKey = isNewFormat ? "Wins" : "W";
    const lossesKey = isNewFormat ? "Losses" : "L";
    const shutoutsKey = isNewFormat ? "Shutouts" : "SHO";
    const gpKey = isNewFormat ? "Games Played" : "GP";
    const gsKey = isNewFormat ? "Games Started" : "GS";
    
    // Get stat values
    for (const [csvKey, ourKey] of Object.entries(GOALIE_STAT_MAP)) {
      const idx = headerIndex[csvKey];
      if (idx !== undefined && values[idx] !== undefined && values[idx] !== "") {
        const value = parseFloat(values[idx]);
        if (!isNaN(value)) {
          stats[csvKey] = value;
          // Also store with our internal key
          stats[ourKey] = value;
        }
      }
    }
    
    // Get Saves, SA, GA for calculation if missing
    const saves = stats[savesKey] || stats["Saves"] || (headerIndex[savesKey] !== undefined ? parseFloat(values[headerIndex[savesKey]]) : undefined);
    const sa = headerIndex[saKey] !== undefined ? parseFloat(values[headerIndex[saKey]]) : undefined;
    const ga = headerIndex[gaKey] !== undefined ? parseFloat(values[headerIndex[gaKey]]) : undefined;
    
    // Calculate saves if missing (SV = SA - GA)
    if ((!saves || saves === 0) && sa !== undefined && ga !== undefined && sa > 0) {
      const calculatedSaves = sa - ga;
      stats["Saves"] = calculatedSaves;
      stats["SV"] = calculatedSaves; // Store both formats
    }
    
    // Get save percentage
    const svp = stats[svpKey] || stats["Save Percentage"] || (headerIndex[svpKey] !== undefined ? parseFloat(values[headerIndex[svpKey]]) : undefined);
    
    // Calculate save percentage if missing (SV% = SV / SA)
    const finalSaves = stats["Saves"] || saves || 0;
    if ((!svp || svp === 0) && sa !== undefined && sa > 0 && finalSaves > 0) {
      const calculatedSVP = finalSaves / sa;
      stats["Save Percentage"] = calculatedSVP;
      stats["SV%"] = calculatedSVP; // Store both formats
    }
    
    // Store GP and GS
    if (headerIndex[gpKey] !== undefined && values[headerIndex[gpKey]] !== undefined && values[headerIndex[gpKey]] !== "") {
      stats.GP = parseFloat(values[headerIndex[gpKey]]) || 0;
    }
    
    if (headerIndex[gsKey] !== undefined && values[headerIndex[gsKey]] !== undefined && values[headerIndex[gsKey]] !== "") {
      stats.GS = parseFloat(values[headerIndex[gsKey]]) || 0;
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
      
      // Convert to our stat format - use the internal key names
      // Handle both old and new format keys
      if (aggregated["Wins"] !== undefined || aggregated["W"] !== undefined) {
        existingStats[player][seasonYear]["Wins"] = aggregated["Wins"] || aggregated["W"];
      }
      if (aggregated["Goals Against Average"] !== undefined || aggregated["GAA"] !== undefined) {
        existingStats[player][seasonYear]["Goals Against Average"] = aggregated["Goals Against Average"] || aggregated["GAA"];
      }
      if (aggregated["Saves"] !== undefined || aggregated["SV"] !== undefined) {
        existingStats[player][seasonYear]["Saves"] = aggregated["Saves"] || aggregated["SV"];
      }
      if (aggregated["Save Percentage"] !== undefined || aggregated["SV%"] !== undefined) {
        existingStats[player][seasonYear]["Save Percentage"] = aggregated["Save Percentage"] || aggregated["SV%"];
      }
      if (aggregated["Shutouts"] !== undefined || aggregated["SHO"] !== undefined) {
        existingStats[player][seasonYear]["Shutouts"] = aggregated["Shutouts"] || aggregated["SHO"];
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

