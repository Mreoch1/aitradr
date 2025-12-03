import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  getYahooClientId,
  getYahooRedirectUri,
} from "@/lib/yahoo/config";
import { SignJWT } from "jose";
import { randomBytes } from "crypto";

function getSecretKey(): string {
  const secretKey = process.env.AUTH_SECRET;
  if (!secretKey) {
    throw new Error("AUTH_SECRET environment variable is not set");
  }
  return secretKey;
}

const CSRF_COOKIE_NAME = "yahoo_oauth_state";
const CSRF_COOKIE_MAX_AGE = 60 * 10; // 10 minutes

export async function GET(request: NextRequest) {
  try {
    console.log("[Yahoo Start] Entering /api/auth/yahoo/start route");

    // Get returnTo parameter if provided
    const searchParams = request.nextUrl.searchParams;
    const returnTo = searchParams.get("returnTo");

    // Note: We don't require authentication here - the OAuth flow itself will authenticate the user
    // If a session exists, we can use it, but it's not required to start OAuth
    const session = await getSession();
    if (session) {
      console.log("[Yahoo Start] Existing session found, userId:", session.userId);
    } else {
      console.log("[Yahoo Start] No existing session - will create account during OAuth callback");
    }

    let clientId: string;
    let redirectUri: string;
    let state: string;

    try {
      clientId = getYahooClientId();
      console.log("[Yahoo Start] Client ID present:", !!clientId, "Length:", clientId?.length || 0);
    } catch (error) {
      console.error("[Yahoo Start] Failed to get client ID:", error);
      throw error;
    }

    try {
      redirectUri = getYahooRedirectUri();
      console.log("[Yahoo Start] Redirect URI:", redirectUri);
    } catch (error) {
      console.error("[Yahoo Start] Failed to get redirect URI:", error);
      throw error;
    }

    // Generate state token but don't set cookie yet (we'll set it in the response)
    const stateRaw = randomBytes(32).toString("hex");
    const payload: { state: string; returnTo?: string } = { state: stateRaw };
    if (returnTo) {
      payload.returnTo = returnTo;
    }
    
    const signedState = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(getSecretKey()));
    
    state = stateRaw;
    console.log("[Yahoo Start] State token generated, length:", state.length, returnTo ? `returnTo: ${returnTo}` : "");

    // Yahoo Fantasy Sports read-only scope
    // Note: profile scope may not be needed or may cause invalid_scope error
    const scopes = "fspt-r";

    console.log("[Yahoo Start] Scopes:", scopes);

    const authUrl = new URL("https://api.login.yahoo.com/oauth2/request_auth");
    authUrl.searchParams.set("client_id", clientId);
    // Ensure redirect_uri is properly encoded
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("state", state);
    
    // Double-check the redirect_uri parameter after encoding
    const encodedRedirectUri = authUrl.searchParams.get("redirect_uri");
    if (encodedRedirectUri !== redirectUri) {
      console.warn("[Yahoo Start] WARNING: Redirect URI was modified during encoding!");
      console.warn("  Original:", redirectUri);
      console.warn("  Encoded:", encodedRedirectUri);
    }

    const finalUrl = authUrl.toString();
    console.log("[Yahoo Start] Authorization URL constructed, redirecting to Yahoo");
    console.log("[Yahoo Start] OAuth Parameters:");
    console.log("  - client_id:", clientId.substring(0, 20) + "...");
    console.log("  - redirect_uri:", redirectUri);
    console.log("  - response_type: code");
    console.log("  - scope:", scopes);
    console.log("  - state:", state.substring(0, 20) + "...");
    console.log("[Yahoo Start] Full URL (redacted):", finalUrl.replace(/client_id=[^&]+/, "client_id=[REDACTED]").replace(/state=[^&]+/, "state=[REDACTED]"));
    
    // Validate redirect URI format
    try {
      const redirectUrlObj = new URL(redirectUri);
      console.log("[Yahoo Start] Redirect URI validation:");
      console.log("  - Protocol:", redirectUrlObj.protocol);
      console.log("  - Host:", redirectUrlObj.host);
      console.log("  - Path:", redirectUrlObj.pathname);
      console.log("  - Has trailing slash:", redirectUrlObj.pathname.endsWith("/"));
      console.log("  - Full redirect URI:", redirectUri);
      console.log("[Yahoo Start] IMPORTANT: Make sure this redirect_uri EXACTLY matches what's configured in your Yahoo Developer Console!");
    } catch (e) {
      console.error("[Yahoo Start] Invalid redirect URI format:", e);
      return NextResponse.json(
        { 
          error: "Invalid redirect URI configuration", 
          detail: e instanceof Error ? e.message : String(e),
          redirectUri 
        },
        { status: 500 }
      );
    }

    // Create redirect response and manually set the cookie
    const response = NextResponse.redirect(finalUrl);
    
    // Set the state cookie manually in the response headers for better Vercel compatibility
    const cookieValue = `${CSRF_COOKIE_NAME}=${signedState}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${CSRF_COOKIE_MAX_AGE}`;
    response.headers.set("Set-Cookie", cookieValue);
    console.log("[Yahoo Start] Setting state cookie manually in response headers");
    
    return response;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("[Yahoo Start] Yahoo OAuth start error:", errorMessage);
    if (errorStack) {
      console.error("[Yahoo Start] Error stack:", errorStack);
    }
    return NextResponse.json(
      { error: "Yahoo start failed", detail: errorMessage },
      { status: 500 }
    );
  }
}

