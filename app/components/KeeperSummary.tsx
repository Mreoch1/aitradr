"use client";

import type { TradeData } from "@/app/api/league/[leagueKey]/trade-data/route";

interface KeeperSummaryProps {
  team: TradeData["teams"][0];
  draftPickValues: TradeData["draftPickValues"];
}

export function KeeperSummary({ team, draftPickValues }: KeeperSummaryProps) {
  const keepers = team.roster.filter(p => p.isKeeper);
  
  if (keepers.length === 0) {
    return null;
  }
  
  // Get pick value map
  const pickValueMap = new Map<number, number>();
  draftPickValues.forEach(pick => pickValueMap.set(pick.round, pick.score));
  
  // Calculate total keeper value and bonus
  let totalValue = 0;
  let totalBonus = 0;
  
  keepers.forEach(keeper => {
    totalValue += keeper.valueScore;
    if (keeper.keeperRoundCost && keeper.yearsRemaining) {
      const draftRoundAvg = pickValueMap.get(keeper.keeperRoundCost) ?? 100;
      const surplus = Math.max(0, keeper.valueScore - draftRoundAvg);
      const bonus = surplus * (keeper.yearsRemaining / 3);
      totalBonus += bonus;
    }
  });
  
  return (
    <div className="rounded-lg border-2 border-purple-500 bg-purple-50 p-4 shadow-md">
      <h3 className="mb-3 text-sm font-bold text-purple-900">
        🔒 KEEPERS ({keepers.length})
      </h3>
      
      <div className="space-y-2">
        {keepers.map(keeper => {
          const draftRoundAvg = pickValueMap.get(keeper.keeperRoundCost ?? 0) ?? 100;
          const surplus = Math.max(0, keeper.valueScore - draftRoundAvg);
          const bonus = keeper.yearsRemaining ? surplus * (keeper.yearsRemaining / 3) : 0;
          
          return (
            <div key={keeper.playerId} className="flex items-center justify-between text-xs border-b border-purple-200 pb-1">
              <div className="flex-1">
                <span className="font-semibold text-purple-900">{keeper.name}</span>
                <span className="ml-2 text-purple-700">
                  R{keeper.keeperRoundCost} • Y{(keeper.keeperYearIndex ?? 0) + 1} • {keeper.yearsRemaining}yr
                </span>
              </div>
              <div className="text-right">
                <span className="font-bold text-blue-700">{keeper.valueScore.toFixed(0)}</span>
                {bonus > 0 && (
                  <span className="ml-1 text-purple-600">+{bonus.toFixed(0)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="mt-3 pt-2 border-t-2 border-purple-300 flex justify-between text-sm font-bold">
        <span className="text-purple-900">Total</span>
        <span className="text-blue-700">
          {totalValue.toFixed(0)}
          {totalBonus > 0 && (
            <span className="text-purple-600"> +{totalBonus.toFixed(0)}</span>
          )}
        </span>
      </div>
    </div>
  );
}

