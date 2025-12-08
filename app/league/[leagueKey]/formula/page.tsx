import Link from "next/link";
import SyncHistoricalStatsButton from "@/app/components/SyncHistoricalStatsButton";

export default async function FormulaPage({
  params,
}: {
  params: Promise<{ leagueKey: string }>;
}) {
  const { leagueKey } = await params;

  return (
    <div className="min-h-screen theme-bg-primary p-8">
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
          className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Back to Trade Builder
        </Link>
      </div>

      {/* Value Calculation Formula */}
      <div className="rounded-lg theme-bg-secondary p-8 shadow-md">
        <h2 className="mb-6 text-2xl font-bold theme-text-primary">
          Value Calculation Formula
        </h2>
        
        {/* Historical Stats Notification */}
        <div className="mb-6 rounded-lg border-2 border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 p-4">
          <div className="flex items-start gap-3">
            <div className="text-2xl">📊</div>
            <div className="flex-1">
              <h3 className="mb-2 font-semibold text-blue-900 dark:text-blue-200">
                Historical Stats Integration
              </h3>
              <p className="mb-3 text-sm text-blue-800 dark:text-blue-300">
                Player values now incorporate the last 2 seasons of historical statistics from the NHL API. 
                Current season stats are weighted 70% and historical average (last 2 years) is weighted 30% 
                to provide more stable and reliable valuations. This helps identify consistent performers 
                and reduces volatility from small sample sizes or hot streaks.
              </p>
              <SyncHistoricalStatsButton leagueKey={leagueKey} />
            </div>
          </div>
        </div>
        
        <p className="mb-6 theme-text-secondary">
          Player values use <strong>weighted z-scores</strong> that balance statistical fairness with fantasy market reality. 
          The system reflects how managers actually trade, not just pure category math.
        </p>

        {/* Z-Score Explanation */}
        <div className="mb-8 rounded-lg border-2 border-purple-500 dark:border-purple-400 bg-purple-50 dark:bg-purple-900/20 p-6">
          <h3 className="mb-3 text-lg font-semibold text-purple-900 dark:text-purple-200">How It Works: Weighted Z-Scores</h3>
          <div className="space-y-2 text-sm text-purple-800 dark:text-purple-200">
            <p>
              A z-score measures how many standard deviations a player's stat is from the league average. 
              We then apply <strong>market reality weights</strong> because managers don't value all categories equally.
            </p>
            <div className="my-3 rounded theme-bg-secondary p-3 font-mono text-xs theme-text-secondary">
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
          <h3 className="mb-4 text-xl font-semibold theme-text-primary">Skaters</h3>
          
          {/* Base Formula */}
          <div className="space-y-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 p-4 mb-4">
            <div className="font-mono text-sm theme-text-secondary">
              <span className="font-semibold">Base Value = (Weighted z-scores × 8) + 100</span>
            </div>
            <div className="text-sm theme-text-secondary">
              <strong>12 Categories (Yahoo Format - individual weights):</strong>
            </div>
            <div className="space-y-2 text-sm">
              <div className="rounded theme-bg-secondary p-2">
                <strong className="text-blue-700 dark:text-blue-400">Primary Scoring:</strong>
                <div className="ml-4 theme-text-secondary">Goals (1.5×), Assists (1.3×), Points (0.7×), PPP (1.2×), SOG (1.3×)</div>
              </div>
              <div className="rounded theme-bg-secondary p-2">
                <strong className="text-green-700 dark:text-green-400">Supporting Stats:</strong>
                <div className="ml-4 theme-text-secondary">Plus/Minus (1.0×), Shorthanded Points (1.0×), GWG (1.0×)</div>
              </div>
              <div className="rounded theme-bg-secondary p-2">
                <strong className="theme-text-primary">Grind Stats:</strong>
                <div className="ml-4 theme-text-secondary">PIM (0.7×), Faceoffs Won (0.7×), Hits (0.6×), Blocks (0.6×)</div>
                <div className="ml-4 mt-1 text-xs theme-text-secondary opacity-75">Grind stats capped at 40% of total value to prevent grinders outranking stars</div>
              </div>
            </div>
            <div className="mt-2 text-xs theme-text-secondary opacity-75">
              <strong>Note:</strong> Points (G+A) is weighted lower (0.7×) to avoid double-counting with Goals and Assists while still reflecting Yahoo's separate P category.
            </div>
          </div>
          
          {/* Market Adjustments */}
          <div className="space-y-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-500 dark:border-blue-400 p-4 mb-4">
            <h4 className="font-semibold text-blue-900 dark:text-blue-200">Market Reality Adjustments</h4>
            <div className="space-y-2 text-sm text-blue-800 dark:text-blue-200">
              <div><strong>Position Multipliers:</strong> LW ×1.08, RW ×1.04, C ×0.96, D ×1.10 (or ×0.92 if non-elite)</div>
              <div><strong>Star Multipliers:</strong> 40+ points ×1.12, 30+ points ×1.08, 22+ points ×1.04</div>
              <div><strong>Franchise Floor:</strong> Elite scorers (38+ points or 25+ assists) minimum 160</div>
              <div><strong>Superstar Floor:</strong> Strong scorers (30+ points) minimum 145</div>
              <div><strong>Scorer Floor:</strong> Any scoring threat (20+ points) minimum 115</div>
              <div><strong>Reputation Bias:</strong> Proven elite players (40+ points) +4 bonus</div>
              <div><strong>Final Clamp:</strong> Values clamped 45-165 base (allows +10 overflow to 175)</div>
            </div>
          </div>
          
          <div className="text-sm theme-text-secondary space-y-2">
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
          <h3 className="mb-4 text-xl font-semibold theme-text-primary">Goalies</h3>
          <div className="space-y-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 p-4">
            <div className="font-mono text-sm theme-text-secondary">
              <span className="font-semibold">Value = (Sum of 5 category z-scores × 8 + 100) × Reliability × Workload</span>
            </div>
            <div className="text-sm theme-text-secondary">
              <strong>5 Categories (equal weight):</strong>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm theme-text-secondary">
              <div>• Wins</div>
              <div>• Goals Against Average (inverted)</div>
              <div>• Saves</div>
              <div>• Save Percentage</div>
              <div>• Shutouts</div>
            </div>
            <div className="mt-3 space-y-3">
              <div className="rounded theme-bg-secondary p-3 text-sm theme-text-secondary">
                <strong>Reliability Factor (Sample Size):</strong>
                <div className="mt-2 font-mono text-xs">
                  reliability = √(min(1, games_started / 5))
                </div>
                <div className="mt-2 theme-text-secondary opacity-90">
                  Goalies with 5+ starts = 100% reliable. Prevents small-sample flukes.
                </div>
              </div>
              <div className="rounded theme-bg-secondary p-3 text-sm theme-text-secondary">
                <strong>Workload Bonus (Starter Premium):</strong>
                <div className="mt-2 font-mono text-xs">
                  workload = min(1.15, 1.0 + (decisions / 33) × 0.25)
                </div>
                <div className="mt-2 theme-text-secondary opacity-90">
                  Workhorses get up to 15% bonus. Separates true starters from efficiency-only backups.
                </div>
              </div>
            </div>
            <div className="mt-3 text-sm theme-text-secondary">
              <strong>Final Clamp:</strong> 50-155 base (allows +5 overflow)
            </div>
          </div>
        </div>

        {/* Keeper Economics */}
        <div className="mb-8">
          <h3 className="mb-4 text-xl font-semibold theme-text-primary">Keeper Economics (3-Year System)</h3>
          <div className="space-y-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-500 dark:border-purple-400 p-4">
            <div className="font-mono text-sm theme-text-secondary">
              <span className="font-semibold">Keeper Value = Base Value + Keeper Bonus</span>
            </div>
            <div className="space-y-2 text-sm text-purple-800 dark:text-purple-200">
              <div className="rounded theme-bg-secondary p-3">
                <strong>Part A: Surplus Bonus (Underdraft Value):</strong>
                <div className="mt-2 font-mono text-xs theme-text-secondary">
                  surplus = max(0, playerValue - draftRoundAvg)<br />
                  cappedSurplus = min(surplus, tierCap)<br />
                  surplusBonus = cappedSurplus × surplusWeight[years]
                </div>
                <div className="mt-2 theme-text-secondary opacity-90 text-xs">
                  <strong>Surplus Weights:</strong> 1yr=0.45x, 2yr=0.75x, 3yr=1.00x<br />
                  <strong>Tier Caps:</strong> A=25, B=35, C=40 (conservative to prevent over-inflation)
                </div>
              </div>
              <div className="rounded theme-bg-secondary p-3">
                <strong className="text-blue-700 dark:text-blue-400">Part B: Control Premium (Multi-Year Elite Control):</strong>
                <div className="mt-2 font-mono text-xs theme-text-secondary">
                  tier = Generational (172+), Franchise (160+), Star (150+), Core (135+), Normal<br />
                  controlBonus = CONTROL_PREMIUM[tier][yearsRemaining]
                </div>
                <div className="mt-2 theme-text-secondary opacity-90 text-xs">
                  <strong>Control Premium Table:</strong><br />
                  Generational: [0, 20, 45, 70] | Franchise: [0, 14, 32, 50]<br />
                  Star: [0, 10, 22, 34] | Core: [0, 5, 12, 18] | Normal: [0, 0, 0, 0]<br />
                  <em>Steeper progression for true generational talents (McDavid, MacKinnon).</em>
                </div>
              </div>
              <div className="rounded theme-bg-secondary p-3">
                <strong className="text-green-700 dark:text-green-400">Part C: Tier Caps + Trade Weight:</strong>
                <div className="mt-2 font-mono text-xs theme-text-secondary">
                  keeperBonus = min(surplusBonus + controlBonus, tierCap)<br />
                  tradeBonus = keeperBonus × 0.40<br />
                  tradeValue = baseValue + tradeBonus
                </div>
                <div className="mt-2 theme-text-secondary opacity-90 text-xs">
                  <strong>Tier Bonus Caps:</strong> Gen:70, Fran:50, Star:34, Core:22, Normal:15<br />
                  <strong>Final Value Caps:</strong> Gen:250, Fran:230, Star:190, Core:175, Normal:165<br />
                  <strong>40% Trade Weight:</strong> Full bonus shown in UI (+K badge), but only 40% applied to trades.<br />
                  <em>Prevents late-round steals from overtaking raw talent.</em>
                </div>
              </div>
              <div className="rounded theme-bg-secondary p-3">
                <strong>Tier Restrictions:</strong>
                <ul className="mt-2 text-xs theme-text-secondary list-disc ml-5 space-y-1">
                  <li><strong>Tier A (R1-4):</strong> Can only keep in R1-4, cannot move down</li>
                  <li><strong>Tier B (R5-10):</strong> Must stay in R5-10, cannot enter Tier A</li>
                  <li><strong>Tier C (R11-16):</strong> Must stay in R11-16, cannot enter A or B</li>
                  <li><strong>Round 1 Block:</strong> No keepers can occupy R1</li>
                </ul>
              </div>
            </div>
            <div className="mt-3 space-y-2 text-sm text-purple-900 dark:text-purple-200">
              <div>
                <strong>Ex 1 - Celebrini (R14, 1yr, base 168, Star tier):</strong><br />
                Display Bonus: 18+7=25 | Trade Bonus: 25×0.40=10<br />
                <strong>Trade Value: 168 + 10 = ~178</strong>
              </div>
              <div>
                <strong>Ex 2 - Reinhart (R9, 2yr, base 148, Star tier):</strong><br />
                Display Bonus: 26+22=48 (capped at 34) | Trade: 34×0.40=14<br />
                <strong>Trade Value: 148 + 14 = ~162</strong>
              </div>
              <div>
                <strong>Ex 3 - McDavid (R1, 3yr, base 160, Generational tier):</strong><br />
                Display Bonus: 0+70=70 | Trade: 70×0.40=28<br />
                <strong>Trade Value: 160 + 28 = ~188</strong>
              </div>
              <div className="text-xs text-purple-700 dark:text-purple-300 mt-2">
                <em>40% trade weight prevents keeper economics from overtaking raw talent. McDavid (188) &gt; Celebrini (178) &gt; Reinhart (162).</em>
              </div>
            </div>
          </div>
        </div>

        {/* Draft Picks Note */}
        <div className="rounded-lg border-l-4 border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 p-4">
          <p className="text-sm text-blue-900 dark:text-blue-200">
            <strong>Draft Pick Values:</strong> Calculated dynamically based on average player values 
            in corresponding tiers. Round 1 ≈ 160-170, Round 16 ≈ 45. 
            Floors applied to prevent negative values for late rounds.
          </p>
        </div>
        
        {/* Category-Aware Trading */}
        <div className="mt-6 rounded-lg border-l-4 border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/20 p-4">
          <div className="text-sm text-green-900 dark:text-green-200 space-y-2">
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

