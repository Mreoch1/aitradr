import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "crypto";

function getSecretKey(): string {
  const secretKey = process.env.AUTH_SECRET;
  if (!secretKey) {
    throw new Error("AUTH_SECRET environment variable is not set");
  }
  return secretKey;
}

function getEncodedKey(): Uint8Array {
  return new TextEncoder().encode(getSecretKey());
}

const CSRF_COOKIE_NAME = "yahoo_oauth_state";
const CSRF_COOKIE_MAX_AGE = 60 * 10; // 10 minutes

export async function generateStateToken(returnTo?: string): Promise<string> {
  const state = randomBytes(32).toString("hex");
  const payload: { state: string; returnTo?: string } = { state };
  if (returnTo) {
    payload.returnTo = returnTo;
  }
  
  const signedState = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getEncodedKey());

  const cookieStore = await cookies();
  
  // Cloudflare tunnels use HTTPS, so we can use secure cookies
  // SameSite="lax" works for OAuth flows (top-level navigation from Yahoo back to our site)
  cookieStore.set(CSRF_COOKIE_NAME, signedState, {
    httpOnly: true,
    secure: true, // Cloudflare tunnel provides HTTPS
    sameSite: "lax", // Allows OAuth callback redirects
    maxAge: CSRF_COOKIE_MAX_AGE,
    path: "/",
  });
  
  console.log("[CSRF] State token generated and cookie set (secure, SameSite=lax)");

  return state;
}

export async function verifyStateToken(
  receivedState: string
): Promise<{ valid: boolean; returnTo?: string }> {
  try {
    const cookieStore = await cookies();
    const stateCookie = cookieStore.get(CSRF_COOKIE_NAME);

    if (!stateCookie?.value) {
      console.error("[CSRF] State cookie not found. Cookie name:", CSRF_COOKIE_NAME);
      return { valid: false };
    }

    const { payload } = await jwtVerify(stateCookie.value, getEncodedKey(), {
      algorithms: ["HS256"],
    });

    if (typeof payload.state === "string" && payload.state === receivedState) {
      cookieStore.delete(CSRF_COOKIE_NAME);
      const returnTo = typeof payload.returnTo === "string" ? payload.returnTo : undefined;
      return { valid: true, returnTo };
    }

    console.error("[CSRF] State mismatch. Expected:", receivedState.substring(0, 10) + "...", "Got:", typeof payload.state === "string" ? payload.state.substring(0, 10) + "..." : "not a string");
    return { valid: false };
  } catch (error) {
    console.error("[CSRF] Error verifying state token:", error instanceof Error ? error.message : String(error));
    return { valid: false };
  }
}

export async function clearStateToken(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CSRF_COOKIE_NAME);
}

