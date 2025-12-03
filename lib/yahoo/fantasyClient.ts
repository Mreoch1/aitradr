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

/**
 * Helper function to retry requests with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on auth errors or rate limiting
      if (error instanceof YahooFantasyError) {
        if (error.status === 401 || error.status === 999) {
          throw error;
        }
      }
      
      if (attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.log(`[Yahoo] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
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
        timeout: 30000, // 30 second timeout
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
            
            // Handle 504 Gateway Timeout
            if (res.statusCode === 504) {
              console.error(`[YahooFantasy] Yahoo API timeout (504)`);
              reject(
                new YahooFantasyError(
                  `Yahoo API is taking too long to respond. This is usually temporary. Wait a minute and try clicking "Refresh Teams" again.`,
                  504,
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

    // Handle request timeout
    req.on("timeout", () => {
      console.error(`[YahooFantasy] Request timeout after 30 seconds`);
      req.destroy();
      reject(
        new YahooFantasyError(
          `Yahoo API request timed out after 30 seconds. Yahoo's servers might be slow. Wait a minute and try again.`,
          504,
          path
        )
      );
    });

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
    }) => retryWithBackoff(() => yahooFantasyRequest(user.id, path, options)),
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
  return retryWithBackoff(() => yahooFantasyRequest(userId, path, options));
}

