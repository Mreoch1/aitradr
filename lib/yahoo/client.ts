export interface YahooStatusResponse {
  linked: boolean;
  authenticated: boolean;
  yahooUserId?: string;
  expiresAt?: string | null;
  linkedAt?: string;
  error?: string;
}

export interface YahooLeague {
  leagueKey: string;
  name: string;
  season: string;
  sport: string;
  teamCount?: number;
}

export interface YahooLeaguesResponse {
  ok: boolean;
  leagues?: YahooLeague[];
  error?: string;
}

export async function startYahooAuth(returnTo?: string): Promise<void> {
  const url = returnTo 
    ? `/api/auth/yahoo/start?returnTo=${encodeURIComponent(returnTo)}`
    : "/api/auth/yahoo/start";
  window.location.href = url;
}

/**
 * Check if an error response indicates token expiration and redirect if so
 */
export function handleTokenExpiration(
  error: { error?: string; ok?: boolean; redirectUrl?: string }, 
  returnTo?: string
): boolean {
  if (error.error === "Yahoo access token expired" || 
      (error.ok === false && error.error?.includes("token expired"))) {
    // Use redirectUrl from API if provided, otherwise construct it
    if (error.redirectUrl) {
      window.location.href = error.redirectUrl;
    } else {
      startYahooAuth(returnTo || window.location.pathname);
    }
    return true;
  }
  return false;
}

export async function getYahooStatus(): Promise<YahooStatusResponse> {
  try {
    const response = await fetch("/api/auth/yahoo/status");
    const data = await response.json();
    return data;
  } catch (error) {
    return {
      linked: false,
      authenticated: false,
      error: "Network error. Please try again.",
    };
  }
}

export async function getLeagues(): Promise<YahooLeaguesResponse> {
  try {
    const response = await fetch("/api/yahoo/leagues");
    const data = await response.json();
    return data;
  } catch (error) {
    return {
      ok: false,
      error: "Network error. Please try again.",
    };
  }
}

