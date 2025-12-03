import Link from "next/link";

export default async function FormulaPage({
  params,
}: {
  params: Promise<{ leagueKey: string }>;
}) {
  const { leagueKey } = await params;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* Mooninites Header */}
      <div className="mb-8 rounded-lg bg-gradient-to-r from-purple-600 via-green-500 to-purple-600 p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img
              src="/mooninites.png"
              alt="Mooninites"
              className="h-16 w-auto pixelated"
            />
            <div>
              <div className="font-mono text-sm">BROUGHT TO YOU BY</div>
              <div className="font-mono text-2xl font-bold">THE MOONINITES</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm">VALUE FORMULAS</div>
          </div>
        </div>
      </div>

      {/* Back Link */}
      <div className="mb-6">
        <Link
          href={`/league/${leagueKey}/trade`}
          className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800"
        >
          ← Back to Trade Builder
        </Link>
      </div>

      {/* Value Calculation Formula */}
      <div className="rounded-lg bg-white p-8 shadow-md">
        <h2 className="mb-6 text-2xl font-bold text-gray-900">
          Value Calculation Formula
        </h2>
        
        <p className="mb-6 text-gray-700">
          Player values are calculated using <strong>z-scores</strong> to mirror Yahoo's H2H categories scoring. 
          This ensures fair, unbiased rankings across all fantasy-relevant stats.
        </p>

        {/* Z-Score Explanation */}
        <div className="mb-8 rounded-lg border-2 border-purple-500 bg-purple-50 p-6">
          <h3 className="mb-3 text-lg font-semibold text-purple-900">What is a Z-Score?</h3>
          <div className="space-y-2 text-sm text-purple-800">
            <p>
              A z-score measures how many standard deviations a player's stat is from the league average.
            </p>
            <div className="my-3 rounded bg-white p-3 font-mono text-xs text-gray-700">
              z-score = (player_stat - league_mean) / standard_deviation
            </div>
            <p>
              <strong>Example:</strong> If the league averages 20 goals with a standard deviation of 10:
            </p>
            <ul className="ml-6 list-disc space-y-1">
              <li>30 goals = z-score of +1.0 (above average)</li>
              <li>20 goals = z-score of 0.0 (average)</li>
              <li>10 goals = z-score of -1.0 (below average)</li>
            </ul>
          </div>
        </div>

        {/* Skaters Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-gray-800">Skaters</h3>
          <div className="space-y-3 rounded-lg bg-gray-50 p-4">
            <div className="font-mono text-sm text-gray-700">
              <span className="font-semibold">Value = (Sum of 11 category z-scores × 10) + 100</span>
            </div>
            <div className="text-sm text-gray-600">
              <strong>11 Categories (equal weight):</strong>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
              <div>• Goals</div>
              <div>• Assists</div>
              <div>• Plus/Minus</div>
              <div>• Penalty Minutes</div>
              <div>• Powerplay Points</div>
              <div>• Shorthanded Points</div>
              <div>• Game Winning Goals</div>
              <div>• Shots on Goal</div>
              <div>• Faceoffs Won</div>
              <div>• Hits</div>
              <div>• Blocks</div>
            </div>
          </div>
          <div className="mt-3 space-y-2 text-sm text-gray-600">
            <p>
              <strong>Why z-scores?</strong> Unlike arbitrary weights, z-scores treat each category fairly 
              and automatically adjust for your league's specific player pool.
            </p>
            <p>
              <strong>Typical ranges:</strong> Elite players (140+), Top tier (110-139), Mid tier (80-109), Depth (50-79)
            </p>
          </div>
        </div>

        {/* Goalies Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-gray-800">Goalies</h3>
          <div className="space-y-3 rounded-lg bg-gray-50 p-4">
            <div className="font-mono text-sm text-gray-700">
              <span className="font-semibold">Value = (Sum of 5 category z-scores × 10 + 100) × Reliability</span>
            </div>
            <div className="text-sm text-gray-600">
              <strong>5 Categories (equal weight):</strong>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
              <div>• Wins</div>
              <div>• Goals Against Average (inverted)</div>
              <div>• Saves</div>
              <div>• Save Percentage</div>
              <div>• Shutouts</div>
            </div>
            <div className="mt-3 rounded bg-white p-3 text-sm text-gray-700">
              <strong>Reliability Factor:</strong>
              <div className="mt-2 font-mono text-xs">
                reliability = √(min(1, games_started / 5))
              </div>
              <div className="mt-2 text-gray-600">
                Reduces impact of small sample sizes. Goalies with 5+ starts = 100% reliable.
                This prevents fluky 2-game hot streaks from dominating rankings while still 
                recognizing legitimate early-season breakouts.
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-2 text-sm text-gray-600">
            <p>
              <strong>Why the reliability curve?</strong> A goalie with 2 wins in 2 games shouldn't 
              be valued higher than a starter with 15 wins in 20 games. The square root curve 
              balances opportunity with proven performance.
            </p>
          </div>
        </div>

        {/* Draft Picks Note */}
        <div className="rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4">
          <p className="text-sm text-blue-900">
            <strong>Draft Pick Values:</strong> Calculated dynamically based on average player values 
            in corresponding tiers. Round 1 = average of top 12 players, Round 2 = next 12, etc. 
            This ensures picks reflect actual expected return in your specific league.
          </p>
        </div>
        
        {/* Category-Aware Trading */}
        <div className="mt-6 rounded-lg border-l-4 border-green-500 bg-green-50 p-4">
          <p className="text-sm text-green-900">
            <strong>AI Trade Suggestions:</strong> The AI analyzes your team's category strengths 
            and weaknesses (not just positions) to suggest trades that improve your weak stats 
            while maintaining fair value. A trade that loses 5 points but gains +20 blocks may be 
            ranked higher than a +10 point trade with no category impact.
          </p>
        </div>
      </div>
    </div>
  );
}

