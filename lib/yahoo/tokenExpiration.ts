/**
 * Utilities for handling Yahoo token expiration
 */

import { redirect } from "next/navigation";
import { YahooTokenExpiredError } from "./fantasyClient";

/**
 * Check if an error is a token expiration error
 */
export function isTokenExpiredError(error: unknown): boolean {
  return error instanceof YahooTokenExpiredError;
}

/**
 * Get the redirect URL for Yahoo OAuth with a return path
 */
export function getYahooAuthRedirectUrl(returnPath?: string): string {
  const baseUrl = "/api/auth/yahoo/start";
  if (returnPath) {
    // Encode the return path as a query parameter
    const encoded = encodeURIComponent(returnPath);
    return `${baseUrl}?returnTo=${encoded}`;
  }
  return baseUrl;
}

/**
 * Redirect to Yahoo OAuth when token expires (server-side)
 * Use this in server components and API routes
 */
export function redirectToYahooAuth(returnPath?: string): never {
  const url = getYahooAuthRedirectUrl(returnPath);
  redirect(url);
}

