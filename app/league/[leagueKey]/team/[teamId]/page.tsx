"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { TeamDashboard, CategorySummary } from "@/lib/dashboard/types";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import { ThemeSwitcher } from "@/app/components/ThemeSwitcher";
import { SignOutButton } from "@/app/components/SignOutButton";
import { toFixedSafe } from "@/lib/utils/numberFormat";

export default function TeamDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const leagueKey = params.leagueKey as string;
  const teamId = params.teamId as string;

  const [dashboard, setDashboard] = useState<TeamDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const response = await fetch(`/api/league/${leagueKey}/team/${teamId}`);
        const result = await response.json();

        if (!result.ok) {
          setError(result.error || "Failed to load dashboard");
          return;
        }

        setDashboard(result.dashboard);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
  }, [leagueKey, teamId]);

  // Helper to get background color for category strength
  const getCategoryBgColor = (strength: CategorySummary["strength"]): string => {
    switch (strength) {
      case "elite": return "bg-emerald-600 text-white";
      case "strong": return "bg-emerald-100 text-emerald-800";
      case "neutral": return "bg-slate-100 text-slate-900";
      case "weak": return "bg-rose-100 text-rose-800";
      case "critical": return "bg-rose-600 text-white";
    }
  };

  // Helper to get grade color
  const getGradeColor = (letter: string): string => {
    if (letter === "A") return "bg-emerald-600 text-white";
    if (letter === "B") return "bg-emerald-400 text-white";
    if (letter === "C") return "bg-slate-400 text-white";
    if (letter === "D") return "bg-rose-400 text-white";
    return "bg-rose-600 text-white";
  };

  // Helper to get value tier color
  const getValueColor = (value: number): string => {
    if (value >= 160) return "bg-purple-100 dark:bg-purple-900/30 text-purple-900 dark:text-purple-200";
    if (value >= 140) return "bg-blue-100 dark:bg-blue-900/30 text-blue-900 dark:text-blue-200";
    if (value >= 120) return "bg-green-100 dark:bg-green-900/30 text-green-900 dark:text-green-200";
    if (value >= 100) return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-900 dark:text-yellow-200";
    return "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100";
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center theme-bg-secondary">
        <div className="text-center">
          <div className="mb-4 text-2xl font-bold theme-text-primary">Loading Dashboard...</div>
          <div className="animate-pulse theme-text-secondary">Analyzing team performance</div>
        </div>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="min-h-screen theme-bg-secondary">
        <div className="container mx-auto px-4 py-8">
          <div className="rounded-lg border border-red-200 bg-red-50 p-6">
            <p className="text-red-600">{error || "Failed to load dashboard"}</p>
            <Link href={`/league/${leagueKey}`} className="mt-4 inline-block text-blue-600 hover:underline">
              ← Back to League
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <div className="min-h-screen theme-bg-secondary">
        <div className="container mx-auto px-4 py-8">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold theme-text-primary">{dashboard.teamName}</h1>
              {dashboard.ownerName && (
                <p className="text-sm theme-text-secondary">Manager: {dashboard.ownerName}</p>
              )}
            </div>
            <div className="flex items-center gap-4">
              <ThemeSwitcher />
              <SignOutButton />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mb-6 flex gap-3">
            <Link
              href={`/league/${leagueKey}/trade`}
              className="rounded-lg bg-blue-600 px-6 py-3 font-bold text-white hover:bg-blue-700"
            >
              📊 Open Trade Builder
            </Link>
            <Link
              href={`/league/${leagueKey}`}
              className="rounded-lg bg-gray-600 px-6 py-3 font-bold text-white hover:bg-gray-700"
            >
              ← Back to League
            </Link>
          </div>

          {/* Narrative Summary */}
          <div className="mb-6 rounded-lg border border-gray-300 theme-bg-primary p-6">
            <h2 className="mb-3 text-xl font-semibold theme-text-primary">Team Summary</h2>
            <p className="mb-4 theme-text-secondary">{dashboard.narrative.summary}</p>
            
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 font-semibold text-green-700 dark:text-green-400">✅ Strengths</h3>
                <ul className="list-inside list-disc space-y-1 text-sm theme-text-secondary">
                  {dashboard.narrative.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 font-semibold text-red-700 dark:text-red-400">⚠️ Weaknesses</h3>
                <ul className="list-inside list-disc space-y-1 text-sm theme-text-secondary">
                  {dashboard.narrative.weaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Grade Cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
            {Object.entries(dashboard.grades).map(([key, grade]) => (
              <div
                key={key}
                className="rounded-lg border border-gray-300 theme-bg-primary p-4 text-center"
              >
                <div className="mb-2 text-sm font-semibold uppercase theme-text-secondary">
                  {key}
                </div>
                <div className={`mb-2 inline-block rounded-full px-4 py-2 text-3xl font-bold ${getGradeColor(grade.letter)}`}>
                  {grade.letter}
                </div>
                <div className="text-xs theme-text-secondary">{grade.reason}</div>
              </div>
            ))}
          </div>

          {/* Category Heatmap */}
          <div className="mb-6 rounded-lg border border-gray-300 theme-bg-primary p-6">
            <h2 className="mb-4 text-xl font-semibold theme-text-primary">Category Performance</h2>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="px-4 py-2 text-left text-sm font-semibold theme-text-primary">Category</th>
                    <th className="px-4 py-2 text-right text-sm font-semibold theme-text-primary">Value</th>
                    <th className="px-4 py-2 text-right text-sm font-semibold theme-text-primary">Rank</th>
                    <th className="px-4 py-2 text-right text-sm font-semibold theme-text-primary">Z-Score</th>
                    <th className="px-4 py-2 text-center text-sm font-semibold theme-text-primary">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(dashboard.categorySummary).map(([code, cat]) => (
                    <tr key={code} className={`border-b border-gray-200 ${getCategoryBgColor(cat.strength)}`}>
                      <td className="px-4 py-3 font-medium">{cat.label}</td>
                      <td className="px-4 py-3 text-right">{toFixedSafe(cat.value, code === "GAA" || code === "SVPCT" ? 2 : 0)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{cat.rank} / {cat.teams}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {cat.zScore > 0 ? "+" : ""}{toFixedSafe(cat.zScore, 2)}
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-bold uppercase">
                        {cat.rank <= 2 ? "🔥 Top Tier" :
                         cat.rank <= 4 ? "💪 Strong" :
                         cat.rank >= cat.teams - 1 ? "⚠️ Bottom Tier" :
                         cat.rank >= cat.teams - 3 ? "❌ Weak" :
                         "➖ Middle"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Skaters Table */}
          <div className="mb-6 rounded-lg border border-gray-300 theme-bg-primary p-6">
            <h2 className="mb-4 text-xl font-semibold theme-text-primary">Skaters</h2>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-300">
                    <th className="px-2 py-2 text-left font-semibold theme-text-primary">Player</th>
                    <th className="px-2 py-2 text-left font-semibold theme-text-primary">Pos</th>
                    <th className="px-2 py-2 text-left font-semibold theme-text-primary">NHL</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">G</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">A</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">P</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">PPP</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">SOG</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">+/-</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">PIM</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">HIT</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">BLK</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">FOW</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">Value</th>
                    <th className="px-2 py-2 text-center font-semibold theme-text-primary">Keeper</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.skaters.map((player, idx) => (
                    <tr key={player.id} className={idx % 2 === 0 ? "theme-bg-primary" : "theme-bg-secondary"}>
                      <td className="px-2 py-2 font-medium">
                        <div className="flex items-center gap-2">
                          <span>{player.name}</span>
                          {player.status && (player.status === "IR" || player.status === "IR+") && (
                            <span className="inline-block px-1.5 py-0.5 text-xs font-bold text-white bg-red-600 rounded">
                              {player.status}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs theme-text-secondary">{player.pos}</td>
                      <td className="px-2 py-2 text-xs theme-text-secondary">{player.nhlTeam}</td>
                      <td className="px-2 py-2 text-center theme-text-primary">{player.stats.G}</td>
                      <td className="px-2 py-2 text-center theme-text-primary">{player.stats.A}</td>
                      <td className="px-2 py-2 text-center font-semibold theme-text-primary">{player.stats.P}</td>
                      <td className="px-2 py-2 text-center theme-text-primary">{player.stats.PPP}</td>
                      <td className="px-2 py-2 text-center theme-text-primary">{player.stats.SOG}</td>
                      <td className="px-2 py-2 text-center theme-text-primary">{player.stats.plusMinus}</td>
                      <td className="px-2 py-2 text-center theme-text-primary">{player.stats.PIM}</td>
                      <td className="px-2 py-2 text-center theme-text-primary">{player.stats.HIT}</td>
                      <td className="px-2 py-2 text-center theme-text-primary">{player.stats.BLK}</td>
                      <td className="px-2 py-2 text-center theme-text-primary">{player.stats.FOW}</td>
                      <td className={`px-2 py-2 text-center font-bold ${getValueColor(player.keeper?.totalValue ?? player.value)}`}>
                        {toFixedSafe(player.value, 1)}
                        {player.keeper && player.keeper.bonus > 0 && (
                          <div className="text-xs text-purple-600 dark:text-purple-400">+{toFixedSafe(player.keeper.bonus, 0)}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center text-xs">
                        {player.keeper ? (
                          <div className={`inline-block rounded px-2 py-1 font-semibold ${
                            player.keeper.yearsRemaining === 0 ? "bg-orange-600 text-white" :
                            player.keeper.bonus > 10 ? "bg-purple-600 text-white" :
                            "bg-purple-400 text-white"
                          }`}>
                            R{player.keeper.round} • {player.keeper.yearsRemaining}yr
                          </div>
                        ) : (
                          <span className="text-gray-400">FA</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Goalies Table */}
          {dashboard.goalies.length > 0 && (
            <div className="mb-6 rounded-lg border border-gray-300 theme-bg-primary p-6">
              <h2 className="mb-4 text-xl font-semibold theme-text-primary">Goalies</h2>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-300">
                      <th className="px-2 py-2 text-left font-semibold theme-text-primary">Player</th>
                      <th className="px-2 py-2 text-left font-semibold theme-text-primary">NHL</th>
                      <th className="px-2 py-2 text-center font-semibold theme-text-primary">W</th>
                      <th className="px-2 py-2 text-center font-semibold theme-text-primary">L</th>
                      <th className="px-2 py-2 text-center font-semibold theme-text-primary">GAA</th>
                      <th className="px-2 py-2 text-center font-semibold theme-text-primary">SV</th>
                      <th className="px-2 py-2 text-center font-semibold theme-text-primary">SV%</th>
                      <th className="px-2 py-2 text-center font-semibold theme-text-primary">SHO</th>
                      <th className="px-2 py-2 text-center font-semibold theme-text-primary">Value</th>
                      <th className="px-2 py-2 text-center font-semibold theme-text-primary">Keeper</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.goalies.map((goalie, idx) => (
                      <tr key={goalie.id} className={idx % 2 === 0 ? "theme-bg-primary" : "theme-bg-secondary"}>
                        <td className="px-2 py-2 font-medium">
                          <div className="flex items-center gap-2">
                            <span>{goalie.name}</span>
                            {goalie.status && (goalie.status === "IR" || goalie.status === "IR+") && (
                              <span className="inline-block px-1.5 py-0.5 text-xs font-bold text-white bg-red-600 rounded">
                                {goalie.status}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs theme-text-secondary">{goalie.nhlTeam}</td>
                        <td className="px-2 py-2 text-center theme-text-primary">{goalie.stats.W}</td>
                        <td className="px-2 py-2 text-center theme-text-primary">{goalie.stats.L}</td>
                        <td className="px-2 py-2 text-center theme-text-primary">{toFixedSafe(goalie.stats.GAA, 2)}</td>
                        <td className="px-2 py-2 text-center theme-text-primary">{goalie.stats.SV}</td>
                        <td className="px-2 py-2 text-center theme-text-primary">{toFixedSafe(goalie.stats.SVPCT, 3)}</td>
                        <td className="px-2 py-2 text-center theme-text-primary">{goalie.stats.SHO}</td>
                        <td className={`px-2 py-2 text-center font-bold ${getValueColor(goalie.keeper?.totalValue ?? goalie.value)}`}>
                          {toFixedSafe(goalie.value, 1)}
                          {goalie.keeper && goalie.keeper.bonus > 0 && (
                            <div className="text-xs text-purple-600 dark:text-purple-400">+{toFixedSafe(goalie.keeper.bonus, 0)}</div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center text-xs">
                          {goalie.keeper ? (
                            <div className={`inline-block rounded px-2 py-1 font-semibold ${
                              goalie.keeper.yearsRemaining === 0 ? "bg-orange-600 text-white" :
                              goalie.keeper.bonus > 10 ? "bg-purple-600 text-white" :
                              "bg-purple-400 text-white"
                            }`}>
                              R{goalie.keeper.round} • {goalie.keeper.yearsRemaining}yr
                            </div>
                          ) : (
                            <span className="text-gray-400">FA</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Trade Guidance */}
          <div className="mb-6 rounded-lg border border-gray-300 theme-bg-primary p-6">
            <h2 className="mb-4 text-xl font-semibold theme-text-primary">💡 Trade Guidance</h2>
            
            <div className="space-y-4">
              <div>
                <h3 className="mb-2 font-semibold text-green-700 dark:text-green-400">Trade From (Surplus):</h3>
                <p className="theme-text-secondary">
                  {Object.entries(dashboard.categorySummary)
                    .filter(([_, cat]) => cat.zScore > 0.5)
                    .map(([_, cat]) => cat.abbrev)
                    .join(", ") || "No clear surplus"}
                </p>
              </div>
              
              <div>
                <h3 className="mb-2 font-semibold text-red-700 dark:text-red-400">Need to Fix (Weak):</h3>
                <p className="theme-text-secondary">
                  {Object.entries(dashboard.categorySummary)
                    .filter(([_, cat]) => cat.zScore < -0.5)
                    .map(([_, cat]) => cat.abbrev)
                    .join(", ") || "No critical weaknesses"}
                </p>
              </div>
              
              <div>
                <h3 className="mb-2 font-semibold text-blue-700 dark:text-blue-300">Ideal Trade Targets:</h3>
                <p className="theme-text-secondary">
                  Teams that are top 3 in your weak categories and bottom 4 in your strong categories
                </p>
              </div>
            </div>
          </div>

          {/* Player Recommendations */}
          {dashboard.recommendations && dashboard.recommendations.length > 0 && (
            <div className="rounded-lg border border-gray-300 theme-bg-primary p-6">
              <h2 className="mb-4 text-xl font-semibold theme-text-primary">
                🎯 Top Trade Targets
              </h2>
              <p className="mb-4 text-sm theme-text-secondary">
                Players across the league who excel in your weak categories:{" "}
                {Object.entries(dashboard.categorySummary)
                  .filter(([code, cat]) => {
                    // Only show skater categories (exclude goalie-only: W, GAA, SV, SVPCT, SHO)
                    const goalieCategoryCodes = ["W", "GAA", "SV", "SVPCT", "SHO"];
                    // Include if z-score < -0.4 OR rank in bottom 30% (matches recommendation logic)
                    const isWeakByZScore = cat.zScore < -0.4;
                    const isWeakByRank = cat.rank > (cat.teams * 0.7);
                    return (isWeakByZScore || isWeakByRank) && !goalieCategoryCodes.includes(code);
                  })
                  .map(([_, cat]) => cat.abbrev)
                  .join(", ")}
              </p>
              
              <div className="grid gap-4 md:grid-cols-3">
                {dashboard.recommendations.map((rec, idx) => (
                  <div
                    key={rec.playerId}
                    className="rounded-lg border-2 border-blue-300 bg-blue-50 p-4 dark:border-blue-600 dark:bg-blue-900/20"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-lg text-gray-900 dark:text-white">{rec.name}</h3>
                        <p className="text-xs text-gray-700 dark:text-gray-300">
                          {rec.pos} • {rec.nhlTeam}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-blue-700 dark:text-blue-300 dark:text-blue-300">
                          Fit: {toFixedSafe(Math.min(rec.fitScore * 100, 100), 0)}%
                        </div>
                        <div className="text-xs theme-text-secondary">
                          Value: {toFixedSafe(rec.value, 1)}
                        </div>
                      </div>
                    </div>
                    
                    <div className="mb-2 rounded bg-white/50 p-2 dark:bg-gray-800/50">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                        Stats in Your Weak Categories:
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                        {Object.entries(rec.categoryStats).map(([cat, value]) => {
                          const catInfo = dashboard.categorySummary[cat];
                          if (!catInfo) return null;
                          return (
                            <div key={cat} className="flex items-center gap-1">
                              <span className="text-gray-600 dark:text-gray-300">{catInfo.abbrev}:</span>
                              <span className="font-semibold text-gray-900 dark:text-gray-100">{toFixedSafe(value, cat === "GAA" || cat === "SVPCT" ? 2 : 0)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <span className="text-gray-600 dark:text-gray-300">On: </span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{rec.currentTeamName}</span>
                      </div>
                      {rec.keeper && (
                        <div className="rounded bg-purple-200 px-2 py-1 font-semibold text-purple-800 dark:bg-purple-800 dark:text-purple-200">
                          R{rec.keeper.round} • {rec.keeper.yearsRemaining}yr
                        </div>
                      )}
                    </div>
                    
                    <Link
                      href={`/league/${leagueKey}/trade?teamB=${rec.currentTeamId}&playerId=${rec.playerId}`}
                      className="mt-3 block w-full rounded bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Add to Trade Block →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </ThemeProvider>
  );
}

