/**
 * Script to export historical stats JSON to CSV format
 * Run with: npx tsx scripts/export-historical-stats-to-csv.ts
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

// All possible stat categories (in a consistent order)
const STAT_CATEGORIES = [
  "Goals",
  "Assists",
  "Points",
  "Plus/Minus",
  "Penalty Minutes",
  "Power Play Points",
  "Shorthanded Points",
  "Game-Winning Goals",
  "Shots on Goal",
  "Hits",
  "Blocks",
  "Faceoffs Won",
];

function exportToCSV() {
  console.log("[Export CSV] Starting CSV export...");

  // Read JSON file
  const jsonPath = path.join(process.cwd(), "data", "historical-stats.json");
  
  if (!fs.existsSync(jsonPath)) {
    console.error(`[Export CSV] Error: File not found at ${jsonPath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(jsonPath, "utf-8");
  const data: HistoricalStatsData = JSON.parse(fileContent);

  // Remove metadata keys if present
  if ("_comment" in data) delete (data as any)._comment;
  if ("_format" in data) delete (data as any)._format;

  console.log(`[Export CSV] Found ${Object.keys(data).length} players`);

  // Create CSV rows
  const rows: string[][] = [];

  // Header row
  const header = ["Player Name", "Season", ...STAT_CATEGORIES];
  rows.push(header);

  // Sort players alphabetically
  const playerNames = Object.keys(data).sort();

  // Create rows for each player and season
  for (const playerName of playerNames) {
    const playerData = data[playerName];
    const seasons = Object.keys(playerData).sort(); // Sort seasons (2023, 2024)

    for (const season of seasons) {
      const seasonData = playerData[season];
      const row: string[] = [playerName, season];

      // Add stat values in consistent order
      for (const stat of STAT_CATEGORIES) {
        const value = seasonData[stat] ?? "";
        row.push(value.toString());
      }

      rows.push(row);
    }
  }

  // Convert to CSV string
  const csvContent = rows.map(row => {
    // Escape commas and quotes in cell values
    return row.map(cell => {
      const cellStr = cell.toString();
      if (cellStr.includes(",") || cellStr.includes('"') || cellStr.includes("\n")) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    }).join(",");
  }).join("\n");

  // Write to file
  const outputPath = path.join(process.cwd(), "data", "historical-stats.csv");
  fs.writeFileSync(outputPath, csvContent, "utf-8");

  console.log(`[Export CSV] ✅ Export complete!`);
  console.log(`[Export CSV] Output file: ${outputPath}`);
  console.log(`[Export CSV] Total rows: ${rows.length - 1} (excluding header)`);
  console.log(`[Export CSV] Players: ${playerNames.length}`);
  console.log(`[Export CSV] File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
}

exportToCSV();

