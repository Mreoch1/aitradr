import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { verifyStateToken, clearStateToken } from "@/lib/auth/csrf";
import {
  getYahooClientId,
  getYahooClientSecret,
  getYahooRedirectUri,
} from "@/lib/yahoo/config";
import { prisma } from "@/lib/prisma";
import { parseYahooXml } from "@/lib/yahoo/normalize";

/**
 * Ensures a status code is valid (200-599) for Next.js Response
 * Next.js requires status codes to be in the range 200-599 inclusive
 */
function ensureValidStatus(status: number | undefined | null): number {
  if (typeof status !== "number" || isNaN(status)) {
    return 500;
  }
  // Clamp to valid range: 200-599
  return Math.max(200, Math.min(599, Math.floor(status)));
}

interface YahooTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  xoauth_yahoo_guid?: string;
  sub?: string;
  user_id?: string;
  error?: string;
  error_description?: string;
}

/**
 * Recursively walks an object to find the first non-empty string value
 * from a property named 'guid'.
 */
function findGuidInObject(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;

  const obj = node as Record<string, unknown>;

  // Direct hit
  if (typeof obj.guid === "string" && obj.guid.trim() !== "") {
    return obj.guid.trim();
  }

  // Recurse through values
  for (const value of Object.values(obj)) {
    if (!value) continue;

    if (typeof value === "string") {
      // ignore plain strings here
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findGuidInObject(item);
        if (found) return found;
      }
    } else if (typeof value === "object") {
      const found = findGuidInObject(value);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Resolves the Yahoo user ID from the token response or by calling the Fantasy Sports API.
 */
async function resolveYahooUserIdFromToken(
  tokenJson: any,
  accessToken: string
): Promise<string | null> {
  // 1. Try fields on the token response itself
  const direct =
    (typeof tokenJson.xoauth_yahoo_guid === "string" && tokenJson.xoauth_yahoo_guid.trim()) ||
    (typeof tokenJson.sub === "string" && tokenJson.sub.trim()) ||
    (typeof tokenJson.user_id === "string" && tokenJson.user_id.trim());

  if (direct) {
    console.log("[Yahoo callback] Using user id from token response:", direct);
    return direct;
  }

  // 2. Fallback to Fantasy Sports API
  const fantasyRes = await fetch(
    "https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/xml",
      },
    }
  );

  const fantasyBody = await fantasyRes.text();

  console.log(
    "[Yahoo callback] Fantasy /users;use_login=1 status",
    fantasyRes.status,
    fantasyRes.statusText
  );
  console.log(
    "[Yahoo callback] Fantasy /users;use_login=1 XML snippet:",
    fantasyBody.slice(0, 400)
  );

  if (!fantasyRes.ok) {
    return null;
  }

  const parsed = await parseYahooXml(fantasyBody);
  const guid = findGuidInObject(parsed);

  if (guid) {
    console.log("[Yahoo callback] Found GUID in Fantasy response:", guid);
  } else {
    console.log("[Yahoo callback] Could not find GUID in Fantasy response");
  }

  return guid;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) {
      console.error("Yahoo OAuth callback error:", error);
      const errorDescription = searchParams.get("error_description");
      if (errorDescription) {
        console.error("Yahoo OAuth error description:", errorDescription);
      }
      await clearStateToken();
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
      const protocol = request.headers.get("x-forwarded-proto") || (request.url.startsWith("https") ? "https" : "http");
      const redirectUrl = `${protocol}://${host}/yahoo/status?error=${encodeURIComponent(error)}`;
      console.log("[Yahoo Callback] Redirecting to error page:", redirectUrl);
      return NextResponse.redirect(redirectUrl);
    }

    if (!code) {
      await clearStateToken();
      return NextResponse.json(
        { error: "Authorization code is missing" },
        { status: 400 }
      );
    }

    if (!state) {
      console.error("[Yahoo Callback] State parameter is missing from callback URL");
      await clearStateToken();
      return NextResponse.json(
        { error: "Invalid state" },
        { status: 400 }
      );
    }

    console.log("[Yahoo Callback] Verifying state token. Received state length:", state.length);
    console.log("[Yahoo Callback] Request headers:", {
      host: request.headers.get("host"),
      'x-forwarded-host': request.headers.get("x-forwarded-host"),
      'x-forwarded-proto': request.headers.get("x-forwarded-proto"),
      cookie: request.headers.get("cookie") ? "present" : "missing",
      userAgent: request.headers.get("user-agent")?.substring(0, 100),
    });
    
    const stateResult = await verifyStateToken(state);
    if (!stateResult.valid) {
      console.error("[Yahoo Callback] Invalid state token. State received:", state.substring(0, 20) + "...");
      console.error("[Yahoo Callback] This usually means the state cookie expired or wasn't sent back");
      console.error("[Yahoo Callback] Common causes: mobile browser restrictions, cookie settings, or >10min elapsed");
      await clearStateToken();
      
      // Return a more user-friendly error page instead of JSON
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
      const protocol = request.headers.get("x-forwarded-proto") || (request.url.startsWith("https") ? "https" : "http");
      const errorUrl = `${protocol}://${host}/yahoo/status?error=${encodeURIComponent("oauth_state_invalid")}&message=${encodeURIComponent("Session expired or browser blocked cookies. Please try connecting Yahoo again.")}`;
      return NextResponse.redirect(errorUrl);
    }
    console.log("[Yahoo Callback] State token verified successfully. ReturnTo:", stateResult.returnTo);
    const returnTo = stateResult.returnTo;

    // Check if we have an existing session
    let session = await getSession();
    let userId: string;

    const clientId = getYahooClientId();
    const clientSecret = getYahooClientSecret();
    const redirectUri = getYahooRedirectUri();

    console.log("[Yahoo callback] Using redirect URI for token exchange:", redirectUri);

    // At this point, code is guaranteed to be non-null due to check above
    const authorizationCode = code;

    const tokenUrl = "https://api.login.yahoo.com/oauth2/get_token";
    const tokenParams = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code: authorizationCode,
      grant_type: "authorization_code",
    });

    console.log("[Yahoo callback] Token exchange request params (redacted):", {
      client_id: clientId.substring(0, 20) + "...",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_length: authorizationCode.length,
    });

    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenParams.toString(),
    });

    let tokenJson: any;
    try {
      const responseText = await tokenResponse.text();
      console.log("[Yahoo callback] Token response status", tokenResponse.status);
      console.log("[Yahoo callback] Token response text (first 500 chars):", responseText.substring(0, 500));
      
      try {
        tokenJson = JSON.parse(responseText);
      } catch (parseError) {
        console.error("[Yahoo callback] Failed to parse token response as JSON:", parseError);
        console.error("[Yahoo callback] Raw response:", responseText);
        return NextResponse.json(
          { error: "Token exchange failed: Invalid response from Yahoo", detail: responseText.substring(0, 200) },
          { status: 500 }
        );
      }
    } catch (fetchError) {
      console.error("[Yahoo callback] Failed to fetch token:", fetchError);
      return NextResponse.json(
        { error: "Token exchange failed: Network error", detail: fetchError instanceof Error ? fetchError.message : String(fetchError) },
        { status: 500 }
      );
    }

    console.log(
      "[Yahoo callback] Token response keys",
      Object.keys(tokenJson || {})
    );

    if (!tokenResponse.ok) {
      console.error("[Yahoo callback] Token error response:", tokenJson);
      console.error("[Yahoo callback] Token response status:", tokenResponse.status, "Type:", typeof tokenResponse.status);
      const errorMessage = tokenJson?.error_description || tokenJson?.error || "Token exchange failed";
      // Ensure status code is valid (200-599) - Next.js requires status codes in this range
      const responseStatus = tokenResponse.status;
      const finalStatus = ensureValidStatus(responseStatus);
      console.log(`[Yahoo callback] Token response status: ${responseStatus}, using validated status: ${finalStatus}`);
      return NextResponse.json(
        { error: "Token exchange failed", detail: errorMessage },
        { status: finalStatus }
      );
    }

    const accessToken: string | undefined = tokenJson.access_token;
    const refreshToken: string | undefined = tokenJson.refresh_token;

    if (!accessToken) {
      console.error("[Yahoo callback] Missing access_token in token response");
      return NextResponse.json(
        { error: "Missing access token in token response" },
        { status: 500 }
      );
    }

    const yahooUserId = await resolveYahooUserIdFromToken(tokenJson, accessToken);

    if (!yahooUserId) {
      console.error(
        "[Yahoo callback] Missing user identifier after token + Fantasy fallback"
      );
      return NextResponse.json(
        { error: "Missing user identifier in token response" },
        { status: 500 }
      );
    }

    // Check if a YahooAccount already exists with this yahooUserId
    const existingYahooAccount = await prisma.yahooAccount.findFirst({
      where: { yahooUserId },
      include: { user: true },
    });

    if (existingYahooAccount) {
      // User already exists - use their account
      userId = existingYahooAccount.userId;
      console.log("[Yahoo callback] Found existing Yahoo account, userId:", userId);
      
      // Create session for existing user
      const { createSession } = await import("@/lib/auth/session");
      const { cookies } = await import("next/headers");
      const sessionToken = await createSession(userId);
      const cookieStore = await cookies();
      cookieStore.set("session", sessionToken, {
        httpOnly: true,
        secure: true, // Cloudflare tunnel provides HTTPS
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
      });
    } else if (session) {
      // Session exists but no YahooAccount - link to existing user
      userId = session.userId;
      console.log("[Yahoo callback] Linking Yahoo account to existing user, userId:", userId);
    } else {
      // No session and no existing account - create new user
      console.log("[Yahoo callback] Creating new user account for Yahoo user:", yahooUserId);
      
      // Create user with placeholder email (user can update later if needed)
      const placeholderEmail = `yahoo_${yahooUserId}@fantasy.local`;
      
      // Check if email already exists (unlikely but possible)
      let user = await prisma.user.findUnique({
        where: { email: placeholderEmail },
      });
      
      if (!user) {
        // Create a dummy password hash (user won't use password auth)
        const { hashPassword } = await import("@/lib/auth/password");
        const dummyPassword = crypto.randomUUID();
        const passwordHash = await hashPassword(dummyPassword);
        
        user = await prisma.user.create({
          data: {
            email: placeholderEmail,
            passwordHash,
          },
        });
        console.log("[Yahoo callback] Created new user account, userId:", user.id);
      }
      
      userId = user.id;
      
      // Create session for new user
      const { createSession } = await import("@/lib/auth/session");
      const { cookies } = await import("next/headers");
      const sessionToken = await createSession(userId);
      const cookieStore = await cookies();
      cookieStore.set("session", sessionToken, {
        httpOnly: true,
        secure: true, // Cloudflare tunnel provides HTTPS
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        path: "/",
      });
    }

    const expiresIn = tokenJson.expires_in || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    await prisma.yahooAccount.upsert({
      where: { userId },
      update: {
        yahooUserId,
        accessToken: accessToken,
        refreshToken: refreshToken || null,
        expiresAt,
        updatedAt: new Date(),
      },
      create: {
        userId,
        yahooUserId,
        accessToken: accessToken,
        refreshToken: refreshToken || null,
        expiresAt,
      },
    });

    // Construct redirect URL using the original host from headers (for Cloudflare tunnel)
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
    const protocol = request.headers.get("x-forwarded-proto") || (request.url.startsWith("https") ? "https" : "http");
    
    // If returnTo is provided, use it
    if (returnTo) {
      const redirectUrl = `${protocol}://${host}${returnTo}`;
      console.log("[Yahoo Callback] Redirecting to returnTo:", redirectUrl);
      return NextResponse.redirect(redirectUrl);
    }
    
    // Redirect to leagues page - it will auto-redirect to the first league's trade page
    const redirectUrl = `${protocol}://${host}/leagues`;
    console.log("[Yahoo Callback] Redirecting to leagues page (will auto-redirect to trade):", redirectUrl);
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("Yahoo OAuth callback error:", error);
    if (error instanceof Error) {
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    } else {
      console.error("Non-Error object:", JSON.stringify(error, null, 2));
    }
    await clearStateToken();
    // Ensure status code is always valid (200-599)
    const errorStatus = 500; // Always use 500 for catch-all errors
    return NextResponse.json(
      { 
        error: "Internal server error",
        detail: error instanceof Error ? error.message : String(error)
      },
      { status: errorStatus }
    );
  }
}

