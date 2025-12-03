import { randomBytes } from "crypto";
import prisma from "@/lib/prisma";

const STATE_TOKEN_EXPIRY_MINUTES = 10;

export async function generateStateToken(returnTo?: string): Promise<string> {
  const state = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + STATE_TOKEN_EXPIRY_MINUTES * 60 * 1000);
  
  // Store in database instead of cookie
  await prisma.oAuthState.create({
    data: {
      state,
      returnTo: returnTo || null,
      expiresAt,
    },
  });
  
  console.log("[CSRF] State token generated and stored in database");

  return state;
}

export async function verifyStateToken(
  receivedState: string
): Promise<{ valid: boolean; returnTo?: string }> {
  try {
    // Look up state in database
    const stateRecord = await prisma.oAuthState.findUnique({
      where: { state: receivedState },
    });

    if (!stateRecord) {
      console.error("[CSRF] State token not found in database");
      return { valid: false };
    }

    // Check if expired
    if (new Date() > stateRecord.expiresAt) {
      console.error("[CSRF] State token expired");
      await prisma.oAuthState.delete({ where: { id: stateRecord.id } });
      return { valid: false };
    }

    // Valid! Delete it (one-time use)
    await prisma.oAuthState.delete({ where: { id: stateRecord.id } });
    
    console.log("[CSRF] State token verified successfully");
    return { valid: true, returnTo: stateRecord.returnTo || undefined };
  } catch (error) {
    console.error("[CSRF] Error verifying state token:", error instanceof Error ? error.message : String(error));
    return { valid: false };
  }
}

export async function clearStateToken(): Promise<void> {
  // Clean up expired tokens (housekeeping)
  try {
    await prisma.oAuthState.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  } catch (error) {
    console.error("[CSRF] Error clearing expired tokens:", error);
  }
}

