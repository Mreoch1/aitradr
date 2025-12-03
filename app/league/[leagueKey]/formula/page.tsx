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
          Player values use <strong>weighted z-scores</strong> that balance statistical fairness with fantasy market reality. 
          The system reflects how managers actually trade, not just pure category math.
        </p>

        {/* Z-Score Explanation */}
        <div className="mb-8 rounded-lg border-2 border-purple-500 bg-purple-50 p-6">
          <h3 className="mb-3 text-lg font-semibold text-purple-900">How It Works: Weighted Z-Scores</h3>
          <div className="space-y-2 text-sm text-purple-800">
            <p>
              A z-score measures how many standard deviations a player's stat is from the league average. 
              We then apply <strong>market reality weights</strong> because managers don't value all categories equally.
            </p>
            <div className="my-3 rounded bg-white p-3 font-mono text-xs text-gray-700">
              z-score = (player_stat - league_mean) / standard_deviation
            </div>
            <p>
              <strong>Example:</strong> If the league averages 20 goals with std dev of 10:
            </p>
            <ul className="ml-6 list-disc space-y-1">
              <li>30 goals = z-score +1.0 → ×1.5 weight (scoring core) = 1.5 contribution</li>
              <li>20 goals = z-score 0.0 → ×1.5 weight = 0.0 contribution</li>
              <li>100 faceoffs above avg = z-score +1.0 → ×0.7 weight (grind) = 0.7 contribution</li>
            </ul>
            <p className="mt-2">
              <strong>Why weighted?</strong> Pure equal z-scores let grinders (high FW, PIM, HIT) equal 
              elite scorers. Fantasy reality: managers trade for offense first.
            </p>
          </div>
        </div>

        {/* Skaters Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-gray-800">Skaters</h3>
          
          {/* Base Formula */}
          <div className="space-y-3 rounded-lg bg-gray-50 p-4 mb-4">
            <div className="font-mono text-sm text-gray-700">
              <span className="font-semibold">Base Value = (Weighted z-scores × 8) + 100</span>
            </div>
            <div className="text-sm text-gray-600">
              <strong>12 Categories (Yahoo Format - individual weights):</strong>
            </div>
            <div className="space-y-2 text-sm">
              <div className="rounded bg-white p-2">
                <strong className="text-blue-700">Primary Scoring:</strong>
                <div className="ml-4 text-gray-600">Goals (1.5×), Assists (1.3×), Points (0.7×), PPP (1.2×), SOG (1.3×)</div>
              </div>
              <div className="rounded bg-white p-2">
                <strong className="text-green-700">Supporting Stats:</strong>
                <div className="ml-4 text-gray-600">Plus/Minus (1.0×), Shorthanded Points (1.0×), GWG (1.0×)</div>
              </div>
              <div className="rounded bg-white p-2">
                <strong className="text-gray-700">Grind Stats:</strong>
                <div className="ml-4 text-gray-600">PIM (0.7×), Faceoffs Won (0.7×), Hits (0.6×), Blocks (0.6×)</div>
                <div className="ml-4 mt-1 text-xs text-gray-500">Grind stats capped at 40% of total value to prevent grinders outranking stars</div>
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              <strong>Note:</strong> Points (G+A) is weighted lower (0.7×) to avoid double-counting with Goals and Assists while still reflecting Yahoo's separate P category.
            </div>
          </div>
          
          {/* Market Adjustments */}
          <div className="space-y-3 rounded-lg bg-blue-50 border-2 border-blue-500 p-4 mb-4">
            <h4 className="font-semibold text-blue-900">Market Reality Adjustments</h4>
            <div className="space-y-2 text-sm text-blue-800">
              <div><strong>Position Multipliers:</strong> LW ×1.08, RW ×1.04, C ×0.96, D ×1.10 (or ×0.92 if non-elite)</div>
              <div><strong>Star Multipliers:</strong> 40+ points ×1.12, 30+ points ×1.08, 22+ points ×1.04</div>
              <div><strong>Franchise Floor:</strong> Elite scorers (38+ points or 25+ assists) minimum 160</div>
              <div><strong>Superstar Floor:</strong> Strong scorers (30+ points) minimum 145</div>
              <div><strong>Scorer Floor:</strong> Any scoring threat (20+ points) minimum 115</div>
              <div><strong>Reputation Bias:</strong> Proven elite players (40+ points) +4 bonus</div>
              <div><strong>Final Clamp:</strong> Values clamped 45-165 base (allows +10 overflow to 175)</div>
            </div>
          </div>
          
          <div className="text-sm text-gray-600 space-y-2">
            <p>
              <strong>Why weighted buckets?</strong> Pure equal-weight z-scores ignore fantasy market reality. 
              Managers trade for goals and offense, not faceoffs. This system reflects actual trade behavior 
              while maintaining statistical fairness.
            </p>
            <p>
              <strong>Typical ranges:</strong> Franchise (165-175), Star (145-165), Solid (115-145), Depth (75-115), Replacement (45-75)
            </p>
          </div>
        </div>

        {/* Goalies Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-gray-800">Goalies</h3>
          <div className="space-y-3 rounded-lg bg-gray-50 p-4">
            <div className="font-mono text-sm text-gray-700">
              <span className="font-semibold">Value = (Sum of 5 category z-scores × 8 + 100) × Reliability × Workload</span>
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
            <div className="mt-3 space-y-3">
              <div className="rounded bg-white p-3 text-sm text-gray-700">
                <strong>Reliability Factor (Sample Size):</strong>
                <div className="mt-2 font-mono text-xs">
                  reliability = √(min(1, games_started / 5))
                </div>
                <div className="mt-2 text-gray-600">
                  Goalies with 5+ starts = 100% reliable. Prevents small-sample flukes.
                </div>
              </div>
              <div className="rounded bg-white p-3 text-sm text-gray-700">
                <strong>Workload Bonus (Starter Premium):</strong>
                <div className="mt-2 font-mono text-xs">
                  workload = min(1.15, 1.0 + (decisions / 33) × 0.25)
                </div>
                <div className="mt-2 text-gray-600">
                  Workhorses get up to 15% bonus. Separates true starters from efficiency-only backups.
                </div>
              </div>
            </div>
            <div className="mt-3 text-sm text-gray-600">
              <strong>Final Clamp:</strong> 50-155 base (allows +5 overflow)
            </div>
          </div>
        </div>

        {/* Keeper Economics */}
        <div className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-gray-800">Keeper Economics (3-Year System)</h3>
          <div className="space-y-3 rounded-lg bg-purple-50 border-2 border-purple-500 p-4">
            <div className="font-mono text-sm text-gray-700">
              <span className="font-semibold">Keeper Value = Base Value + Keeper Bonus</span>
            </div>
            <div className="space-y-2 text-sm text-purple-800">
              <div className="rounded bg-white p-3">
                <strong>Keeper Bonus Formula:</strong>
                <div className="mt-2 font-mono text-xs text-gray-700">
                  surplus = max(0, playerValue - draftRoundAvg)
                  <br />
                  bonus = surplus × (yearsRemaining / 3)
                </div>
                <div className="mt-2 text-gray-600 text-xs">
                  Late-round elites (Celebrini R14, value 168) have massive surplus vs early picks (McDavid R1).
                </div>
              </div>
              <div className="rounded bg-white p-3">
                <strong className="text-blue-700">Natural Decay (No Additional Penalty):</strong>
                <div className="mt-2 font-mono text-xs text-gray-700">
                  keeperValue = baseValue + keeperBonus<br />
                  (no × 0.75 multiplier)
                </div>
                <div className="mt-2 text-gray-600 text-xs">
                  The yearsRemaining/3 factor already handles decay. Last-year keepers are still premium assets.
                </div>
              </div>
              <div className="rounded bg-white p-3">
                <strong>Tier Restrictions:</strong>
                <ul className="mt-2 text-xs text-gray-700 list-disc ml-5 space-y-1">
                  <li><strong>Tier A (R1-4):</strong> Can only keep in R1-4, cannot move down</li>
                  <li><strong>Tier B (R5-10):</strong> Must stay in R5-10, cannot enter Tier A</li>
                  <li><strong>Tier C (R11-16):</strong> Must stay in R11-16, cannot enter A or B</li>
                  <li><strong>Round 1 Block:</strong> No keepers can occupy R1</li>
                </ul>
              </div>
            </div>
            <div className="mt-3 text-sm text-purple-900">
              <strong>Example:</strong> Celebrini (R14, Year 2, 1 yr left):
              <br />Base 168 + Bonus 36 = <strong>204 final</strong> (no expiration penalty)
            </div>
          </div>
        </div>

        {/* Draft Picks Note */}
        <div className="rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4">
          <p className="text-sm text-blue-900">
            <strong>Draft Pick Values:</strong> Calculated dynamically based on average player values 
            in corresponding tiers. Round 1 ≈ 160-170, Round 16 ≈ 45. 
            Floors applied to prevent negative values for late rounds.
          </p>
        </div>
        
        {/* Category-Aware Trading */}
        <div className="mt-6 rounded-lg border-l-4 border-green-500 bg-green-50 p-4">
          <div className="text-sm text-green-900 space-y-2">
            <p>
              <strong>AI Trade Suggestions:</strong> The AI analyzes your team's category strengths 
              and weaknesses (not just positions) to suggest trades that improve your weak stats.
            </p>
            <p>
              <strong>Trade Score Formula:</strong> valueDelta × 1.0 + categoryGain × 2.5 + keeperImpact
            </p>
            <p>
              <strong>Elite Protection:</strong> Players valued 155+ cannot be traded for greater than 10% downgrades. 
              No "Celebrini for Tom Wilson" suggestions.
            </p>
            <p>
              <strong>Bad Trade Blocker:</strong> Net loss over 10 points requires categoryGain of 15+ or strong keeper justification.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

