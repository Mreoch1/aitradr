"use client";

import { useState } from "react";
import type { TradeSuggestion } from "@/lib/ai/tradeAnalyzer";
import { toFixedSafe } from "@/lib/utils/numberFormat";

interface AISuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  suggestions: TradeSuggestion[];
  myTeamName: string;
  onPreviewTrade: (suggestion: TradeSuggestion) => void;
}

export function AISuggestionsModal({
  isOpen,
  onClose,
  suggestions,
  myTeamName,
  onPreviewTrade,
}: AISuggestionsModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (!isOpen) return null;

  const currentSuggestion = suggestions[currentIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4">
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg theme-bg-primary border-4 border-purple-600 shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-purple-600 to-green-500 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="font-mono text-2xl font-bold text-white">
              🤖 AI TRADE SUGGESTIONS
            </h2>
            <button
              onClick={onClose}
              className="rounded bg-red-600 px-3 py-1 text-sm font-bold text-white hover:bg-red-700"
            >
              ✕ Close
            </button>
          </div>
          <p className="mt-2 font-mono text-sm text-white">
            For: {myTeamName}
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {suggestions.length === 0 ? (
            <p className="text-center theme-text-secondary">No suggestions available</p>
          ) : (
            <>
              {/* Navigation */}
              <div className="mb-4 flex items-center justify-between">
                <button
                  onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  className="rounded bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-400"
                >
                  ← Previous
                </button>
                <span className="font-mono theme-text-primary">
                  Suggestion {currentIndex + 1} of {suggestions.length}
                </span>
                <button
                  onClick={() => setCurrentIndex(Math.min(suggestions.length - 1, currentIndex + 1))}
                  disabled={currentIndex === suggestions.length - 1}
                  className="rounded bg-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-400"
                >
                  Next →
                </button>
              </div>

              {/* Current Suggestion */}
              <div className="space-y-6">
                {/* Trade Partner */}
                <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4">
                  <h3 className="font-bold text-blue-900">
                    Trade With: {currentSuggestion.tradeWithTeam}
                  </h3>
                </div>

                {/* Trade Details */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* You Give */}
                  <div className="rounded-lg border-2 border-red-500 bg-red-50 p-4">
                    <h4 className="mb-3 font-bold text-red-900">⬆️ You Give</h4>
                    <div className="space-y-2">
                      {currentSuggestion.youGive.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-sm">
                          <span className="text-red-800">
                            {item.type === "player" ? item.name : `Round ${item.name} Pick`}
                          </span>
                          <span className="font-semibold text-red-700">{toFixedSafe(item.value, 1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* You Get */}
                  <div className="rounded-lg border-2 border-green-500 bg-green-50 p-4">
                    <h4 className="mb-3 font-bold text-green-900">⬇️ You Get</h4>
                    <div className="space-y-2">
                      {currentSuggestion.youGet.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-sm">
                          <span className="text-green-800">
                            {item.type === "player" ? item.name : `Round ${item.name} Pick`}
                          </span>
                          <span className="font-semibold text-green-700">{toFixedSafe(item.value, 1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Net Gain */}
                <div className={`rounded-lg border-2 p-4 ${
                  Math.abs(currentSuggestion.netGain) < 5
                    ? "border-yellow-500 bg-yellow-50"
                    : currentSuggestion.netGain > 0
                    ? "border-green-500 bg-green-50"
                    : "border-gray-500 bg-gray-50"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">Net Gain:</span>
                    <span className={`text-2xl font-bold ${
                      currentSuggestion.netGain > 0 ? "text-green-700" : "text-gray-700"
                    }`}>
                      {currentSuggestion.netGain > 0 ? "+" : ""}{toFixedSafe(currentSuggestion.netGain, 1)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">
                    {Math.abs(currentSuggestion.netGain) < 5 
                      ? "⚖️ Fair Trade" 
                      : currentSuggestion.netGain > 0 
                      ? "✅ You Win" 
                      : "You Lose"}
                  </p>
                </div>

                {/* Reasoning */}
                <div className="rounded-lg theme-bg-secondary p-4">
                  <h4 className="mb-2 font-bold theme-text-primary">💡 Why This Works:</h4>
                  <p className="whitespace-pre-line text-sm theme-text-secondary">
                    {currentSuggestion.reasoning}
                  </p>
                </div>

                {/* Confidence */}
                <div className="flex items-center justify-center gap-2">
                  <span className="text-sm theme-text-secondary">AI Confidence:</span>
                  <div className="h-4 w-48 rounded-full bg-gray-300">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-green-500 to-purple-500"
                      style={{ width: `${currentSuggestion.confidence}%` }}
                    ></div>
                  </div>
                  <span className="font-bold theme-text-primary">{currentSuggestion.confidence}%</span>
                </div>

                {/* Action Button */}
                <button
                  onClick={() => {
                    onPreviewTrade(currentSuggestion);
                    onClose();
                  }}
                  className="w-full rounded-lg bg-gradient-to-r from-purple-600 to-green-500 py-4 font-mono text-lg font-bold text-white hover:from-purple-700 hover:to-green-600"
                >
                  👁️ PREVIEW THIS TRADE
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

