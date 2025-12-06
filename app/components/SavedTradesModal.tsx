"use client";

import { useState } from "react";
import { toFixedSafe } from "@/lib/utils/numberFormat";

interface SavedTrade {
  id: string;
  tradeName: string | null;
  teamAName: string;
  teamBName: string;
  teamAPlayers: string[];
  teamBPlayers: string[];
  teamAPicks: number[];
  teamBPicks: number[];
  teamAValue: number;
  teamBValue: number;
  netDiff: number;
  createdAt: string;
}

interface SavedTradesModalProps {
  isOpen: boolean;
  onClose: () => void;
  trades: SavedTrade[];
  onLoadTrade: (trade: SavedTrade) => void;
  onDeleteTrade: (tradeId: string) => void;
}

export function SavedTradesModal({
  isOpen,
  onClose,
  trades,
  onLoadTrade,
  onDeleteTrade,
}: SavedTradesModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-gray-200 p-4">
          <h2 className="font-mono text-xl font-bold text-gray-800">
            💾 SAVED TRADES
          </h2>
          <button
            onClick={onClose}
            className="text-2xl theme-text-secondary hover:theme-text-primary"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {trades.length === 0 ? (
            <p className="py-8 text-center theme-text-secondary">
              No saved trades yet. Save a trade to see it here!
            </p>
          ) : (
            <div className="space-y-4">
              {trades.map((trade) => {
                const netGain = trade.netDiff;
                const isGoodTrade = Math.abs(netGain) < 5;
                const winner =
                  netGain > 5 ? trade.teamAName : netGain < -5 ? trade.teamBName : null;

                return (
                  <div
                    key={trade.id}
                    className="rounded-lg border-2 border-gray-300 bg-gray-50 p-4 hover:border-blue-500"
                  >
                    {/* Trade Header */}
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h3 className="font-mono font-bold text-gray-800">
                          {trade.tradeName || "Untitled Trade"}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {trade.teamAName} ↔ {trade.teamBName}
                        </p>
                        <p className="text-xs theme-text-secondary">
                          Saved: {new Date(trade.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            onLoadTrade(trade);
                            onClose();
                          }}
                          className="rounded-lg bg-blue-600 px-4 py-2 font-mono text-sm font-bold text-white hover:bg-blue-700"
                        >
                          📂 LOAD
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${trade.tradeName || "Untitled Trade"}"?`)) {
                              onDeleteTrade(trade.id);
                            }
                          }}
                          className="rounded-lg bg-red-600 px-4 py-2 font-mono text-sm font-bold text-white hover:bg-red-700"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {/* Trade Details */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      {/* Team A */}
                      <div>
                        <p className="mb-1 font-bold theme-text-primary">
                          {trade.teamAName} Sends:
                        </p>
                        <p className="text-gray-600">
                          {trade.teamAPlayers.length} player(s)
                          {trade.teamAPicks.length > 0 &&
                            `, ${trade.teamAPicks.length} pick(s)`}
                        </p>
                        <p className="font-mono text-gray-800">
                          Value: {toFixedSafe(trade.teamAValue, 1)}
                        </p>
                      </div>

                      {/* Team B */}
                      <div>
                        <p className="mb-1 font-bold theme-text-primary">
                          {trade.teamBName} Sends:
                        </p>
                        <p className="text-gray-600">
                          {trade.teamBPlayers.length} player(s)
                          {trade.teamBPicks.length > 0 &&
                            `, ${trade.teamBPicks.length} pick(s)`}
                        </p>
                        <p className="font-mono text-gray-800">
                          Value: {toFixedSafe(trade.teamBValue, 1)}
                        </p>
                      </div>
                    </div>

                    {/* Verdict */}
                    <div className="mt-3 rounded-lg bg-white p-2 text-center">
                      {isGoodTrade ? (
                        <p className="font-bold text-green-700 dark:text-green-400">✅ EVEN TRADE</p>
                      ) : winner ? (
                        <p className="font-bold text-red-700 dark:text-red-400">
                          ⚠️ {winner} wins by {toFixedSafe(Math.abs(netGain), 1)} points
                        </p>
                      ) : (
                        <p className="font-bold text-yellow-700">
                          ⚖️ Close ({toFixedSafe(Math.abs(netGain), 1)} pt difference)
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

