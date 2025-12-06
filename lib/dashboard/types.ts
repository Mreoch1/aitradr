/**
 * Team Dashboard data structures
 * Comprehensive team analysis for fantasy hockey
 */

export interface CategorySummary {
  label: string;          // "Goals"
  abbrev: string;         // "G"
  value: number;          // Team total or per game
  zScore: number;         // Z-score relative to league
  rank: number;           // 1 is best
  teams: number;          // Total teams in league
  strength: "elite" | "strong" | "neutral" | "weak" | "critical"; // Classification
}

export interface TeamGrade {
  score: number;          // Numeric score (z-score or custom scale)
  letter: string;         // "A", "B", "C", "D", "F"
  reason: string;         // One-line explanation
}

export interface PlayerStats {
  G: number;
  A: number;
  P: number;
  PPP: number;
  SOG: number;
  plusMinus: number;
  PIM: number;
  HIT: number;
  BLK: number;
  FOW: number;
}

export interface GoalieStats {
  W: number;
  L: number;
  GAA: number;
  SV: number;
  SVPCT: number;
  SHO: number;
}

export interface KeeperInfo {
  round: number;
  yearsHeld: number;
  yearsRemaining: number;
  bonus: number;
  totalValue: number;
}

export interface DashboardSkater {
  id: string;
  name: string;
  pos: string;            // "C", "LW/RW", etc (no IR/IR+/Util)
  nhlTeam: string;
  status: string | null;  // "IR", "IR+", "O", etc
  stats: PlayerStats;
  value: number;
  keeper?: KeeperInfo;
}

export interface DashboardGoalie {
  id: string;
  name: string;
  nhlTeam: string;
  status: string | null;  // "IR", "IR+", "O", etc
  stats: GoalieStats;
  value: number;
  keeper?: KeeperInfo;
}

export interface TeamNarrative {
  strengths: string[];    // ["Elite in Goals and Points"]
  weaknesses: string[];   // ["Below average in Hits and Blocks"]
  summary: string;        // Paragraph summary
}

export interface PlayerRecommendation {
  playerId: string;
  name: string;
  pos: string;
  nhlTeam: string;
  currentTeamId: string;
  currentTeamName: string;
  value: number;
  fitScore: number; // Combined score for weak categories
  categoryStats: Record<string, number>; // Stats for the weak categories
  keeper?: KeeperInfo;
}

export interface TeamDashboard {
  leagueId: string;
  leagueKey: string;
  teamId: string;
  teamName: string;
  ownerName: string | null;
  record?: {
    wins: number;
    losses: number;
    ties?: number;
  };

  categorySummary: Record<string, CategorySummary>;

  grades: {
    offense: TeamGrade;
    goalies: TeamGrade;
    physical: TeamGrade;
    depth: TeamGrade;
    keeper: TeamGrade;
  };

  skaters: DashboardSkater[];
  goalies: DashboardGoalie[];

  narrative: TeamNarrative;
  
  recommendations?: PlayerRecommendation[]; // Top 3 players to target
}

