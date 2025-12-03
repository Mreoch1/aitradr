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

        {/* Skaters Section */}
        <div className="mb-8">
          <h3 className="mb-4 text-xl font-semibold text-gray-800">Skaters</h3>
          <div className="space-y-2 rounded-lg bg-gray-50 p-4 font-mono text-sm">
            <div className="text-gray-700">
              <span className="font-semibold">Value =</span>
            </div>
            <div className="ml-4 space-y-1 text-gray-600">
              <div>(Goals × 4.0)</div>
              <div>+ (Assists × 3.0)</div>
              <div>+ (Plus/Minus × 0.5)</div>
              <div>+ (Penalty Minutes × 0.3)</div>
              <div>+ (Power Play Points × 1.0)</div>
              <div>+ (Short Handed Points × 2.0)</div>
              <div>+ (Game Winning Goals × 1.5)</div>
              <div>+ (Shots on Goal × 0.2)</div>
              <div>+ (Faceoffs Won × 0.1)</div>
              <div>+ (Hits × 0.15)</div>
              <div>+ (Blocks × 0.25)</div>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-600">
            Higher weights for goals, assists, and special teams production. Secondary
            stats like hits and blocks provide additional value.
          </p>
        </div>

        {/* Goalies Section */}
        <div>
          <h3 className="mb-4 text-xl font-semibold text-gray-800">Goalies</h3>
          <div className="space-y-2 rounded-lg bg-gray-50 p-4 font-mono text-sm">
            <div className="text-gray-700">
              <span className="font-semibold">Value =</span>
            </div>
            <div className="ml-4 space-y-1 text-gray-600">
              <div>(Wins × 2.0)</div>
              <div>+ (Saves × 0.08)</div>
              <div>+ (Save % × 200)</div>
              <div>+ (Shutouts × 3.0)</div>
              <div>- (Losses × 0.5)</div>
              <div>- (Goals Against × 0.3)</div>
            </div>
          </div>
          <p className="mt-3 text-sm text-gray-600">
            Goalie values are weighted lower than elite skaters to align with overall
            fantasy hockey rankings. Wins and save percentage are the primary drivers,
            with shutouts providing significant bonus value.
          </p>
        </div>

        {/* Note about dynamic adjustments */}
        <div className="mt-8 rounded-lg border-l-4 border-blue-500 bg-blue-50 p-4">
          <p className="text-sm text-blue-900">
            <strong>Note:</strong> Draft pick values are calculated dynamically based on
            the average value of players in corresponding performance tiers within your
            league. Higher rounds are valued based on elite player averages, while later
            rounds reflect depth player values.
          </p>
        </div>
      </div>
    </div>
  );
}

