"use client";

import { useState } from "react";
import type { TradeSuggestion } from "@/lib/ai/cleanTradeAnalyzer";
import { toFixedSafe } from "@/lib/utils/numberFormat";

interface AISuggestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  suggestions: TradeSuggestion[];
  myTeamName: string;
  onPreviewTrade: (suggestion: TradeSuggestion) => void;
}

/**
 * Client-side validation for trade suggestions
 * SOFT QUALITY PASS: Final safety filter to prevent rendering truly broken suggestions
 */
function isRenderableSuggestion(s: TradeSuggestion, index: number): boolean {
  // Must have a partner team
  if (!s.partnerTeam || !s.partnerTeam.trim()) {
    console.warn(`[UI] Suggestion ${index}: Rejected - Missing partner team. Data:`, JSON.stringify(s, null, 2));
    return false;
  }
  
  // Must have assets on both sides
  if (!s.youGive || s.youGive.length === 0) {
    console.warn(`[UI] Suggestion ${index}: Rejected - No assets given. Data:`, JSON.stringify(s, null, 2));
    return false;
  }
  if (!s.youGet || s.youGet.length === 0) {
    console.warn(`[UI] Suggestion ${index}: Rejected - No assets received. Data:`, JSON.stringify(s, null, 2));
    return false;
  }
  
  // Kill "undefined" in asset names
  const allAssets = [...s.youGive, ...s.youGet];
  for (const asset of allAssets) {
    // Asset must have a name that doesn't contain "undefined"
    if (!asset.name || !asset.name.trim() || asset.name.toLowerCase().includes("undefined")) {
      console.warn(`[UI] Suggestion ${index}: Rejected - Asset name invalid or contains 'undefined'. Asset:`, asset, "Full suggestion:", JSON.stringify(s, null, 2));
      return false;
    }
    
    // Must have a finite value (can be negative, zero, or positive)
    if (!Number.isFinite(asset.value)) {
      console.warn(`[UI] Suggestion ${index}: Rejected - Asset has NaN or Infinity value. Asset:`, asset, "Full suggestion:", JSON.stringify(s, null, 2));
      return false;
    }
  }
  
  // Reject only if BOTH sides are truly worthless (< 5)
  const giveHasValue = s.youGive.some(a => a.value > 5);
  const getHasValue = s.youGet.some(a => a.value > 5);
  
  if (!giveHasValue && !getHasValue) {
    console.warn(`[UI] Suggestion ${index}: Rejected - Both sides have value < 5. Give:`, s.youGive.map(a => `${a.name}=${a.value}`), "Get:", s.youGet.map(a => `${a.name}=${a.value}`));
    return false;
  }
  
  console.log(`[UI] Suggestion ${index}: ✅ PASSED validation - Partner: ${s.partnerTeam}, Net: ${s.netValue}`);
  return true;
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

  // Filter out invalid suggestions before rendering
  console.log("🔥 UI: Received suggestions from API:", suggestions.length);
  console.log("🔥 UI: First suggestion sample:", suggestions[0] ? JSON.stringify(suggestions[0], null, 2) : "No suggestions");
  const validSuggestions = suggestions.filter((s, idx) => isRenderableSuggestion(s, idx));
  console.log("🔥 UI: Renderable suggestions after filtering:", validSuggestions.length);
  
  // If no valid suggestions, show message
  if (validSuggestions.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4">
        <div className="relative w-full max-w-md rounded-lg theme-bg-primary border-4 border-yellow-600 p-8">
          <h2 className="mb-4 font-mono text-xl font-bold text-yellow-600">
            ⚠️ NO VALID SUGGESTIONS
          </h2>
          <p className="mb-4 theme-text-primary">
            {suggestions.length === 0 
              ? "The AI didn't generate any trade candidates. This can happen if there are no mutually beneficial trades available based on your team's needs and other teams' strengths."
              : `All ${suggestions.length} candidate trades failed validation rules. Check the browser console (F12) for details about why suggestions were filtered.`
            }
          </p>
          <button
            onClick={onClose}
            className="w-full rounded bg-purple-600 px-4 py-2 font-bold text-white hover:bg-purple-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const currentSuggestion = validSuggestions[currentIndex];

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
          {validSuggestions.length === 0 ? (
            <p className="text-center theme-text-secondary">No suggestions available</p>
          ) : (
            <>
              {/* Info Message if fewer than 5 suggestions */}
              {validSuggestions.length < 5 && (
                <div className="mb-4 rounded-lg border-2 border-blue-500 bg-blue-50 p-3">
                  <p className="text-sm text-blue-900">
                    <strong>ℹ️ Found {validSuggestions.length} trade suggestion{validSuggestions.length !== 1 ? 's' : ''}.</strong>
                    {validSuggestions.length < 5 && (
                      <span className="ml-2">
                        The AI filtered out trades that were too lopsided (net value difference &gt; 35), unrealistic, or didn't meet quality standards. This ensures only realistic, mutually beneficial trades are shown.
                        {validSuggestions.length === 1 && " Only one trade met all quality criteria. Try adjusting your team's needs or check back later as league dynamics change."}
                        {validSuggestions.length === 2 && " Two realistic trades were identified after filtering. The system prioritizes quality over quantity to show only viable options."}
                        {validSuggestions.length === 3 && " Three viable trades were found. Additional trades may have been filtered for being too lopsided or unrealistic."}
                        {validSuggestions.length === 4 && " Four trades passed validation. The system shows the best available options based on your team's needs."}
                      </span>
                    )}
                  </p>
                </div>
              )}

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
                  Suggestion {currentIndex + 1} of {validSuggestions.length}
                </span>
                <button
                  onClick={() => setCurrentIndex(Math.min(validSuggestions.length - 1, currentIndex + 1))}
                  disabled={currentIndex === validSuggestions.length - 1}
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
                    Trade With: {currentSuggestion.partnerTeam}
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
                          <span className="font-semibold text-red-700 dark:text-red-400">{toFixedSafe(item.value, 1)}</span>
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
                          <span className="font-semibold text-green-700 dark:text-green-400">{toFixedSafe(item.value, 1)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Net Gain */}
                <div className={`rounded-lg border-2 p-4 ${
                  Math.abs(currentSuggestion.netValue) < 5
                    ? "border-yellow-500 bg-yellow-50"
                    : currentSuggestion.netValue > 0
                    ? "border-green-500 bg-green-50"
                    : "border-gray-500 bg-gray-50"
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold">Net Gain:</span>
                    <span className={`text-2xl font-bold ${
                      currentSuggestion.netValue > 0 ? "text-green-700 dark:text-green-400" : "theme-text-primary"
                    }`}>
                      {currentSuggestion.netValue > 0 ? "+" : ""}{toFixedSafe(currentSuggestion.netValue, 1)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">
                    {Math.abs(currentSuggestion.netValue) < 5 
                      ? "⚖️ Fair Trade" 
                      : currentSuggestion.netValue > 0 
                      ? "✅ You Win" 
                      : "You Lose"}
                  </p>
                </div>

                {/* Reasoning */}
                <div className="rounded-lg theme-bg-secondary p-4">
                  <h4 className="mb-2 font-bold theme-text-primary">💡 Why This Works:</h4>
                  <p className="whitespace-pre-line text-sm theme-text-secondary">
                    {currentSuggestion.explanation}
                  </p>
                </div>

                {/* Confidence */}
                <div className="flex items-center justify-center gap-2">
                  <span className="text-sm theme-text-secondary">AI Confidence:</span>
                  <div className="h-4 w-48 rounded-full bg-gray-300">
                    <div
                      className={`h-full rounded-full ${
                        currentSuggestion.confidence === "High"
                          ? "bg-green-500"
                          : currentSuggestion.confidence === "Medium"
                          ? "bg-yellow-500"
                          : "bg-orange-500"
                      }`}
                      style={{ 
                        width: currentSuggestion.confidence === "High" ? "80%" : 
                               currentSuggestion.confidence === "Medium" ? "60%" : 
                               "40%" 
                      }}
                    ></div>
                  </div>
                  <span className={`font-bold ${
                    currentSuggestion.confidence === "High" ? "text-green-700 dark:text-green-400" :
                    currentSuggestion.confidence === "Medium" ? "text-yellow-700" :
                    "text-orange-700"
                  }`}>
                    {currentSuggestion.confidence}
                  </span>
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

