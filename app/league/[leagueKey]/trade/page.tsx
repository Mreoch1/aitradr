"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { TradeData } from "@/app/api/league/[leagueKey]/trade-data/route";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import { ThemeSwitcher } from "@/app/components/ThemeSwitcher";
import { ShakezullaPlayer } from "@/app/components/ShakezullaPlayer";
import { SignOutButton } from "@/app/components/SignOutButton";
import { AISuggestionsModal } from "@/app/components/AISuggestionsModal";
import { SavedTradesModal } from "@/app/components/SavedTradesModal";
import { KeeperSummary } from "@/app/components/KeeperSummary";
import type { TradeSuggestion } from "@/lib/ai/tradeAnalyzer";
import { handleTokenExpiration } from "@/lib/yahoo/client";

type TradeSide = {
  teamId: string | null;
  playerIds: string[];
  picks: number[]; // rounds
};

// Helper to get stat value by name - exact matching based on Yahoo's actual stat names
function getStatValue(stats: { statName: string; value: number }[] | null | undefined, statName: string): number {
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
    console.warn(`Unknown stat name: ${statName}`);
    return 0;
  }
  
  // Find exact match from list of possible names
  for (const yahooName of possibleNames) {
    const match = stats.find((s) => s.statName === yahooName);
    if (match) return match.value;
  }
  
  return 0;
}

// Helper to format stat name for display
function formatStatName(name: string): string {
  const abbreviations: Record<string, string> = {
    "goals": "G",
    "assists": "A",
    "points": "P",
    "plus/minus": "+/-",
    "penalty minutes": "PIM",
    "power play points": "PPP",
    "short handed points": "SHP",
    "game winning goals": "GWG",
    "shots on goal": "SOG",
    "faceoffs won": "FW",
    "hits": "HIT",
    "blocked shots": "BLK",
    "wins": "W",
    "losses": "L",
    "goals against": "GA",
    "goals against average": "GAA",
    "saves": "SV",
    "save percentage": "SV%",
    "shutouts": "SHO",
  };
  
  const lower = name.toLowerCase();
  for (const [key, abbrev] of Object.entries(abbreviations)) {
    if (lower.includes(key)) return abbrev;
  }
  return name;
}

export default function TradeBuilderPage() {
  const params = useParams();
  const leagueKey = params.leagueKey as string;

  const [tradeData, setTradeData] = useState<TradeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sideA, setSideA] = useState<TradeSide>({
    teamId: null,
    playerIds: [],
    picks: [],
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<TradeSuggestion[]>([]);
  const [showAiModal, setShowAiModal] = useState(false);
  const [savedTrades, setSavedTrades] = useState<any[]>([]);
  const [showSavedTradesModal, setShowSavedTradesModal] = useState(false);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [sideB, setSideB] = useState<TradeSide>({
    teamId: null,
    playerIds: [],
    picks: [],
  });
  const [pendingSelections, setPendingSelections] = useState<{
    A: string[];
    B: string[];
  }>({ A: [], B: [] });
  
  // Sorting state
  const [sortConfig, setSortConfig] = useState<{
    teamA: { key: string; direction: 'asc' | 'desc' } | null;
    teamB: { key: string; direction: 'asc' | 'desc' } | null;
  }>({ teamA: null, teamB: null });
  
  // Refs for syncing top and bottom scroll bars
  const topScrollRefA = useRef<HTMLDivElement>(null);
  const tableScrollRefA = useRef<HTMLDivElement>(null);
  const topScrollRefB = useRef<HTMLDivElement>(null);
  const tableScrollRefB = useRef<HTMLDivElement>(null);

  // Sync scroll handlers
  const handleTopScrollA = () => {
    if (topScrollRefA.current && tableScrollRefA.current) {
      tableScrollRefA.current.scrollLeft = topScrollRefA.current.scrollLeft;
    }
  };

  const handleTableScrollA = () => {
    if (topScrollRefA.current && tableScrollRefA.current) {
      topScrollRefA.current.scrollLeft = tableScrollRefA.current.scrollLeft;
    }
  };

  const handleTopScrollB = () => {
    if (topScrollRefB.current && tableScrollRefB.current) {
      tableScrollRefB.current.scrollLeft = topScrollRefB.current.scrollLeft;
    }
  };

  const handleTableScrollB = () => {
    if (topScrollRefB.current && tableScrollRefB.current) {
      topScrollRefB.current.scrollLeft = tableScrollRefB.current.scrollLeft;
    }
  };

  useEffect(() => {
    async function fetchTradeData() {
      try {
        const response = await fetch(`/api/league/${leagueKey}/trade-data`);
        const result = await response.json();

        if (!result.ok) {
          if (handleTokenExpiration(result, `/league/${leagueKey}/trade`)) {
            return;
          }
          setError(result.error || "Failed to load trade data");
          return;
        }

        setTradeData(result.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trade data");
      } finally {
        setLoading(false);
      }
    }

    fetchTradeData();
    
    // Auto-refresh data every 30 seconds
    const interval = setInterval(fetchTradeData, 30000);
    return () => clearInterval(interval);
  }, [leagueKey]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="text-center">
          {/* Mooninites Pixel Art */}
          <div className="relative mx-auto mb-8 h-48 w-64">
            {/* Animated Mooninite */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="animate-pulse" style={{ imageRendering: 'pixelated' }}>
                <img 
                  src="/mooninites.png" 
                  alt="Loading" 
                  className="h-32 w-auto pixelated"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              </div>
              
            {/* Retro Scanlines */}
            <div className="absolute inset-0 pointer-events-none" style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 255, 0, 0.03) 2px, rgba(0, 255, 0, 0.03) 4px)'
            }}></div>
              </div>
              
          {/* Pixel Text */}
          <div className="space-y-4">
            <h2 className="font-mono text-3xl font-bold text-green-500" style={{ 
              textShadow: '2px 2px 0px #10b981, 4px 4px 0px #059669',
              letterSpacing: '0.1em'
            }}>
              LOADING
            </h2>
            
            {/* Retro Progress Bar */}
            <div className="mx-auto h-6 w-64 border-4 border-green-500 bg-black p-1">
              <div className="h-full animate-pulse bg-gradient-to-r from-green-500 via-purple-500 to-green-500 bg-[length:200%_100%]" style={{
                animation: 'progressBar 2s linear infinite'
                  }}></div>
                </div>
            
            <p className="font-mono text-sm text-green-400">
              THE MOONINITES ARE SYNCING YOUR DATA...
            </p>
            
            {/* Blinking Cursor */}
            <div className="flex items-center justify-center gap-1">
              <span className="font-mono text-purple-500">PLEASE WAIT</span>
              <span className="inline-block h-4 w-2 animate-pulse bg-purple-500"></span>
              </div>
            </div>
            
            <style jsx>{`
            @keyframes progressBar {
              0% {
                background-position: 0% 50%;
                }
                100% {
                background-position: 200% 50%;
                }
              }
            `}</style>
        </div>
      </div>
    );
  }

  if (error || !tradeData) {
    return (
      <div className="min-h-screen theme-bg-secondary">
        <div className="container mx-auto px-4 py-8">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <p className="text-red-600">{error || "Failed to load trade data"}</p>
            <Link
              href={`/league/${leagueKey}`}
              className="mt-4 inline-block text-blue-600 hover:text-blue-800"
            >
              ← Back to League
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Ensure all teams have draftPicks array
  const normalizedTradeData: TradeData = {
    ...tradeData,
    teams: tradeData.teams.map((team) => ({
      ...team,
      draftPicks: team.draftPicks || [],
    })),
  };

  const teamA = normalizedTradeData.teams.find((t) => t.id === sideA.teamId);
  const teamB = normalizedTradeData.teams.find((t) => t.id === sideB.teamId);

  // Build pick value map first (needed for keeper bonus calculation)
  const pickValueMap = new Map<number, number>();
  normalizedTradeData.draftPickValues.forEach((pick) => {
    pickValueMap.set(pick.round, pick.score);
  });

  // Helper: Calculate keeper-adjusted value
  const getPlayerTradeValue = (player: TradeData["teams"][0]["roster"][0]): number => {
    const baseValue = player.valueScore;
    
    // If not a keeper, return base value
    if (!player.isKeeper || !player.keeperRoundCost) {
      return baseValue;
    }
    
    // Calculate keeper bonus (surplus value × years remaining factor)
    const draftRoundAvg = pickValueMap.get(player.keeperRoundCost) ?? 100;
    const surplus = Math.max(0, baseValue - draftRoundAvg);
    const yearsRemainingFactor = (player.yearsRemaining ?? 0) / 3;
    const keeperBonus = surplus * yearsRemainingFactor;
    
    return baseValue + keeperBonus;
  };

  const playerValueMap = new Map<string, number>();
  normalizedTradeData.teams.forEach((team) => {
    team.roster.forEach((player) => {
      // Use keeper-adjusted value for trade calculations
      const tradeValue = getPlayerTradeValue(player);
      playerValueMap.set(player.playerId, tradeValue);
    });
  });

  const togglePendingPlayer = (side: "A" | "B", playerId: string) => {
    setPendingSelections((prev) => ({
      ...prev,
      [side]: prev[side].includes(playerId)
        ? prev[side].filter((id) => id !== playerId)
        : [...prev[side], playerId],
    }));
  };

  const confirmPlayers = (side: "A" | "B") => {
    if (side === "A") {
      setSideA((prev) => ({
        ...prev,
        playerIds: [...prev.playerIds, ...pendingSelections.A],
      }));
      setPendingSelections((prev) => ({ ...prev, A: [] }));
    } else {
      setSideB((prev) => ({
        ...prev,
        playerIds: [...prev.playerIds, ...pendingSelections.B],
      }));
      setPendingSelections((prev) => ({ ...prev, B: [] }));
    }
  };

  const removePlayer = (side: "A" | "B", playerId: string) => {
    if (side === "A") {
      setSideA((prev) => ({
        ...prev,
        playerIds: prev.playerIds.filter((id) => id !== playerId),
      }));
    } else {
      setSideB((prev) => ({
        ...prev,
        playerIds: prev.playerIds.filter((id) => id !== playerId),
      }));
    }
  };

  const handleSort = (team: 'teamA' | 'teamB', statKey: string) => {
    setSortConfig((prev) => {
      const currentConfig = prev[team];
      const newDirection = 
        currentConfig?.key === statKey && currentConfig.direction === 'desc'
          ? 'asc'
          : 'desc';
      
      return {
        ...prev,
        [team]: { key: statKey, direction: newDirection },
      };
    });
  };

  const sortPlayers = (
    players: TradeData["teams"][0]["roster"],
    config: { key: string; direction: 'asc' | 'desc' } | null
  ) => {
    if (!config) return players;
    
    const sorted = [...players].sort((a, b) => {
      let aValue: number | string = 0;
      let bValue: number | string = 0;
      
      if (config.key === 'value') {
        aValue = a.valueScore;
        bValue = b.valueScore;
      } else if (config.key === 'name') {
        aValue = a.name;
        bValue = b.name;
      } else {
        // Stat sorting
        aValue = getStatValue(a.stats, config.key);
        bValue = getStatValue(b.stats, config.key);
      }
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return config.direction === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }
      
      return config.direction === 'asc' 
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });
    
    return sorted;
  };

  const togglePick = (side: "A" | "B", round: number) => {
    if (side === "A") {
      setSideA((prev) => ({
        ...prev,
        picks: prev.picks.includes(round)
          ? prev.picks.filter((r) => r !== round)
          : [...prev.picks, round],
      }));
    } else {
      setSideB((prev) => ({
        ...prev,
        picks: prev.picks.includes(round)
          ? prev.picks.filter((r) => r !== round)
          : [...prev.picks, round],
      }));
    }
  };

  const teamASends = [
    ...sideA.playerIds.map((pid) => ({
      type: "player" as const,
      id: pid,
      value: playerValueMap.get(pid) ?? 0,
    })),
    ...sideA.picks.map((round) => ({
      type: "pick" as const,
      id: round,
      value: pickValueMap.get(round) ?? 0,
    })),
  ];

  const teamBSends = [
    ...sideB.playerIds.map((pid) => ({
      type: "player" as const,
      id: pid,
      value: playerValueMap.get(pid) ?? 0,
    })),
    ...sideB.picks.map((round) => ({
      type: "pick" as const,
      id: round,
      value: pickValueMap.get(round) ?? 0,
    })),
  ];

  const teamAReceiveTotal = teamBSends.reduce((sum, item) => sum + item.value, 0);
  const teamBReceiveTotal = teamASends.reduce((sum, item) => sum + item.value, 0);
  const diff = teamAReceiveTotal - teamBReceiveTotal;

  // Sortable header component
  const SortableHeader = ({ 
    label, 
    statKey, 
    team, 
    className = "px-2 py-2 text-center font-semibold text-gray-700" 
  }: { 
    label: string; 
    statKey: string; 
    team: 'teamA' | 'teamB'; 
    className?: string;
  }) => {
    const config = sortConfig[team];
    const isActive = config?.key === statKey;
    const arrow = isActive ? (config.direction === 'desc' ? ' ↓' : ' ↑') : '';
    
    return (
      <th 
        className={`${className} cursor-pointer hover:bg-gray-200 select-none`}
        onClick={() => handleSort(team, statKey)}
        title={`Sort by ${label}`}
      >
        {label}{arrow}
      </th>
    );
  };

  // Render player row with stats
  const renderPlayerRow = (
    player: TradeData["teams"][0]["roster"][0],
    side: "A" | "B",
    isPending: boolean,
    isConfirmed: boolean,
    isGoalieTable: boolean,
    index: number
  ) => {
    const isGoalie = player.position === "G";
    const stats = player.stats || [];
    
    const rowBgColor = index % 2 === 0 ? "theme-bg-primary" : "theme-bg-secondary";
    const hoverColor = "hover:opacity-80";
    const selectedColor = isConfirmed ? "!bg-green-100 dark:!bg-green-900" : "";

    return (
      <tr key={player.playerId} className={`border-t border-gray-200 ${selectedColor || rowBgColor} ${hoverColor} transition-colors`}>
        <td className="px-2 py-2">
          <input
            type="checkbox"
            checked={isPending || isConfirmed}
            onChange={() => {
              if (isConfirmed) {
                removePlayer(side, player.playerId);
              } else {
                togglePendingPlayer(side, player.playerId);
              }
            }}
            className="h-4 w-4"
          />
        </td>
        <td className="px-3 py-2 text-sm font-bold text-blue-700 bg-blue-50">
          <div className="flex flex-col items-center">
            <span>{player.valueScore.toFixed(1)}</span>
            {player.isKeeper && player.yearsRemaining && player.yearsRemaining > 0 && (
              <span className="text-xs text-purple-600 font-semibold">
                +{((player.valueScore - (pickValueMap.get(player.keeperRoundCost ?? 0) ?? 100)) * (player.yearsRemaining / 3)).toFixed(0)} K
              </span>
            )}
          </div>
            </td>
        <td className="px-2 py-2 text-sm font-medium theme-text-primary">
          <div className="flex items-center gap-2">
            <span>{player.name}</span>
            {player.status && (player.status === "IR" || player.status === "IR+" || player.status === "O") && (
              <span className="inline-block px-1.5 py-0.5 text-xs font-bold text-white bg-red-600 rounded">
                {player.status}
              </span>
            )}
            {player.isKeeper && (
              <span 
                className="inline-block px-1.5 py-0.5 text-xs font-bold text-white bg-purple-600 rounded"
                title={`Keeper: Year ${(player.keeperYearIndex ?? 0) + 1}, ${player.yearsRemaining ?? 0} years left, Cost R${player.keeperRoundCost ?? 0}`}
              >
                K
              </span>
            )}
          </div>
            </td>
        <td className="px-2 py-2 text-sm theme-text-secondary">
          {(() => {
            if (!player.positions && !player.position) return "-";
            
            // Get positions string and clean it up
            let posStr = player.positions || player.position || "";
            
            // Remove brackets, quotes, and extra characters
            posStr = posStr.replace(/[\[\]"']/g, '');
            
            // Split by comma or slash
            const positions = posStr.split(/[,\/]/).map(p => p.trim());
            
            // Filter out non-position items (Util, IR, IR+, O, etc.)
            const validPositions = positions.filter(p => {
              const upper = p.toUpperCase();
              return ['C', 'LW', 'RW', 'D', 'G'].includes(upper);
            });
            
            // Return unique positions joined by slash
            return [...new Set(validPositions)].join('/') || (player.position || "-");
          })()}
            </td>
        <td className="px-2 py-2 text-sm theme-text-secondary">{player.nhlTeam || "-"}</td>
        {isGoalieTable ? (
          // Goalie stats
          <>
            <td className="px-2 py-2 text-sm text-center font-medium text-green-700">
              {getStatValue(stats, "wins").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center font-medium text-red-700">
              {getStatValue(stats, "losses").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "goals against").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "goals against average").toFixed(2)}
            </td>
            <td className="px-2 py-2 text-sm text-center font-medium text-blue-700">
              {getStatValue(stats, "saves").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {(() => {
                const svPct = getStatValue(stats, "save percentage");
                // Yahoo stores SV% as a whole number like 915 for 91.5%
                // But sometimes it's already a decimal or percentage
                if (svPct > 100) {
                  return (svPct / 1000).toFixed(3); // 915 -> 0.915
                } else if (svPct > 1) {
                  return (svPct / 100).toFixed(3); // 91.5 -> 0.915
                } else {
                  return svPct.toFixed(3); // 0.915 -> 0.915
                }
              })()}
            </td>
            <td className="px-2 py-2 text-sm text-center font-medium text-purple-700">
              {getStatValue(stats, "shutouts").toFixed(0)}
            </td>
          </>
        ) : (
          // Skater stats
          <>
            <td className="px-2 py-2 text-sm text-center font-medium text-green-700">
              {getStatValue(stats, "goals").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center font-medium text-blue-700">
              {getStatValue(stats, "assists").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center font-semibold text-purple-700">
              {getStatValue(stats, "points").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "plus/minus").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "penalty minutes").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center font-medium text-orange-700">
              {getStatValue(stats, "power play points").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "short handed points").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "game winning goals").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "shots on goal").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "faceoffs won").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "hits").toFixed(0)}
            </td>
            <td className="px-2 py-2 text-sm text-center text-gray-700">
              {getStatValue(stats, "blocked shots").toFixed(0)}
            </td>
          </>
        )}
      </tr>
    );
  };

  return (
    <ThemeProvider>
      <div className="min-h-screen theme-bg-secondary">
      <div className="container mx-auto px-4 py-6">
        {/* Retro Header with Branding */}
        <div className="mb-6 border-4 border-black bg-gradient-to-r from-purple-600 via-green-500 to-purple-600 px-4 py-4 shadow-lg md:px-6" style={{ imageRendering: 'pixelated' }}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Left side - Mooninites branding */}
            <div className="flex items-center gap-3">
              {/* Mooninites image */}
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded border-4 border-black bg-black shadow-lg overflow-hidden md:h-20 md:w-20">
                <img 
                  src="/mooninites.png" 
                  alt="Mooninites" 
                  className="h-full w-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold uppercase tracking-wider text-black" style={{ fontFamily: 'monospace', textShadow: '1px 1px 0px rgba(255,255,255,0.5)' }}>
                  Brought to you by
                </div>
                <h1 className="text-lg font-bold uppercase text-white md:text-2xl" style={{ fontFamily: 'monospace', textShadow: '3px 3px 0px rgba(0,0,0,0.5), 0 0 10px rgba(0,255,0,0.5)' }}>
                  The Mooninites
          </h1>
              </div>
            </div>
            
            {/* Right side - Trade Builder info */}
            <div className="flex items-center justify-between gap-3 md:flex-col md:items-end md:text-right">
              <div className="flex-1 md:flex-none">
                <div className="text-xs font-bold uppercase text-black md:text-sm" style={{ fontFamily: 'monospace' }}>
                  Trade Builder
                </div>
                <div className="text-sm font-bold text-white md:text-lg" style={{ fontFamily: 'monospace', textShadow: '2px 2px 0px rgba(0,0,0,0.5)' }}>
                  {normalizedTradeData.leagueName}
                </div>
                {normalizedTradeData.lastUpdated && (
                  <div className="text-xs text-white mt-1 bg-black bg-opacity-30 px-2 py-1 rounded" style={{ fontFamily: 'monospace' }}>
                    📅 Updated: {new Date(normalizedTradeData.lastUpdated).toLocaleString('en-US', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      hour12: true
                    })}
                  </div>
                )}
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <Link 
                  href={`/league/${leagueKey}/formula`}
                  className="text-xs font-mono text-white hover:text-yellow-300 underline whitespace-nowrap"
                >
                  📊
                </Link>
                <div className="scale-90 md:scale-100">
                  <ThemeSwitcher />
                </div>
                <SignOutButton />
              </div>
            </div>
          </div>
          {/* Retro pixel effect border */}
          <div className="mt-2 flex gap-1 overflow-hidden">
            {[...Array(80)].map((_, i) => (
              <div key={i} className="h-1 w-1 flex-shrink-0 bg-black"></div>
            ))}
          </div>
        </div>

        {/* Welcome Message with AI Button */}
        {normalizedTradeData.myTeamName ? (
          <div className="mb-6 space-y-4">
            <div className="rounded-lg border-2 border-green-500 bg-green-50 px-6 py-4 shadow-md">
              <p className="text-center text-lg font-bold text-green-900">
                🏒 Welcome, <span className="text-green-600">{normalizedTradeData.myTeamName}</span>!
              </p>
            </div>
            
            {/* Warning if no values calculated or data is stale */}
            {(() => {
              const allPlayers = normalizedTradeData.teams.flatMap(t => t.roster);
              const hasValues = allPlayers.some(p => p.valueScore > 0);
              
              // Check if data is stale (>12 hours old)
              const lastUpdated = normalizedTradeData.lastUpdated ? new Date(normalizedTradeData.lastUpdated) : null;
              const hoursOld = lastUpdated ? (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60) : 999;
              const isStale = hoursOld > 12;
              
              if (!hasValues && allPlayers.length > 0) {
                return (
                  <div className="rounded-lg border-2 border-red-500 bg-red-50 px-6 py-4 shadow-md">
                    <p className="text-center text-base font-bold text-red-900">
                      ⚠️ Player values not calculated yet!
                    </p>
                    <p className="text-center text-sm text-red-700 mt-2">
                      Click <strong>"🔄 Refresh Teams"</strong> below to sync data from Yahoo and calculate values.
                    </p>
                  </div>
                );
              }
              
              if (isStale) {
                return (
                  <div className="rounded-lg border-2 border-yellow-500 bg-yellow-50 px-6 py-4 shadow-md">
                    <p className="text-center text-base font-bold text-yellow-900">
                      ⚠️ Stats are {Math.round(hoursOld)} hours old
                    </p>
                    <p className="text-center text-sm text-yellow-700 mt-2">
                      Click <strong>"🔄 Refresh Teams"</strong> below to get the latest stats from Yahoo.
                    </p>
                  </div>
                );
              }
              
              return null;
            })()}
            
            {/* AI Suggestions Button */}
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={async () => {
                  setAiLoading(true);
                  try {
                    const response = await fetch(`/api/league/${leagueKey}/ai-suggestions`, { 
                      method: 'POST' 
                    });
                    const data = await response.json();
                    if (data.ok && data.suggestions) {
                      setAiSuggestions(data.suggestions);
                      setShowAiModal(true);
                    } else {
                      alert(data.error || "AI analysis failed");
                    }
                  } catch (error) {
                    console.error("AI error:", error);
                    alert("Failed to get AI suggestions");
                  } finally {
                    setAiLoading(false);
                  }
                }}
                disabled={aiLoading}
                className="rounded-lg px-8 py-3 font-mono text-lg font-bold shadow-lg disabled:opacity-50 theme-btn-ai"
                style={{
                  background: 'linear-gradient(to right, var(--accent-secondary), var(--accent-primary))',
                  color: 'white'
                }}
              >
                {aiLoading ? "🤖 ANALYZING..." : "🤖 GET AI TRADE SUGGESTIONS"}
              </button>
              
              {aiSuggestions.length > 0 && !aiLoading && (
                <button
                  onClick={() => setShowAiModal(true)}
                  className="rounded-lg px-6 py-3 font-mono text-sm font-bold shadow-lg theme-btn-secondary"
                  style={{
                    backgroundColor: 'var(--accent-primary)',
                    color: 'white'
                  }}
                >
                  📋 VIEW LAST SUGGESTIONS ({aiSuggestions.length})
                </button>
              )}
              
              <button
                onClick={async () => {
                  try {
                    const response = await fetch(`/api/league/${leagueKey}/saved-trades`);
                    const data = await response.json();
                    if (data.ok) {
                      setSavedTrades(data.trades);
                      setShowSavedTradesModal(true);
                    } else {
                      alert("Failed to load saved trades: " + data.error);
                    }
                  } catch (error) {
                    console.error("Error loading saved trades:", error);
                    alert("Failed to load saved trades");
                  }
                }}
                className="rounded-lg px-6 py-3 font-mono text-sm font-bold shadow-lg theme-btn-primary"
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: 'white'
                }}
              >
                💾 VIEW SAVED TRADES
              </button>
              
              <button
                onClick={async () => {
                  setRefreshLoading(true);
                  try {
                    const response = await fetch(`/api/league/${leagueKey}/force-sync`, { method: 'POST' });
                    const data = await response.json();
                    if (data.ok) {
                      alert("✅ " + data.message + "\n\nPage will reload now.");
                      window.location.reload();
                    } else {
                      alert("❌ Refresh failed: " + data.error);
                      setRefreshLoading(false);
                    }
                  } catch (error) {
                    console.error("Refresh failed:", error);
                    alert("❌ Refresh failed. Check console for details.");
                    setRefreshLoading(false);
                  }
                }}
                disabled={refreshLoading}
                className="rounded-lg px-6 py-3 font-mono text-sm font-bold shadow-lg disabled:opacity-50 theme-btn-warning"
                style={{
                  backgroundColor: 'var(--accent-secondary)',
                  color: 'white'
                }}
              >
                {refreshLoading ? "⏳ SYNCING..." : "🔄 REFRESH TEAMS"}
              </button>
            </div>
            
            {/* AI Loading Overlay - Fixed position, doesn't affect layout */}
            {aiLoading && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70">
                <div className="max-w-md rounded-lg border-4 border-red-600 bg-yellow-300 p-8 shadow-2xl">
                  <div className="mb-4 flex items-center justify-center">
                    <div className="animate-pulse">
                      <img 
                        src="/TheATHFgang.png" 
                        alt="ATHF Gang" 
                        className="h-32 w-auto object-contain"
                        style={{ imageRendering: "pixelated" }}
                      />
                    </div>
                  </div>
                  <p className="text-center font-mono text-lg font-bold text-red-700 animate-pulse">
                    ANALYZING TRADES...
                  </p>
                  <p className="mt-2 text-center font-mono text-xs text-red-600">
                    Scanning {normalizedTradeData.teams.reduce((sum, t) => sum + t.roster.length, 0)} players • 10-15 seconds
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <div className="h-3 w-3 animate-ping rounded-full bg-red-600"></div>
                    <div className="h-3 w-3 animate-ping rounded-full bg-orange-600" style={{ animationDelay: "300ms" }}></div>
                    <div className="h-3 w-3 animate-ping rounded-full bg-red-600" style={{ animationDelay: "600ms" }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mb-6 rounded-lg border-2 border-yellow-500 bg-yellow-50 px-6 py-4 shadow-md">
            <p className="text-center text-sm text-yellow-900">
              ⚠️ Your team hasn't been identified yet. 
              <button
                onClick={async () => {
                  setRefreshLoading(true);
                  try {
                    const response = await fetch(`/api/league/${leagueKey}/force-sync`, { method: 'POST' });
                    const data = await response.json();
                    if (data.ok) {
                      alert("✅ " + data.message + "\n\nPage will reload now.");
                      window.location.reload();
                    } else {
                      alert("❌ Refresh failed: " + data.error);
                      setRefreshLoading(false);
                    }
                  } catch (error) {
                    console.error("Refresh failed:", error);
                    alert("❌ Refresh failed. Check console for details.");
                    setRefreshLoading(false);
                  }
                }}
                disabled={refreshLoading}
                className="ml-2 rounded bg-yellow-600 px-3 py-1 text-xs font-semibold text-white hover:bg-yellow-700 disabled:opacity-50"
              >
                {refreshLoading ? "⏳ Syncing..." : "🔄 Refresh Teams"}
              </button>
            </p>
          </div>
        )}

        {/* Team Selectors */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">Team A</label>
            <select
              value={sideA.teamId || ""}
              onChange={(e) =>
                setSideA({ teamId: e.target.value || null, playerIds: [], picks: [] })
              }
              className="w-full rounded border border-gray-300 theme-bg-primary px-4 py-2"
            >
              <option value="">Select Team A</option>
              {normalizedTradeData.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} {team.managerName && `(${team.managerName})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-gray-700">Team B</label>
            <select
              value={sideB.teamId || ""}
              onChange={(e) =>
                setSideB({ teamId: e.target.value || null, playerIds: [], picks: [] })
              }
              className="w-full rounded border border-gray-300 theme-bg-primary px-4 py-2"
            >
              <option value="">Select Team B</option>
              {normalizedTradeData.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name} {team.managerName && `(${team.managerName})`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Roster Tables */}
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Team A */}
          <div className="theme-bg-primary">
            <div className="border-b border-gray-300 theme-bg-secondary px-4 py-3">
              <h2 className="text-lg font-semibold theme-text-primary">
                Team A {teamA && `- ${teamA.name}`}
              </h2>
            </div>
            {teamA ? (
              <>
                {/* Keeper Summary */}
                <div className="px-4 py-3">
                  <KeeperSummary team={teamA} draftPickValues={normalizedTradeData.draftPickValues} />
                </div>
                
                {/* Skaters Section */}
                {teamA.roster.some((p) => p.position !== "G") && (
                  <>
                    <div className="theme-bg-secondary px-4 py-2 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700">Skaters</h3>
                    </div>
                    {/* Top Scrollbar for Skaters */}
                    <div 
                      ref={topScrollRefA}
                      className="overflow-x-auto border-b border-gray-200" 
                      style={{ maxWidth: '100%', overflowX: 'scroll', overflowY: 'hidden' }}
                      onScroll={handleTopScrollA}
                    >
                      <div style={{ width: '900px', height: '1px' }}></div>
                    </div>
                    {/* Skaters Table */}
                    <div 
                      ref={tableScrollRefA}
                      className="overflow-x-auto" 
                      style={{ maxWidth: '100%', overflowX: 'scroll' }}
                      onScroll={handleTableScrollA}
                    >
                      <table className="w-full text-xs" style={{ minWidth: '900px' }}>
                  <thead className="theme-bg-secondary">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-gray-700">Add</th>
                            <SortableHeader label="Value" statKey="value" team="teamA" className="px-3 py-2 text-center font-semibold text-blue-700 bg-blue-100" />
                            <SortableHeader label="Player" statKey="name" team="teamA" className="px-2 py-2 text-left font-semibold text-gray-700" />
                      <th className="px-2 py-2 text-left font-semibold text-gray-700">Pos</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-700">Team</th>
                            <SortableHeader label="G" statKey="goals" team="teamA" className="px-2 py-2 text-center font-semibold text-green-700" />
                            <SortableHeader label="A" statKey="assists" team="teamA" className="px-2 py-2 text-center font-semibold text-blue-700" />
                            <SortableHeader label="P" statKey="points" team="teamA" className="px-2 py-2 text-center font-semibold text-purple-700" />
                            <SortableHeader label="+/-" statKey="plus/minus" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="PIM" statKey="penalty minutes" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="PPP" statKey="power play points" team="teamA" className="px-2 py-2 text-center font-semibold text-orange-700" />
                            <SortableHeader label="SHP" statKey="short handed points" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="GWG" statKey="game winning goals" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="SOG" statKey="shots on goal" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="FW" statKey="faceoffs won" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="HIT" statKey="hits" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="BLK" statKey="blocked shots" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                          </tr>
                        </thead>
                        <tbody>
                          {sortPlayers(teamA.roster.filter((p) => p.position !== "G"), sortConfig.teamA).map((player, index) => {
                            const isPending = pendingSelections.A.includes(player.playerId);
                            const isConfirmed = sideA.playerIds.includes(player.playerId);
                            return renderPlayerRow(player, "A", isPending, isConfirmed, false, index);
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                
                {/* Goalies Section */}
                {teamA.roster.some((p) => p.position === "G") && (
                  <>
                    <div className="theme-bg-secondary px-4 py-2 border-b border-gray-200 border-t border-gray-300 mt-4">
                      <h3 className="text-sm font-semibold text-gray-700">Goalies</h3>
                    </div>
                    {/* Goalies Table */}
                    <div className="overflow-x-auto" style={{ maxWidth: '100%', overflowX: 'scroll' }}>
                      <table className="w-full text-xs" style={{ minWidth: '600px' }}>
                        <thead className="theme-bg-secondary">
                          <tr>
                            <th className="px-2 py-2 text-left font-semibold text-gray-700">Add</th>
                            <SortableHeader label="Value" statKey="value" team="teamA" className="px-3 py-2 text-center font-semibold text-blue-700 bg-blue-100" />
                            <SortableHeader label="Player" statKey="name" team="teamA" className="px-2 py-2 text-left font-semibold text-gray-700" />
                            <th className="px-2 py-2 text-left font-semibold text-gray-700">Pos</th>
                            <th className="px-2 py-2 text-left font-semibold text-gray-700">Team</th>
                            <SortableHeader label="W" statKey="wins" team="teamA" className="px-2 py-2 text-center font-semibold text-green-700" />
                            <SortableHeader label="L" statKey="losses" team="teamA" className="px-2 py-2 text-center font-semibold text-red-700" />
                            <SortableHeader label="GA" statKey="goals against" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="GAA" statKey="goals against average" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="SV" statKey="saves" team="teamA" className="px-2 py-2 text-center font-semibold text-blue-700" />
                            <SortableHeader label="SV%" statKey="save percentage" team="teamA" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="SHO" statKey="shutouts" team="teamA" className="px-2 py-2 text-center font-semibold text-purple-700" />
                    </tr>
                  </thead>
                  <tbody>
                          {sortPlayers(teamA.roster.filter((p) => p.position === "G"), sortConfig.teamA).map((player, index) => {
                      const isPending = pendingSelections.A.includes(player.playerId);
                      const isConfirmed = sideA.playerIds.includes(player.playerId);
                            return renderPlayerRow(player, "A", isPending, isConfirmed, true, index);
                    })}
                  </tbody>
                </table>
                    </div>
                  </>
                )}
                
                {pendingSelections.A.length > 0 && (
                  <div className="border-t border-gray-300 theme-bg-secondary px-4 py-3">
                    <button
                      onClick={() => confirmPlayers("A")}
                      className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Add {pendingSelections.A.length} Player{pendingSelections.A.length !== 1 ? "s" : ""} to Trade
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="p-4 theme-text-secondary">Select Team A to view roster</div>
            )}

            {/* Draft Picks for Team A */}
            {teamA && normalizedTradeData.draftPickValues.length > 0 && (
              <div className="border-t border-gray-300 theme-bg-secondary px-4 py-3">
                <h3 className="mb-2 text-sm font-semibold text-gray-700">
                  Draft Picks {teamA?.draftPicks && teamA.draftPicks.length > 0 && `(${teamA.draftPicks.length} owned)`}
                </h3>
                <div className="grid grid-cols-8 gap-2">
                  {normalizedTradeData.draftPickValues.map((pick) => {
                    const isSelected = sideA.picks.includes(pick.round);
                    const isOwned = teamA?.draftPicks?.includes(pick.round) ?? false;
                    return (
                      <button
                        key={pick.round}
                        onClick={() => togglePick("A", pick.round)}
                        className={`rounded border px-2 py-1.5 text-xs font-mono whitespace-nowrap ${
                          isSelected
                            ? "border-blue-500 bg-blue-100 text-blue-700 font-semibold"
                            : isOwned
                            ? "border-green-500 bg-green-50 text-green-700 hover:bg-green-100"
                            : "border-gray-300 theme-bg-primary theme-text-secondary hover:theme-bg-secondary"
                        }`}
                        title={isOwned ? `Round ${pick.round} (Owned)` : `Round ${pick.round} (Not owned)`}
                      >
                        <div className="flex flex-col items-center leading-tight">
                          <span className="text-[10px] font-bold">R{pick.round}</span>
                          <span className="text-[9px]">{pick.score.toFixed(0)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Team B */}
          <div className="theme-bg-primary">
            <div className="border-b border-gray-300 theme-bg-secondary px-4 py-3">
              <h2 className="text-lg font-semibold theme-text-primary">
                Team B {teamB && `- ${teamB.name}`}
              </h2>
            </div>
            {teamB ? (
              <>
                {/* Keeper Summary */}
                <div className="px-4 py-3">
                  <KeeperSummary team={teamB} draftPickValues={normalizedTradeData.draftPickValues} />
                </div>
                
                {/* Skaters Section */}
                {teamB.roster.some((p) => p.position !== "G") && (
                  <>
                    <div className="theme-bg-secondary px-4 py-2 border-b border-gray-200">
                      <h3 className="text-sm font-semibold text-gray-700">Skaters</h3>
                    </div>
                    {/* Top Scrollbar for Skaters */}
                    <div 
                      ref={topScrollRefB}
                      className="overflow-x-auto border-b border-gray-200" 
                      style={{ maxWidth: '100%', overflowX: 'scroll', overflowY: 'hidden' }}
                      onScroll={handleTopScrollB}
                    >
                      <div style={{ width: '900px', height: '1px' }}></div>
                    </div>
                    {/* Skaters Table */}
                    <div 
                      ref={tableScrollRefB}
                      className="overflow-x-auto" 
                      style={{ maxWidth: '100%', overflowX: 'scroll' }}
                      onScroll={handleTableScrollB}
                    >
                      <table className="w-full text-xs" style={{ minWidth: '900px' }}>
                  <thead className="theme-bg-secondary">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold text-gray-700">Add</th>
                            <SortableHeader label="Value" statKey="value" team="teamB" className="px-3 py-2 text-center font-semibold text-blue-700 bg-blue-100" />
                            <SortableHeader label="Player" statKey="name" team="teamB" className="px-2 py-2 text-left font-semibold text-gray-700" />
                      <th className="px-2 py-2 text-left font-semibold text-gray-700">Pos</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-700">Team</th>
                            <SortableHeader label="G" statKey="goals" team="teamB" className="px-2 py-2 text-center font-semibold text-green-700" />
                            <SortableHeader label="A" statKey="assists" team="teamB" className="px-2 py-2 text-center font-semibold text-blue-700" />
                            <SortableHeader label="P" statKey="points" team="teamB" className="px-2 py-2 text-center font-semibold text-purple-700" />
                            <SortableHeader label="+/-" statKey="plus/minus" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="PIM" statKey="penalty minutes" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="PPP" statKey="power play points" team="teamB" className="px-2 py-2 text-center font-semibold text-orange-700" />
                            <SortableHeader label="SHP" statKey="short handed points" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="GWG" statKey="game winning goals" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="SOG" statKey="shots on goal" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="FW" statKey="faceoffs won" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="HIT" statKey="hits" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="BLK" statKey="blocked shots" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                          </tr>
                        </thead>
                        <tbody>
                          {sortPlayers(teamB.roster.filter((p) => p.position !== "G"), sortConfig.teamB).map((player, index) => {
                            const isPending = pendingSelections.B.includes(player.playerId);
                            const isConfirmed = sideB.playerIds.includes(player.playerId);
                            return renderPlayerRow(player, "B", isPending, isConfirmed, false, index);
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                
                {/* Goalies Section */}
                {teamB.roster.some((p) => p.position === "G") && (
                  <>
                    <div className="theme-bg-secondary px-4 py-2 border-b border-gray-200 border-t border-gray-300 mt-4">
                      <h3 className="text-sm font-semibold text-gray-700">Goalies</h3>
                    </div>
                    {/* Goalies Table */}
                    <div className="overflow-x-auto" style={{ maxWidth: '100%', overflowX: 'scroll' }}>
                      <table className="w-full text-xs" style={{ minWidth: '600px' }}>
                        <thead className="theme-bg-secondary">
                          <tr>
                            <th className="px-2 py-2 text-left font-semibold text-gray-700">Add</th>
                            <SortableHeader label="Value" statKey="value" team="teamB" className="px-3 py-2 text-center font-semibold text-blue-700 bg-blue-100" />
                            <SortableHeader label="Player" statKey="name" team="teamB" className="px-2 py-2 text-left font-semibold text-gray-700" />
                            <th className="px-2 py-2 text-left font-semibold text-gray-700">Pos</th>
                            <th className="px-2 py-2 text-left font-semibold text-gray-700">Team</th>
                            <SortableHeader label="W" statKey="wins" team="teamB" className="px-2 py-2 text-center font-semibold text-green-700" />
                            <SortableHeader label="L" statKey="losses" team="teamB" className="px-2 py-2 text-center font-semibold text-red-700" />
                            <SortableHeader label="GA" statKey="goals against" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="GAA" statKey="goals against average" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="SV" statKey="saves" team="teamB" className="px-2 py-2 text-center font-semibold text-blue-700" />
                            <SortableHeader label="SV%" statKey="save percentage" team="teamB" className="px-2 py-2 text-center font-semibold text-gray-700" />
                            <SortableHeader label="SHO" statKey="shutouts" team="teamB" className="px-2 py-2 text-center font-semibold text-purple-700" />
                    </tr>
                  </thead>
                  <tbody>
                          {sortPlayers(teamB.roster.filter((p) => p.position === "G"), sortConfig.teamB).map((player, index) => {
                      const isPending = pendingSelections.B.includes(player.playerId);
                      const isConfirmed = sideB.playerIds.includes(player.playerId);
                            return renderPlayerRow(player, "B", isPending, isConfirmed, true, index);
                    })}
                  </tbody>
                </table>
                    </div>
                  </>
                )}
                
                {pendingSelections.B.length > 0 && (
                  <div className="border-t border-gray-300 theme-bg-secondary px-4 py-3">
                    <button
                      onClick={() => confirmPlayers("B")}
                      className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Add {pendingSelections.B.length} Player{pendingSelections.B.length !== 1 ? "s" : ""} to Trade
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="p-4 theme-text-secondary">Select Team B to view roster</div>
            )}

            {/* Draft Picks for Team B */}
            {teamB && normalizedTradeData.draftPickValues.length > 0 && (
              <div className="border-t border-gray-300 theme-bg-secondary px-4 py-3">
                <h3 className="mb-2 text-sm font-semibold text-gray-700">
                  Draft Picks {teamB?.draftPicks && teamB.draftPicks.length > 0 && `(${teamB.draftPicks.length} owned)`}
                </h3>
                <div className="grid grid-cols-8 gap-2">
                  {normalizedTradeData.draftPickValues.map((pick) => {
                    const isSelected = sideB.picks.includes(pick.round);
                    const isOwned = teamB?.draftPicks?.includes(pick.round) ?? false;
                    return (
                      <button
                        key={pick.round}
                        onClick={() => togglePick("B", pick.round)}
                        className={`rounded border px-2 py-1.5 text-xs font-mono whitespace-nowrap ${
                          isSelected
                            ? "border-blue-500 bg-blue-100 text-blue-700 font-semibold"
                            : isOwned
                            ? "border-green-500 bg-green-50 text-green-700 hover:bg-green-100"
                            : "border-gray-300 theme-bg-primary theme-text-secondary hover:theme-bg-secondary"
                        }`}
                        title={isOwned ? `Round ${pick.round} (Owned)` : `Round ${pick.round} (Not owned)`}
                      >
                        <div className="flex flex-col items-center leading-tight">
                          <span className="text-[10px] font-bold">R{pick.round}</span>
                          <span className="text-[9px]">{pick.score.toFixed(0)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>


        {/* Trade Summary */}
        <div className="rounded border border-gray-300 theme-bg-primary p-6">
          <h2 className="mb-4 text-xl font-semibold theme-text-primary">Trade Summary</h2>
          {(() => {
            const teamASendTotal = teamASends.reduce((sum, item) => sum + item.value, 0);
            const teamBSendTotal = teamBSends.reduce((sum, item) => sum + item.value, 0);
            
            return (
              <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-lg font-medium text-gray-700">Team A Sends</h3>
              <div className="space-y-1">
                {teamASends.length === 0 ? (
                  <p className="text-sm text-gray-500">(Nothing selected)</p>
                ) : (
                  teamASends.map((item) => {
                    if (item.type === "player") {
                      const player = teamA?.roster.find((p) => p.playerId === item.id);
                      return (
                        <div key={`player-${item.id}`} className="flex justify-between text-sm">
                          <span className="text-gray-700">
                            {player?.name || "Unknown Player"}
                            {player?.isKeeper && (
                              <span className="ml-1 text-xs text-purple-600 font-bold">K</span>
                            )}
                          </span>
                          <span className="theme-text-secondary">{item.value.toFixed(1)}</span>
                        </div>
                      );
                    } else {
                        return (
                          <div key={`pick-${item.id}`} className="flex justify-between text-sm">
                            <span className="text-gray-700">Round {item.id} Pick</span>
                            <span className="theme-text-secondary">{item.value.toFixed(1)}</span>
                          </div>
                        );
                      }
                  })
                )}
                {teamASends.length > 0 && (
                  <div className="mt-2 border-t border-gray-200 pt-2">
                    <div className="flex justify-between font-semibold">
                      <span className="theme-text-primary">Total</span>
                      <span className="theme-text-primary">
                        {teamASends.reduce((sum, item) => sum + item.value, 0).toFixed(1)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-lg font-medium text-gray-700">Team B Sends</h3>
              <div className="space-y-1">
                {teamBSends.length === 0 ? (
                  <p className="text-sm text-gray-500">(Nothing selected)</p>
                ) : (
                  teamBSends.map((item) => {
                    if (item.type === "player") {
                      const player = teamB?.roster.find((p) => p.playerId === item.id);
                      return (
                        <div key={`player-${item.id}`} className="flex justify-between text-sm">
                          <span className="text-gray-700">
                            {player?.name || "Unknown Player"}
                            {player?.isKeeper && (
                              <span className="ml-1 text-xs text-purple-600 font-bold">K</span>
                            )}
                          </span>
                          <span className="theme-text-secondary">{item.value.toFixed(1)}</span>
                        </div>
                      );
                    } else {
                        return (
                          <div key={`pick-${item.id}`} className="flex justify-between text-sm">
                            <span className="text-gray-700">Round {item.id} Pick</span>
                            <span className="theme-text-secondary">{item.value.toFixed(1)}</span>
                          </div>
                        );
                      }
                  })
                )}
                {teamBSends.length > 0 && (
                  <div className="mt-2 border-t border-gray-200 pt-2">
                    <div className="flex justify-between font-semibold">
                      <span className="theme-text-primary">Total</span>
                      <span className="theme-text-primary">
                        {teamBSends.reduce((sum, item) => sum + item.value, 0).toFixed(1)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Improved Trade Analysis */}
          <div className="mt-6 rounded-lg border-2 border-gray-300 bg-gradient-to-br from-gray-50 to-gray-100 p-6 shadow-md">
            <h3 className="mb-4 text-center text-lg font-bold theme-text-primary">📊 Trade Analysis</h3>
            
            <div className="grid grid-cols-2 gap-6">
              {/* Team A Analysis */}
              <div className="rounded-lg theme-bg-primary p-4 shadow">
                <div className="mb-3 text-center">
                  <h4 className="text-sm font-semibold text-gray-700">{teamA?.name || "Team A"}</h4>
            </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="theme-text-secondary">Gives Away:</span>
                    <span className="font-semibold text-red-600">-{teamASendTotal.toFixed(1)}</span>
            </div>
                  <div className="flex justify-between">
                    <span className="theme-text-secondary">Gets Back:</span>
                    <span className="font-semibold text-green-600">+{teamAReceiveTotal.toFixed(1)}</span>
                  </div>
                  <div className="border-t border-gray-200 pt-2">
                    <div className="flex justify-between">
                      <span className="font-bold theme-text-primary">Net Change:</span>
                      <span className={`font-bold text-lg ${
                        diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : "theme-text-secondary"
                      }`}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Team B Analysis */}
              <div className="rounded-lg theme-bg-primary p-4 shadow">
                <div className="mb-3 text-center">
                  <h4 className="text-sm font-semibold text-gray-700">{teamB?.name || "Team B"}</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="theme-text-secondary">Gives Away:</span>
                    <span className="font-semibold text-red-600">-{teamBSendTotal.toFixed(1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="theme-text-secondary">Gets Back:</span>
                    <span className="font-semibold text-green-600">+{teamASendTotal.toFixed(1)}</span>
                  </div>
                  <div className="border-t border-gray-200 pt-2">
                    <div className="flex justify-between">
                      <span className="font-bold theme-text-primary">Net Change:</span>
                      <span className={`font-bold text-lg ${
                        diff < 0 ? "text-green-600" : diff > 0 ? "text-red-600" : "theme-text-secondary"
                      }`}>
                        {diff < 0 ? "+" : ""}{(-diff).toFixed(1)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Overall Trade Verdict */}
            <div className="mt-4 rounded-lg border-2 p-3 text-center" style={{
              borderColor: diff === 0 ? "#22c55e" : Math.abs(diff) < 5 ? "#eab308" : "#ef4444",
              backgroundColor: diff === 0 ? "#f0fdf4" : Math.abs(diff) < 5 ? "#fef9c3" : "#fef2f2"
            }}>
              {diff === 0 ? (
                <p className="font-bold text-green-700">✅ EVEN TRADE</p>
              ) : Math.abs(diff) < 5 ? (
                <p className="font-bold text-yellow-700">⚖️ RELATIVELY FAIR ({Math.abs(diff).toFixed(1)} point difference)</p>
              ) : diff > 0 ? (
                <p className="font-bold text-red-700">⚠️ {teamA?.name || "Team A"} wins by {diff.toFixed(1)} points</p>
              ) : (
                <p className="font-bold text-red-700">⚠️ {teamB?.name || "Team B"} wins by {Math.abs(diff).toFixed(1)} points</p>
              )}
              
              {/* Keeper impact notice */}
              {(() => {
                const hasKeepers = [...teamASends, ...teamBSends].some(item => {
                  if (item.type === "player") {
                    const playerA = teamA?.roster.find(p => p.playerId === item.id);
                    const playerB = teamB?.roster.find(p => p.playerId === item.id);
                    return playerA?.isKeeper || playerB?.isKeeper;
                  }
                  return false;
                });
                
                if (hasKeepers) {
                  return (
                    <p className="mt-2 text-xs text-purple-700 font-semibold">
                      🔒 Keeper-adjusted values included (surplus × years remaining)
                    </p>
                  );
                }
                return null;
              })()}
            </div>
            
            {/* Save Trade Button */}
            {(teamASends.length > 0 || teamBSends.length > 0) && (
              <div className="mt-8 border-t-2 border-gray-300 pt-6 text-center">
                <button
                  onClick={async () => {
                    const tradeName = prompt("Give this trade a name (optional):");
                    try {
                      const response = await fetch(`/api/league/${leagueKey}/save-trade`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          tradeName,
                          teamAId: sideA.teamId,
                          teamBId: sideB.teamId,
                          teamAPlayers: sideA.playerIds,
                          teamBPlayers: sideB.playerIds,
                          teamAPicks: sideA.picks,
                          teamBPicks: sideB.picks,
                          teamAValue: teamASends.reduce((sum, item) => sum + item.value, 0),
                          teamBValue: teamBSends.reduce((sum, item) => sum + item.value, 0),
                          netDiff: diff,
                        }),
                      });
                      const data = await response.json();
                      if (data.ok) {
                        alert("✅ Trade saved successfully!");
                      } else {
                        alert("Failed to save: " + data.error);
                      }
                    } catch (error) {
                      console.error("Save error:", error);
                      alert("Failed to save trade");
                    }
                  }}
                  className="rounded-lg bg-gradient-to-r from-green-600 to-blue-600 px-8 py-4 font-mono text-lg font-bold text-white shadow-lg hover:from-green-700 hover:to-blue-700"
                >
                  💾 SAVE THIS TRADE
                </button>
              </div>
            )}
          </div>
              </>
            );
          })()}
        </div>
      </div>
      
      {/* AI Suggestions Modal */}
      <AISuggestionsModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        suggestions={aiSuggestions}
        myTeamName={normalizedTradeData.myTeamName || "Your Team"}
        onPreviewTrade={(suggestion) => {
          console.log("[Preview] Looking for team:", suggestion.tradeWithTeam);
          
          // Find teams by name (try exact match or contains match)
          const targetTeam = normalizedTradeData.teams.find(t => 
            t.name === suggestion.tradeWithTeam || 
            t.name.includes(suggestion.tradeWithTeam.split("(")[0].trim())
          );
          const myTeam = normalizedTradeData.teams.find(t => t.isOwner);
          
          console.log("[Preview] Found target team:", targetTeam?.name);
          console.log("[Preview] Found my team:", myTeam?.name);
          
          if (!targetTeam || !myTeam) {
            alert("Could not find teams for preview");
            return;
          }
          
          const myPlayerIds: string[] = [];
          const theirPlayerIds: string[] = [];
          const myPicks: number[] = [];
          const theirPicks: number[] = [];
          
          suggestion.youGive.forEach(item => {
            if (item.type === "player") {
              const player = myTeam.roster.find(p => p.name === item.name);
              console.log("[Preview] Looking for your player:", item.name, "Found:", player?.name);
              if (player) myPlayerIds.push(player.playerId);
            } else {
              theirPicks.push(parseInt(item.name));
            }
          });
          
          suggestion.youGet.forEach(item => {
            if (item.type === "player") {
              const player = targetTeam.roster.find(p => p.name === item.name);
              console.log("[Preview] Looking for their player:", item.name, "Found:", player?.name);
              if (player) theirPlayerIds.push(player.playerId);
            } else {
              myPicks.push(parseInt(item.name));
            }
          });
          
          console.log("[Preview] Setting trade:", { myPlayerIds, theirPlayerIds, myPicks, theirPicks });
          
          // Set teams and players
          setSideA({ teamId: myTeam.id, playerIds: myPlayerIds, picks: myPicks });
          setSideB({ teamId: targetTeam.id, playerIds: theirPlayerIds, picks: theirPicks });
        }}
      />
      
      {/* Saved Trades Modal */}
      <SavedTradesModal
        isOpen={showSavedTradesModal}
        onClose={() => setShowSavedTradesModal(false)}
        trades={savedTrades}
        onLoadTrade={(trade) => {
          // Find teams by name
          const teamA = normalizedTradeData.teams.find(t => t.name === trade.teamAName);
          const teamB = normalizedTradeData.teams.find(t => t.name === trade.teamBName);
          
          if (!teamA || !teamB) {
            alert("Could not find teams for this saved trade");
            return;
          }
          
          // Set the trade sides
          setSideA({
            teamId: teamA.id,
            playerIds: trade.teamAPlayers,
            picks: trade.teamAPicks,
          });
          setSideB({
            teamId: teamB.id,
            playerIds: trade.teamBPlayers,
            picks: trade.teamBPicks,
          });
          
          // Close modal and scroll to top
          setShowSavedTradesModal(false);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onDeleteTrade={async (tradeId) => {
          try {
            const response = await fetch(`/api/league/${leagueKey}/saved-trades?id=${tradeId}`, {
              method: 'DELETE',
            });
            const data = await response.json();
            if (data.ok) {
              // Remove from local state
              setSavedTrades(savedTrades.filter(t => t.id !== tradeId));
              alert("✅ Trade deleted!");
            } else {
              alert("Failed to delete: " + data.error);
            }
          } catch (error) {
            console.error("Delete error:", error);
            alert("Failed to delete trade");
          }
        }}
      />
      
      {/* Easter Egg: Shakezulla Player */}
      <ShakezullaPlayer />
    </div>
    </ThemeProvider>
  );
}
