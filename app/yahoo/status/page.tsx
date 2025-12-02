"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { getYahooStatus, startYahooAuth } from "@/lib/yahoo/client";
import type { YahooStatusResponse } from "@/lib/yahoo/client";

function YahooStatusContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<YahooStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success === "true") {
      setMessage("Yahoo account linked successfully!");
    } else if (error) {
      setMessage(`Error: ${decodeURIComponent(error)}`);
    }

    async function loadStatus() {
      const result = await getYahooStatus();
      setStatus(result);
      setLoading(false);
    }
    loadStatus();
  }, [searchParams]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-600 dark:text-zinc-400">Loading...</p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-600 dark:text-red-400">Failed to load status</p>
      </div>
    );
  }

  if (!status.authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-zinc-600 dark:text-zinc-400">
            Please sign in to link your Yahoo account.
          </p>
        </div>
      </div>
    );
  }

  if (!status.linked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          {message && (
            <p
              className={`mb-4 ${
                message.includes("Error")
                  ? "text-red-600 dark:text-red-400"
                  : "text-green-600 dark:text-green-400"
              }`}
            >
              {message}
            </p>
          )}
          <p className="mb-4 text-zinc-600 dark:text-zinc-400">
            Your Yahoo account is not linked.
          </p>
          <button
            onClick={() => startYahooAuth()}
            className="rounded-full bg-foreground px-5 py-2 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Link Yahoo Account
          </button>
        </div>
      </div>
    );
  }

  const expiresAt = status.expiresAt
    ? new Date(status.expiresAt)
    : null;
  const isExpired = expiresAt ? expiresAt < new Date() : false;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        {message && (
          <p
            className={`mb-4 ${
              message.includes("Error")
                ? "text-red-600 dark:text-red-400"
                : "text-green-600 dark:text-green-400"
            }`}
          >
            {message}
          </p>
        )}
        <h1 className="mb-4 text-2xl font-semibold text-black dark:text-zinc-50">
          Yahoo Account Linked
        </h1>
        <p className="mb-2 text-zinc-600 dark:text-zinc-400">
          Yahoo User ID: {status.yahooUserId}
        </p>
        {expiresAt && (
          <p className="mb-2 text-zinc-600 dark:text-zinc-400">
            Token expires: {expiresAt.toLocaleString()}
            {isExpired && (
              <span className="ml-2 text-red-600 dark:text-red-400">
                (Expired)
              </span>
            )}
          </p>
        )}
        {status.linkedAt && (
          <p className="mb-4 text-zinc-600 dark:text-zinc-400">
            Linked on: {new Date(status.linkedAt).toLocaleString()}
          </p>
        )}
        <button
          onClick={() => startYahooAuth()}
          className="rounded-full border border-solid border-black/[.08] px-5 py-2 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          Re-link Yahoo Account
        </button>
      </div>
    </div>
  );
}

export default function YahooStatusPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-600 dark:text-zinc-400">Loading...</p>
      </div>
    }>
      <YahooStatusContent />
    </Suspense>
  );
}

