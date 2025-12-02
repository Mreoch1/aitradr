import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

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

export interface SessionPayload {
  userId: string;
}

export async function createSession(userId: string): Promise<string> {
  const session = await new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getEncodedKey());

  return session;
}

export async function verifySession(
  session: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(session, getEncodedKey(), {
      algorithms: ["HS256"],
    });
    
    if (typeof payload.userId === "string") {
      return { userId: payload.userId };
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session");

  if (!sessionCookie?.value) {
    return null;
  }

  return verifySession(sessionCookie.value);
}

export async function setSessionCookie(session: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("session", session, {
    httpOnly: true,
    secure: true, // Always use secure since Cloudflare tunnel provides HTTPS
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("session");
}

