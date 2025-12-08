"use client";

import { useState } from "react";

interface SyncHistoricalStatsButtonProps {
  leagueKey: string;
}

export default function SyncHistoricalStatsButton({ leagueKey }: SyncHistoricalStatsButtonProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | null; message: string }>({
    type: null,
    message: "",
  });

  const handleSync = async () => {
    setLoading(true);
    setStatus({ type: null, message: "" });

    try {
      const response = await fetch(`/api/league/${leagueKey}/sync-historical-stats`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.details || data.error || "Failed to sync historical stats";
        throw new Error(errorMsg);
      }

      const message = `Sync completed! Processed ${data.successfulSyncs || 0} of ${data.totalPlayers || 0} players. ${data.totalStatsStored || 0} stats stored.${data.playersWithNoNHLId ? ` ${data.playersWithNoNHLId} players skipped (no NHL ID found).` : ''}`;
      setStatus({
        type: "success",
        message,
      });
    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : "Failed to sync historical stats";
      
      // Check if it's a DNS/network error
      if (errorMessage.includes("ENOTFOUND") || errorMessage.includes("fetch failed")) {
        errorMessage = "Network error: Cannot reach NHL API. This is a known Vercel limitation. Please run the sync locally using: npx tsx scripts/sync-historical-stats.ts [leagueKey]";
      }
      
      setStatus({
        type: "error",
        message: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleSync}
        disabled={loading}
        className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
      >
        {loading ? "⏳ Syncing..." : "🔄 Sync Historical Stats"}
      </button>
      {status.type && (
        <div
          className={`rounded-lg p-3 text-sm ${
            status.type === "success"
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200"
              : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200"
          }`}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}

