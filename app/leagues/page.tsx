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

  // Always redirect to atfh2 league (hardcoded for this season)
  const ATFH2_LEAGUE_KEY = "465.l.9080";
  
  // Sync leagues to ensure user has access
  try {
    const request = new NextRequest("http://localhost:3000/leagues");
    await syncUserLeagues(request);
    
    // Always redirect to atfh2 league
    redirect(`/league/${ATFH2_LEAGUE_KEY}/trade`);
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

