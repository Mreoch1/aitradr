/**
 * Team Dashboard Builder
 * Generates comprehensive team analysis from league data
 */

import prisma from "@/lib/prisma";
import { calculateKeeperBonus } from "@/lib/keeper/types";
import type {
  TeamDashboard,
  CategorySummary,
  TeamGrade,
  DashboardSkater,
  DashboardGoalie,
  PlayerStats,
  GoalieStats,
  TeamNarrative,
} from "./types";

// Category definitions
const SKATER_CATEGORIES = [
  { code: "G", label: "Goals", abbrev: "G" },
  { code: "A", label: "Assists", abbrev: "A" },
  { code: "P", label: "Points", abbrev: "P" },
  { code: "PPP", label: "Power Play Points", abbrev: "PPP" },
  { code: "SOG", label: "Shots on Goal", abbrev: "SOG" },
  { code: "plusMinus", label: "Plus/Minus", abbrev: "+/-" },
  { code: "PIM", label: "Penalty Minutes", abbrev: "PIM" },
  { code: "HIT", label: "Hits", abbrev: "HIT" },
  { code: "BLK", label: "Blocks", abbrev: "BLK" },
  { code: "FOW", label: "Faceoffs Won", abbrev: "FOW" },
];

const GOALIE_CATEGORIES = [
  { code: "W", label: "Wins", abbrev: "W" },
  { code: "GAA", label: "Goals Against Average", abbrev: "GAA" },
  { code: "SV", label: "Saves", abbrev: "SV" },
  { code: "SVPCT", label: "Save Percentage", abbrev: "SV%" },
  { code: "SHO", label: "Shutouts", abbrev: "SHO" },
];

/**
 * Helper to get stat value by exact name matching (like trade page)
 */
function getStatValue(stats: { statName: string; value: number }[], statName: string): number {
  if (!stats || stats.length === 0) return 0;
  
  const lowerStatName = statName.toLowerCase().trim();
  
  // Map our internal stat names to Yahoo's actual stat names (case-sensitive as stored in DB)
  const yahooStatNameMap: Record<string, string[]> = {
    "goals": ["Goals"],
    "assists": ["Assists"],
    "points": ["Points"],
    "plus/minus": ["Plus/Minus"],
    "penalty minutes": ["Penalty Minutes"],
    "power play points": ["Powerplay Points", "Power Play Points", "PowerPlay Points"],
    "short handed points": ["Shorthanded Points", "Short Handed Points", "ShortHanded Points"],
    "game winning goals": ["Game-Winning Goals", "Game Winning Goals"],
    "shots on goal": ["Shots on Goal", "Shots On Goal"],
    "faceoffs won": ["Faceoffs Won", "FaceOffs Won"],
    "hits": ["Hits"],
    "blocked shots": ["Blocks", "Blocked Shots"],
    "wins": ["Wins"],
    "losses": ["Losses"],
    "goals against": ["Goals Against"],
    "goals against average": ["Goals Against Average"],
    "saves": ["Saves"],
    "save percentage": ["Save Percentage", "Save %"],
    "shutouts": ["Shutouts"],
  };
  
  // Get possible Yahoo stat names
  const possibleNames = yahooStatNameMap[lowerStatName];
  if (!possibleNames) {
    return 0;
  }
  
  // Find exact match from list of possible names
  for (const yahooName of possibleNames) {
    const match = stats.find((s) => s.statName === yahooName);
    if (match) return match.value ?? 0;
  }
  
  return 0;
}

/**
 * Helper to calculate z-score
 */
function calculateZScore(value: number, mean: number, stdDev: number, isNegative = false): number {
  if (stdDev === 0) return 0;
  const z = (value - mean) / stdDev;
  return isNegative ? -z : z; // Invert for negative stats like GAA
}

/**
 * Helper to calculate mean and std dev
 */
function calculateStats(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Helper to convert z-score to letter grade
 */
function zScoreToGrade(score: number): string {
  if (score >= 1.0) return "A";
  if (score >= 0.5) return "B";
  if (score >= -0.5) return "C";
  if (score >= -1.0) return "D";
  return "F";
}

/**
 * Helper to classify category strength
 */
function classifyStrength(zScore: number): CategorySummary["strength"] {
  if (zScore >= 1.0) return "elite";
  if (zScore >= 0.5) return "strong";
  if (zScore >= -0.5) return "neutral";
  if (zScore >= -1.0) return "weak";
  return "critical";
}

/**
 * Build complete team dashboard
 */
export async function buildTeamDashboard(
  leagueId: string,
  leagueKey: string,
  teamId: string
): Promise<TeamDashboard> {
  console.log(`[Dashboard] Building for team ${teamId} in league ${leagueId}`);

  // Fetch all teams with stats for league-wide calculations
  const teams = await prisma.team.findMany({
    where: { leagueId },
    include: {
      rosterEntries: {
        include: {
          player: {
            include: {
              playerValues: { where: { leagueId } },
              playerStats: { where: { leagueId } },
            },
          },
        },
      },
    },
  });

  const targetTeam = teams.find(t => t.id === teamId);
  if (!targetTeam) {
    throw new Error(`Team ${teamId} not found`);
  }

  // Get draft pick values for keeper calculations
  const draftPickValues = await prisma.draftPickValue.findMany({
    where: { leagueId },
    orderBy: { round: 'asc' }
  });
  const pickValueMap = new Map(draftPickValues.map(pv => [pv.round, pv.score]));

  // Calculate league-wide category totals for each team
  const teamCategoryTotals = new Map<string, Record<string, number>>();
  
  for (const team of teams) {
    const totals: Record<string, number> = {
      G: 0, A: 0, P: 0, PPP: 0, SOG: 0, plusMinus: 0,
      PIM: 0, HIT: 0, BLK: 0, FOW: 0,
      W: 0, GAA: 0, SV: 0, SVPCT: 0, SHO: 0,
    };

    for (const entry of team.rosterEntries) {
      const player = entry.player;
      const isGoalie = player.positions?.includes("G") || player.primaryPosition === "G";

      if (!isGoalie) {
        totals.G += getStatValue(player.playerStats, "goals");
        totals.A += getStatValue(player.playerStats, "assists");
        totals.P += getStatValue(player.playerStats, "points");
        totals.PPP += getStatValue(player.playerStats, "power play points");
        totals.SOG += getStatValue(player.playerStats, "shots on goal");
        totals.plusMinus += getStatValue(player.playerStats, "plus/minus");
        totals.PIM += getStatValue(player.playerStats, "penalty minutes");
        totals.HIT += getStatValue(player.playerStats, "hits");
        totals.BLK += getStatValue(player.playerStats, "blocked shots");
        totals.FOW += getStatValue(player.playerStats, "faceoffs won");
      } else {
        totals.W += getStatValue(player.playerStats, "wins");
        totals.GAA += getStatValue(player.playerStats, "goals against average");
        totals.SV += getStatValue(player.playerStats, "saves");
        totals.SVPCT += getStatValue(player.playerStats, "save percentage");
        totals.SHO += getStatValue(player.playerStats, "shutouts");
      }
    }

    teamCategoryTotals.set(team.id, totals);
  }

  // Calculate z-scores for each category
  const categorySummary: Record<string, CategorySummary> = {};
  
  for (const cat of [...SKATER_CATEGORIES, ...GOALIE_CATEGORIES]) {
    const values = Array.from(teamCategoryTotals.values()).map(t => t[cat.code]);
    const { mean, stdDev } = calculateStats(values);
    
    const targetValue = teamCategoryTotals.get(teamId)![cat.code];
    const isNegative = cat.code === "GAA"; // Lower GAA is better
    const zScore = calculateZScore(targetValue, mean, stdDev, isNegative);
    
    // Calculate rank (1 is best)
    const sorted = isNegative 
      ? [...values].sort((a, b) => a - b) // Lower is better
      : [...values].sort((a, b) => b - a); // Higher is better
    const rank = sorted.indexOf(targetValue) + 1;
    
    categorySummary[cat.code] = {
      label: cat.label,
      abbrev: cat.abbrev,
      value: targetValue,
      zScore,
      rank,
      teams: teams.length,
      strength: classifyStrength(zScore),
    };
  }

  // Calculate grades
  const offenseCategories = ["G", "A", "P", "PPP", "SOG"];
  const offenseScore = offenseCategories.reduce((sum, cat) => sum + (categorySummary[cat]?.zScore ?? 0), 0) / offenseCategories.length;
  
  const goalieCategories = ["W", "GAA", "SV", "SVPCT", "SHO"];
  const goalieScore = goalieCategories.reduce((sum, cat) => sum + (categorySummary[cat]?.zScore ?? 0), 0) / goalieCategories.length;
  
  const physicalCategories = ["HIT", "BLK", "PIM"];
  const physicalScore = physicalCategories.reduce((sum, cat) => sum + (categorySummary[cat]?.zScore ?? 0), 0) / physicalCategories.length;
  
  // Depth score: count dual-eligible players and positional coverage
  const rosterSkaters = targetTeam.rosterEntries.filter(e => !e.player.positions?.includes("G"));
  const dualEligible = rosterSkaters.filter(e => {
    const positions = e.player.positions;
    if (!positions) return false;
    try {
      const parsed = typeof positions === 'string' ? JSON.parse(positions) : positions;
      return Array.isArray(parsed) && parsed.length > 1;
    } catch {
      return false;
    }
  }).length;
  const depthScore = (dualEligible / Math.max(rosterSkaters.length, 1)) * 2; // Normalize to ~0-2 z-score range
  
  // Keeper score: total keeper surplus
  let totalKeeperSurplus = 0;
  for (const entry of targetTeam.rosterEntries) {
    if (entry.isKeeper && entry.originalDraftRound && entry.yearsRemaining) {
      const baseValue = entry.player.playerValues[0]?.score ?? 0;
      const bonus = calculateKeeperBonus(baseValue, entry.originalDraftRound, 100, entry.yearsRemaining);
      totalKeeperSurplus += bonus;
    }
  }
  const keeperScore = totalKeeperSurplus / 20; // Normalize: 20 points = 1.0 grade

  const grades = {
    offense: {
      score: offenseScore,
      letter: zScoreToGrade(offenseScore),
      reason: generateGradeReason("Offense", offenseCategories, categorySummary),
    },
    goalies: {
      score: goalieScore,
      letter: zScoreToGrade(goalieScore),
      reason: generateGradeReason("Goaltending", goalieCategories, categorySummary),
    },
    physical: {
      score: physicalScore,
      letter: zScoreToGrade(physicalScore),
      reason: generateGradeReason("Physical", physicalCategories, categorySummary),
    },
    depth: {
      score: depthScore,
      letter: zScoreToGrade(depthScore),
      reason: `${dualEligible} dual-eligible players provide roster flexibility`,
    },
    keeper: {
      score: keeperScore,
      letter: zScoreToGrade(keeperScore),
      reason: `${targetTeam.rosterEntries.filter(e => e.isKeeper).length} keepers with +${totalKeeperSurplus.toFixed(0)} total surplus`,
    },
  };

  // Build skaters array
  const skaters: DashboardSkater[] = targetTeam.rosterEntries
    .filter(e => !e.player.positions?.includes("G") && e.player.primaryPosition !== "G")
    .map(entry => {
      const player = entry.player;
      const baseValue = player.playerValues[0]?.score ?? 0;

      // Parse stats using exact matching
      const stats: PlayerStats = {
        G: getStatValue(player.playerStats, "goals"),
        A: getStatValue(player.playerStats, "assists"),
        P: getStatValue(player.playerStats, "points"),
        PPP: getStatValue(player.playerStats, "power play points"),
        SOG: getStatValue(player.playerStats, "shots on goal"),
        plusMinus: getStatValue(player.playerStats, "plus/minus"),
        PIM: getStatValue(player.playerStats, "penalty minutes"),
        HIT: getStatValue(player.playerStats, "hits"),
        BLK: getStatValue(player.playerStats, "blocked shots"),
        FOW: getStatValue(player.playerStats, "faceoffs won"),
      };

      // Parse positions
      let posStr = "?";
      try {
        const parsed = typeof player.positions === 'string' ? JSON.parse(player.positions) : player.positions;
        if (Array.isArray(parsed)) {
          posStr = parsed.filter(p => p !== "G").join("/");
        }
      } catch {}

      // Keeper info
      let keeper = undefined;
      if (entry.isKeeper && entry.originalDraftRound && entry.yearsRemaining !== null) {
        const bonus = calculateKeeperBonus(baseValue, entry.originalDraftRound, pickValueMap.get(entry.originalDraftRound) ?? 100, entry.yearsRemaining);
        keeper = {
          round: entry.originalDraftRound,
          yearsHeld: entry.keeperYearIndex ?? 0,
          yearsRemaining: entry.yearsRemaining,
          bonus,
          totalValue: baseValue + bonus,
        };
      }

      return {
        id: player.id,
        name: player.name,
        pos: posStr,
        nhlTeam: player.teamAbbr || "?",
        stats,
        value: baseValue,
        keeper,
      };
    })
    .sort((a, b) => (b.keeper?.totalValue ?? b.value) - (a.keeper?.totalValue ?? a.value));

  // Build goalies array
  const goalies: DashboardGoalie[] = targetTeam.rosterEntries
    .filter(e => e.player.positions?.includes("G") || e.player.primaryPosition === "G")
    .map(entry => {
      const player = entry.player;
      const baseValue = player.playerValues[0]?.score ?? 0;

      // Parse stats using exact matching
      const stats: GoalieStats = {
        W: getStatValue(player.playerStats, "wins"),
        L: getStatValue(player.playerStats, "losses"),
        GAA: getStatValue(player.playerStats, "goals against average"),
        SV: getStatValue(player.playerStats, "saves"),
        SVPCT: getStatValue(player.playerStats, "save percentage"),
        SHO: getStatValue(player.playerStats, "shutouts"),
      };

      // Keeper info
      let keeper = undefined;
      if (entry.isKeeper && entry.originalDraftRound && entry.yearsRemaining !== null) {
        const bonus = calculateKeeperBonus(baseValue, entry.originalDraftRound, pickValueMap.get(entry.originalDraftRound) ?? 100, entry.yearsRemaining);
        keeper = {
          round: entry.originalDraftRound,
          yearsHeld: entry.keeperYearIndex ?? 0,
          yearsRemaining: entry.yearsRemaining,
          bonus,
          totalValue: baseValue + bonus,
        };
      }

      return {
        id: player.id,
        name: player.name,
        nhlTeam: player.teamAbbr || "?",
        stats,
        value: baseValue,
        keeper,
      };
    })
    .sort((a, b) => (b.keeper?.totalValue ?? b.value) - (a.keeper?.totalValue ?? a.value));

  // Generate narrative
  const narrative = generateNarrative(categorySummary, grades);

  return {
    leagueId,
    leagueKey,
    teamId,
    teamName: targetTeam.name,
    ownerName: targetTeam.yahooManagerId,
    categorySummary,
    grades,
    skaters,
    goalies,
    narrative,
  };
}

/**
 * Generate grade reason text
 */
function generateGradeReason(
  area: string,
  categories: string[],
  summary: Record<string, CategorySummary>
): string {
  const strong = categories.filter(cat => (summary[cat]?.zScore ?? 0) > 0.5);
  const weak = categories.filter(cat => (summary[cat]?.zScore ?? 0) < -0.5);

  if (strong.length >= 2) {
    return `Strong in ${strong.map(c => summary[c]?.abbrev).join(", ")}`;
  }
  if (weak.length >= 2) {
    return `Weak in ${weak.map(c => summary[c]?.abbrev).join(", ")}`;
  }
  if (strong.length > 0) {
    return `Good ${strong.map(c => summary[c]?.abbrev).join(", ")}`;
  }
  if (weak.length > 0) {
    return `Needs help in ${weak.map(c => summary[c]?.abbrev).join(", ")}`;
  }
  return "Balanced across categories";
}

/**
 * Generate narrative text
 */
function generateNarrative(
  summary: Record<string, CategorySummary>,
  grades: Record<string, TeamGrade>
): TeamNarrative {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  // Find elite and weak categories
  for (const [code, cat] of Object.entries(summary)) {
    if (cat.zScore >= 1.0) {
      strengths.push(`Elite in ${cat.label} (Rank ${cat.rank})`);
    } else if (cat.zScore >= 0.5) {
      strengths.push(`Strong in ${cat.label}`);
    } else if (cat.zScore <= -1.0) {
      weaknesses.push(`Critical weakness in ${cat.label} (Rank ${cat.rank})`);
    } else if (cat.zScore <= -0.5) {
      weaknesses.push(`Below average in ${cat.label}`);
    }
  }

  // Generate summary paragraph
  const summaryParts: string[] = [];
  
  if (grades.offense.letter === "A" || grades.offense.letter === "B") {
    summaryParts.push("strong offensive core");
  } else if (grades.offense.letter === "D" || grades.offense.letter === "F") {
    summaryParts.push("struggling offense");
  }
  
  if (grades.physical.letter === "A" || grades.physical.letter === "B") {
    summaryParts.push("dominant physical game");
  } else if (grades.physical.letter === "D" || grades.physical.letter === "F") {
    summaryParts.push("weak physical categories");
  }
  
  if (grades.keeper.letter === "A" || grades.keeper.letter === "B") {
    summaryParts.push("excellent keeper value");
  }

  const summaryText = summaryParts.length > 0
    ? `This team has ${summaryParts.join(", ")}.`
    : "This team shows balanced strengths across categories.";

  return {
    strengths: strengths.length > 0 ? strengths : ["Balanced roster"],
    weaknesses: weaknesses.length > 0 ? weaknesses : ["No critical weaknesses"],
    summary: summaryText,
  };
}

