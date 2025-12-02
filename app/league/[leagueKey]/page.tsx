import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { syncLeagueStandings } from "@/lib/yahoo/standings";
import { syncLeagueRosters } from "@/lib/yahoo/roster";
import { syncLeaguePlayerStats } from "@/lib/yahoo/playerStats";
import { ensureLeaguePlayerValues } from "@/lib/yahoo/playerValues";
import { NextRequest } from "next/server";
import Link from "next/link";
import { YahooTokenExpiredError } from "@/lib/yahoo/fantasyClient";
import { redirectToYahooAuth } from "@/lib/yahoo/tokenExpiration";

export default async function LeagueDetailPage({
  params,
}: {
  params: Promise<{ leagueKey: string }>;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const { leagueKey } = await params;

  if (!leagueKey) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          <div className="rounded border border-red-200 bg-red-50 p-6">
            <p className="text-red-600">League key is missing</p>
          </div>
        </div>
      </div>
    );
  }

  // Redirect directly to trade builder
  redirect(`/league/${encodeURIComponent(leagueKey)}/trade`);

  let standingsData;
  let rosterData;
  let leagueName = leagueKey;

  try {
    const request = new NextRequest(`http://localhost:3000/league/${leagueKey}`);
    
    // Auto-sync all data in parallel
    [standingsData, rosterData] = await Promise.all([
      (async () => {
        try {
          const standings = await syncLeagueStandings(request, leagueKey);
          if (standings && standings.length > 0) {
            leagueName = standings[0].leagueName || leagueKey;
          }
          return { ok: true, standings };
        } catch (error) {
          if (error instanceof YahooTokenExpiredError) {
            redirectToYahooAuth(`/league/${encodeURIComponent(leagueKey)}`);
          }
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Failed to fetch standings",
          };
        }
      })(),
      (async () => {
        try {
          const rosters = await syncLeagueRosters(request, leagueKey);
          return { ok: true, rosters };
        } catch (error) {
          if (error instanceof YahooTokenExpiredError) {
            redirectToYahooAuth(`/league/${encodeURIComponent(leagueKey)}`);
          }
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Failed to fetch roster",
          };
        }
      })(),
    ]);

    // Auto-sync player stats and calculate values in background (don't block page load)
    if (rosterData.ok && standingsData.ok) {
      // Get league ID from database
      const { prisma } = await import("@/lib/prisma");
      const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
      const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');
      
      const league = await prisma.league.findFirst({
        where: {
          userId: session.userId,
          OR: [
            { leagueKey: normalizedLeagueKey },
            { leagueKey: reverseNormalizedKey },
            { leagueKey: leagueKey },
          ],
        },
      });

      if (league) {
        // Run stats sync in background (don't await)
        syncLeaguePlayerStats(request, leagueKey)
          .then(async () => {
            // After stats are synced, calculate values
            try {
              await ensureLeaguePlayerValues(league.id);
            } catch (err) {
              console.error("Error calculating player values:", err);
            }
          })
          .catch((err) => {
            console.error("Error syncing player stats:", err);
          });
      }
    }
  } catch (error) {
    if (error instanceof YahooTokenExpiredError) {
      redirectToYahooAuth(`/league/${encodeURIComponent(leagueKey)}`);
    }
    standingsData = { ok: false, error: "Failed to load data" };
    rosterData = { ok: false, error: "Failed to load data" };
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        {/* Yahoo-style header */}
        <div className="mb-6 border-b border-gray-300 bg-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <Link
                href="/leagues"
                className="mb-2 inline-block text-sm text-blue-600 hover:text-blue-800"
              >
                ← Back to Leagues
              </Link>
              <h1 className="text-2xl font-bold text-gray-900">{leagueName}</h1>
            </div>
            <Link
              href={`/league/${leagueKey}/trade`}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Trade Builder
            </Link>
          </div>
        </div>

        <div className="space-y-6">
          {/* Standings */}
          <div className="border border-gray-300 bg-white">
            <div className="border-b border-gray-200 bg-gray-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-gray-900">Standings</h2>
            </div>
            {!standingsData.ok ? (
              <div className="p-4">
                <p className="text-red-600">{standingsData.error || "Failed to load standings"}</p>
              </div>
            ) : standingsData.standings && standingsData.standings.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">Rank</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">Team</th>
                      <th className="px-4 py-2 text-left font-semibold text-gray-700">Manager</th>
                      <th className="px-4 py-2 text-center font-semibold text-gray-700">W</th>
                      <th className="px-4 py-2 text-center font-semibold text-gray-700">L</th>
                      <th className="px-4 py-2 text-center font-semibold text-gray-700">T</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standingsData.standings.map((standing: any, index: number) => (
                      <tr
                        key={standing.teamKey}
                        className="border-t border-gray-200 hover:bg-gray-50"
                      >
                        <td className="px-4 py-2 text-gray-700">{standing.rank ?? index + 1}</td>
                        <td className="px-4 py-2 font-medium text-gray-900">
                          {standing.teamName}
                        </td>
                        <td className="px-4 py-2 text-gray-600">
                          {standing.managerName || "-"}
                        </td>
                        <td className="px-4 py-2 text-center text-gray-700">{standing.wins}</td>
                        <td className="px-4 py-2 text-center text-gray-700">{standing.losses}</td>
                        <td className="px-4 py-2 text-center text-gray-700">{standing.ties}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4">
                <p className="text-gray-600">No standings available.</p>
              </div>
            )}
          </div>

          {/* Rosters */}
          <div className="border border-gray-300 bg-white">
            <div className="border-b border-gray-200 bg-gray-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-gray-900">Rosters</h2>
            </div>
            {!rosterData.ok ? (
              <div className="p-4">
                <p className="text-red-600">{rosterData.error || "Failed to load rosters"}</p>
              </div>
            ) : rosterData.rosters && rosterData.rosters.length > 0 ? (
              <div className="space-y-4 p-4">
                {rosterData.rosters.map((roster: any) => (
                  <div key={roster.teamKey} className="border-b border-gray-200 pb-4 last:border-b-0 last:pb-0">
                    <h3 className="mb-3 text-base font-semibold text-gray-900">
                      {roster.teamName}
                      {roster.managerName && (
                        <span className="ml-2 text-sm font-normal text-gray-600">
                          ({roster.managerName})
                        </span>
                      )}
                    </h3>

                    {roster.entries && roster.entries.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-2 py-1 text-left font-semibold text-gray-700">Player</th>
                              <th className="px-2 py-1 text-left font-semibold text-gray-700">Pos</th>
                              <th className="px-2 py-1 text-left font-semibold text-gray-700">Slot</th>
                              <th className="px-2 py-1 text-left font-semibold text-gray-700">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {roster.entries.map((entry: any) => (
                              <tr
                                key={entry.playerKey}
                                className="border-t border-gray-100 hover:bg-gray-50"
                              >
                                <td className="px-2 py-1 text-gray-900">{entry.playerName}</td>
                                <td className="px-2 py-1 text-gray-600">
                                  {entry.primaryPosition || "-"}
                                </td>
                                <td className="px-2 py-1 text-gray-600">
                                  {entry.yahooPosition || "-"}
                                </td>
                                <td className="px-2 py-1">
                                  {entry.isInjuredList && (
                                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                                      {entry.yahooPosition === "IR+" ? "IR+" : "IR"}
                                    </span>
                                  )}
                                  {entry.isBench && !entry.isInjuredList && (
                                    <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-700">
                                      Bench
                                    </span>
                                  )}
                                  {!entry.isBench && !entry.isInjuredList && (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm text-gray-600">No players on roster.</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4">
                <p className="text-gray-600">No rosters available.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
