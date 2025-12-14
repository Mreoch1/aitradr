"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

interface PlayerSearchResult {
  playerId: string;
  name: string;
  nhlTeam: string;
  position: string;
  valueScore: number;
  teamName: string;
  isOnRoster: boolean;
  matchScore: number;
  matchedCategories: number;
  categoryScores: Record<string, number>;
  allStats: Array<{ name: string; value: number }>;
}

interface PlayerSearchResponse {
  ok: boolean;
  results: PlayerSearchResult[];
  requestedCategories: string[];
  totalFound: number;
  error?: string;
}

const AVAILABLE_CATEGORIES = [
  { value: "goals", label: "Goals", abbrev: "G" },
  { value: "assists", label: "Assists", abbrev: "A" },
  { value: "points", label: "Points", abbrev: "P" },
  { value: "plus/minus", label: "Plus/Minus", abbrev: "+/-" },
  { value: "penalty minutes", label: "Penalty Minutes", abbrev: "PIM" },
  { value: "power play points", label: "Power Play Points", abbrev: "PPP" },
  { value: "short handed points", label: "Short Handed Points", abbrev: "SHP" },
  { value: "game winning goals", label: "Game Winning Goals", abbrev: "GWG" },
  { value: "shots on goal", label: "Shots on Goal", abbrev: "SOG" },
  { value: "faceoffs won", label: "Faceoffs Won", abbrev: "FW" },
  { value: "hits", label: "Hits", abbrev: "HIT" },
  { value: "blocked shots", label: "Blocked Shots", abbrev: "BLK" },
  { value: "wins", label: "Wins", abbrev: "W" },
  { value: "goals against average", label: "Goals Against Average", abbrev: "GAA" },
  { value: "saves", label: "Saves", abbrev: "SV" },
  { value: "save percentage", label: "Save Percentage", abbrev: "SV%" },
  { value: "shutouts", label: "Shutouts", abbrev: "SHO" },
];

export function PlayerSearch() {
  const params = useParams();
  const leagueKey = params.leagueKey as string;

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [requestedCategories, setRequestedCategories] = useState<string[]>([]);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const handleSearch = async () => {
    if (selectedCategories.length === 0) {
      setError("Please select at least one category");
      return;
    }

    setIsSearching(true);
    setError(null);
    setResults([]);

    try {
      const categoriesParam = selectedCategories.join(",");
      const response = await fetch(
        `/api/league/${encodeURIComponent(leagueKey)}/player-search?categories=${encodeURIComponent(categoriesParam)}&limit=5`
      );

      const data: PlayerSearchResponse = await response.json();

      if (!data.ok) {
        throw new Error(data.error || "Search failed");
      }

      setResults(data.results);
      setRequestedCategories(data.requestedCategories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSearching(false);
    }
  };

  const formatStatValue = (value: number): string => {
    if (value >= 1000) {
      return value.toFixed(0);
    }
    if (value >= 100) {
      return value.toFixed(1);
    }
    return value.toFixed(2);
  };

  const getCategoryLabel = (category: string): string => {
    const found = AVAILABLE_CATEGORIES.find((c) => c.value === category);
    return found?.abbrev || category;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
          Find Players by Category
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Select categories your team needs help with, and we'll find the top players who excel in those areas.
        </p>

        {/* Category Selection */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Select Categories:
          </label>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_CATEGORIES.map((category) => (
              <button
                key={category.value}
                type="button"
                onClick={() => toggleCategory(category.value)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  selectedCategories.includes(category.value)
                    ? "bg-blue-600 text-white dark:bg-blue-500"
                    : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search Button */}
        <button
          onClick={handleSearch}
          disabled={isSearching || selectedCategories.length === 0}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isSearching ? "Searching..." : "Search Players"}
        </button>

        {error && (
          <div className="mt-3 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <h4 className="text-md font-semibold mb-3 text-gray-900 dark:text-gray-100">
            Top {results.length} Players for: {requestedCategories.map(getCategoryLabel).join(", ")}
          </h4>
          <div className="space-y-3">
            {results.map((player, index) => (
              <div
                key={player.playerId}
                className="border border-gray-200 dark:border-gray-700 rounded-md p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {index + 1}. {player.name}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                        {player.position}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-500">
                        {player.nhlTeam}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {player.isOnRoster ? (
                        <span className="text-orange-600 dark:text-orange-400">
                          On {player.teamName}
                        </span>
                      ) : (
                        <span className="text-green-600 dark:text-green-400">Free Agent</span>
                      )}
                      {" • "}
                      Value: {player.valueScore.toFixed(1)}
                    </div>
                  </div>
                </div>

                {/* Category Scores */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {requestedCategories.map((category) => {
                    const score = player.categoryScores[category];
                    if (score === undefined) return null;
                    return (
                      <div
                        key={category}
                        className="text-xs px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                      >
                        <span className="font-medium">{getCategoryLabel(category)}:</span>{" "}
                        {formatStatValue(score)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

