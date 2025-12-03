import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { getYahooGameKey } from "@/lib/yahoo/config";
import https from "https";

export class YahooFantasyError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string
  ) {
    super(message);
    this.name = "YahooFantasyError";
  }
}

export class YahooNotLinkedError extends Error {
  constructor() {
    super("Yahoo account is not linked");
    this.name = "YahooNotLinkedError";
  }
}

export class YahooTokenExpiredError extends Error {
  constructor() {
    super("Yahoo access token expired");
    this.name = "YahooTokenExpiredError";
  }
}

interface UserWithYahooAccount {
  id: string;
  yahooAccount: {
    id: string;
    yahooUserId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  } | null;
}

async function getUserWithYahooAccount(
  request: NextRequest
): Promise<UserWithYahooAccount> {
  const session = await getSession();

  if (!session) {
    throw new Error("Not authenticated");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    include: {
      yahooAccount: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (!user.yahooAccount) {
    throw new YahooNotLinkedError();
  }

  if (!user.yahooAccount.accessToken) {
    throw new YahooNotLinkedError();
  }

  if (user.yahooAccount.expiresAt && user.yahooAccount.expiresAt < new Date()) {
    throw new YahooTokenExpiredError();
  }

  return {
    id: user.id,
    yahooAccount: {
      id: user.yahooAccount.id,
      yahooUserId: user.yahooAccount.yahooUserId,
      accessToken: user.yahooAccount.accessToken,
      refreshToken: user.yahooAccount.refreshToken,
      expiresAt: user.yahooAccount.expiresAt,
    },
  };
}

async function yahooFantasyRequest(
  userIdOrRequest: string | NextRequest,
  path: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<string> {
  let user: UserWithYahooAccount;

  if (typeof userIdOrRequest === "string") {
    const yahooAccount = await prisma.yahooAccount.findUnique({
      where: { userId: userIdOrRequest },
    });

    if (!yahooAccount || !yahooAccount.accessToken) {
      throw new YahooNotLinkedError();
    }

    if (yahooAccount.expiresAt && yahooAccount.expiresAt < new Date()) {
      throw new YahooTokenExpiredError();
    }

    user = {
      id: userIdOrRequest,
      yahooAccount: {
        id: yahooAccount.id,
        yahooUserId: yahooAccount.yahooUserId,
        accessToken: yahooAccount.accessToken,
        refreshToken: yahooAccount.refreshToken,
        expiresAt: yahooAccount.expiresAt,
      },
    };
  } else {
    user = await getUserWithYahooAccount(userIdOrRequest);
  }

  if (!user.yahooAccount) {
    throw new YahooNotLinkedError();
  }

  const baseUrl = "https://fantasysports.yahooapis.com/fantasy/v2";
  const url = `${baseUrl}/${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${user.yahooAccount.accessToken}`,
    Accept: "application/xml",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...options?.headers,
  };

  console.log(`[YahooFantasy] Fetching: ${path}`);
  console.log(`[YahooFantasy] Full URL: ${url}`);

  // Use native https module to bypass Next.js fetch caching issues
  return new Promise<string>((resolve, reject) => {
    const urlObj = new URL(url);
    
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: options?.method || "GET",
        headers,
      },
      (res) => {
        console.log(`[YahooFantasy] Response status: ${res.statusCode}`);
        console.log(`[YahooFantasy] Response headers:`, res.headers);

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk.toString();
          });
          res.on("end", () => {
            console.error(`[YahooFantasy] Error response body:`, body.substring(0, 500));
            
            // Handle Yahoo's custom 999 status code (rate limiting / bot detection)
            if (res.statusCode === 999) {
              console.error(`[YahooFantasy] Yahoo returned 999 - Rate limited or bot detected. Response: ${body}`);
              reject(
                new YahooFantasyError(
                  `Yahoo API blocked request (status 999). This usually means rate limiting or the request was flagged. Try again in a few minutes or re-authenticate your Yahoo account.`,
                  999,
                  path
                )
              );
              return;
            }
            
            reject(
              new YahooFantasyError(
                `Yahoo Fantasy API request failed: ${res.statusMessage}`,
                res.statusCode || 0,
                path
              )
            );
          });
          return;
        }

        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          console.log(`[YahooFantasy] Response body length: ${body.length}`);
          resolve(body);
        });
      }
    );

    req.on("error", (error) => {
      console.error(`[YahooFantasy] Request error:`, error);
      reject(
        new YahooFantasyError(
          `Yahoo Fantasy API request failed: ${error.message}`,
          0,
          path
        )
      );
    });

    if (options?.body) {
      req.write(options.body);
    }

    req.end();
  });

}

export interface YahooFantasyClient {
  yahooAccount: {
    id: string;
    yahooUserId: string;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date | null;
  };
  request(path: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<string>;
}

export async function getYahooFantasyClientForRequest(
  request: NextRequest
): Promise<YahooFantasyClient> {
  const user = await getUserWithYahooAccount(request);

  if (!user.yahooAccount) {
    throw new YahooNotLinkedError();
  }

  return {
    yahooAccount: user.yahooAccount,
    request: (path: string, options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    }) => yahooFantasyRequest(user.id, path, options),
  };
}

export async function yahooFantasyRequestForUser(
  userId: string,
  path: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<string> {
  return yahooFantasyRequest(userId, path, options);
}

