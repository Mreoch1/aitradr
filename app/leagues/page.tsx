import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { syncUserLeagues } from "@/lib/yahoo/leagues";
import { NextRequest } from "next/server";
import Link from "next/link";
import { YahooTokenExpiredError } from "@/lib/yahoo/fantasyClient";
import { redirectToYahooAuth } from "@/lib/yahoo/tokenExpiration";

export default async function LeaguesPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // Fetch leagues and handle redirects
  try {
    const request = new NextRequest("http://localhost:3000/leagues");
    const leagues = await syncUserLeagues(request);
    
    // Auto-redirect to first league's trade page if leagues exist
    if (leagues && leagues.length > 0) {
      // Prefer NHL league (game key 465), otherwise use first league
      const nhlLeague = leagues.find((l: any) => l.leagueKey?.includes("465"));
      const firstLeague = nhlLeague || leagues[0];
      
      if (firstLeague?.leagueKey) {
        // redirect() throws a special error that Next.js catches
        // This will stop execution and redirect the user
        redirect(`/league/${encodeURIComponent(firstLeague.leagueKey)}/trade`);
      }
    }
    
    // If we get here, we have leagues but no redirect happened
    // Render the leagues list
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-6">
          <div className="mb-6 border-b border-gray-300 bg-white px-4 py-3">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-gray-900">My Leagues</h1>
              <div className="flex items-center gap-4">
                <Link
                  href="/leagues"
                  className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                >
                  Leagues
                </Link>
                <Link
                  href="/dashboard"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Dashboard
                </Link>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {leagues.map((league: any) => (
              <div
                key={league.leagueKey}
                className="border border-gray-300 bg-white hover:bg-gray-50"
              >
                <div className="border-b border-gray-200 bg-gray-100 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">{league.name}</h2>
                      <div className="mt-1 flex items-center gap-4 text-sm text-gray-600">
                        <span>Season: {league.season}</span>
                        <span>•</span>
                        <span className="uppercase">{league.sport}</span>
                        {league.teamCount && (
                          <>
                            <span>•</span>
                            <span>{league.teamCount} Teams</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/league/${encodeURIComponent(league.leagueKey)}/trade`}
                      className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Open Trade Builder
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  } catch (error) {
    // Check if this is a Next.js redirect error - if so, re-throw it
    // Next.js redirect() throws an error with digest "NEXT_REDIRECT"
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.includes("NEXT_REDIRECT")
    ) {
      throw error; // Re-throw so Next.js can handle the redirect
    }
    
    if (error instanceof YahooTokenExpiredError) {
      redirectToYahooAuth("/leagues");
    }
    
    // Render error state
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-6">
          <div className="mb-6 border-b border-gray-300 bg-white px-4 py-3">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-gray-900">My Leagues</h1>
              <div className="flex items-center gap-4">
                <Link
                  href="/leagues"
                  className="text-sm font-semibold text-blue-600 hover:text-blue-800"
                >
                  Leagues
                </Link>
                <Link
                  href="/dashboard"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Dashboard
                </Link>
              </div>
            </div>
          </div>
          <div className="rounded border border-red-200 bg-red-50 p-6">
            <p className="text-red-600">
              {error instanceof Error ? error.message : "Failed to load leagues"}
            </p>
          </div>
        </div>
      </div>
    );
  }
}

