import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import {
  getYahooFantasyClientForRequest,
  YahooNotLinkedError,
  YahooTokenExpiredError,
  YahooFantasyError,
} from "@/lib/yahoo/fantasyClient";
import { parseYahooXml } from "@/lib/yahoo/normalize";
import { getYahooGameKey } from "@/lib/yahoo/config";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    const yahooAccount = await prisma.yahooAccount.findUnique({
      where: { userId: session.userId },
    });

    if (!yahooAccount) {
      return NextResponse.json(
        { ok: false, error: "Yahoo account not linked" },
        { status: 400 }
      );
    }

    const client = await getYahooFantasyClientForRequest(request);

    const gameKey = getYahooGameKey();
    const endpoint = gameKey ? `game/${gameKey}` : "game";

    const xmlResponse = await client.request(endpoint);
    const parsedResult = await parseYahooXml(xmlResponse);

    return NextResponse.json({
      ok: true,
      sample: parsedResult,
    });
  } catch (error) {
    if (error instanceof YahooNotLinkedError) {
      return NextResponse.json(
        { ok: false, error: "Yahoo account not linked" },
        { status: 400 }
      );
    }

    if (error instanceof YahooTokenExpiredError) {
      return NextResponse.json(
        { ok: false, error: "Yahoo access token expired" },
        { status: 401 }
      );
    }

    if (error instanceof YahooFantasyError) {
      console.error("Yahoo Fantasy API health check failed:", {
        status: error.status,
        endpoint: error.endpoint,
        message: error.message,
      });

      return NextResponse.json(
        {
          ok: false,
          error: `Yahoo Fantasy API error: ${error.status} ${error.message}`,
        },
        { status: error.status >= 500 ? 500 : error.status }
      );
    }

    if (error instanceof Error && error.message.includes("parse")) {
      console.error("XML parsing error in health check:", error.message);
      return NextResponse.json(
        { ok: false, error: "Failed to parse Yahoo response" },
        { status: 500 }
      );
    }

    console.error("Unexpected error in Yahoo health check:", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

