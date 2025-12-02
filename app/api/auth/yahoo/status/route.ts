import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@prisma/client";

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({
        linked: false,
        authenticated: false,
      });
    }

    const yahooAccount = await prisma.yahooAccount.findUnique({
      where: { userId: session.userId },
      select: {
        yahooUserId: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    if (!yahooAccount) {
      return NextResponse.json({
        linked: false,
        authenticated: true,
      });
    }

    return NextResponse.json({
      linked: true,
      authenticated: true,
      yahooUserId: yahooAccount.yahooUserId,
      expiresAt: yahooAccount.expiresAt?.toISOString() || null,
      linkedAt: yahooAccount.createdAt.toISOString(),
    });
  } catch (error) {
    console.error("Yahoo status error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

