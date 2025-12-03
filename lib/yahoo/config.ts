function validateRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === "") {
    throw new Error(
      `Required environment variable ${key} is not set or is empty`
    );
  }
  return value.trim();
}

function validateRedirectUri(uri: string): void {
  try {
    const url = new URL(uri);

    if (process.env.NODE_ENV === "production") {
      if (url.protocol !== "https:") {
        throw new Error(
          "YAHOO_REDIRECT_URI must use https in production"
        );
      }
    } else {
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error(
          "YAHOO_REDIRECT_URI must be a valid http or https URL"
        );
      }
      if (url.protocol === "http:" && !url.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
        throw new Error(
          "YAHOO_REDIRECT_URI can only use http for localhost in development"
        );
      }
    }

    if (url.pathname.endsWith("/")) {
      throw new Error(
        "YAHOO_REDIRECT_URI must not have a trailing slash"
      );
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        `YAHOO_REDIRECT_URI is not a valid URL: ${uri}`
      );
    }
    throw error;
  }
}

let cachedClientId: string | null = null;
let cachedClientSecret: string | null = null;
let cachedRedirectUri: string | null = null;
let cachedGameKey: string | null = null;

export function getYahooClientId(): string {
  if (cachedClientId === null) {
    cachedClientId = validateRequiredEnv("YAHOO_CLIENT_ID");
  }
  return cachedClientId;
}

export function getYahooClientSecret(): string {
  if (cachedClientSecret === null) {
    cachedClientSecret = validateRequiredEnv("YAHOO_CLIENT_SECRET");
  }
  return cachedClientSecret;
}

export function getYahooRedirectUri(): string {
  if (cachedRedirectUri === null) {
    const uri = validateRequiredEnv("YAHOO_REDIRECT_URI");
    validateRedirectUri(uri);
    cachedRedirectUri = uri;
  }
  return cachedRedirectUri;
}

export function getYahooGameKey(): string {
  if (cachedGameKey === null) {
    cachedGameKey = process.env.YAHOO_GAME_KEY || "";
  }
  return cachedGameKey;
}

