import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";
import { KEEPERS_2024, KEEPERS_2025 } from "@/lib/keeper/keeperData2025";
import { calculateYearsRemaining, calculateKeeperRound } from "@/lib/keeper/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueKey: string }> }
) {
  const { leagueKey } = await params;
  
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    console.log("[Populate Keepers] Starting for league:", leagueKey);
    
    // Find the league
    const normalizedLeagueKey = leagueKey.replace(/\.1\./g, '.l.');
    const reverseNormalizedKey = leagueKey.replace(/\.l\./g, '.1.');
    
    const league = await prisma.league.findFirst({
      where: {
        OR: [
          { leagueKey: normalizedLeagueKey },
          { leagueKey: reverseNormalizedKey },
          { leagueKey: leagueKey },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    
    if (!league) {
      return NextResponse.json({ ok: false, error: "League not found" }, { status: 404 });
    }
    
    // Clear all existing keeper flags
    await prisma.rosterEntry.updateMany({
      where: { leagueId: league.id },
      data: {
        isKeeper: false,
        originalDraftRound: null,
        keeperYearIndex: null,
        yearsRemaining: null,
        keeperRoundCost: null,
      }
    });
    
    console.log("[Populate Keepers] Cleared all keeper flags");
    
    // Find which players were kept in both years
    const keptInBothYears = new Set<string>();
    for (const keeper2024 of KEEPERS_2024) {
      const alsoIn2025 = KEEPERS_2025.find(k => k.player === keeper2024.player);
      if (alsoIn2025) {
        keptInBothYears.add(keeper2024.player);
      }
    }
    
    console.log(`[Populate Keepers] Players kept in both years: ${keptInBothYears.size}`);
    
    let updated = 0;
    const errors: string[] = [];
    
    for (const keeper of KEEPERS_2025) {
      // Determine keeper year
      const isSecondYear = keptInBothYears.has(keeper.player);
      const keeperYearIndex = isSecondYear ? 1 : 0;
      const yearsRemaining = calculateYearsRemaining(keeperYearIndex);
      
      // Find the player by FULL name
      const player = await prisma.player.findFirst({
        where: { 
          name: { contains: keeper.player, mode: 'insensitive' }
        },
        include: {
          rosterEntries: {
            where: { leagueId: league.id },
            include: { team: true }
          }
        }
      });
      
      if (!player) {
        errors.push(`Player not found: ${keeper.player}`);
        continue;
      }
      
      if (player.rosterEntries.length === 0) {
        errors.push(`${keeper.player} not on any roster (dropped?)`);
        continue;
      }
      
      // Use CURRENT team (not draft team, since players get traded)
      const rosterEntry = player.rosterEntries[0];
      
      const allPicks = Array.from({ length: 16 }, (_, i) => i + 1);
      const keeperRoundCost = calculateKeeperRound(keeper.round, allPicks) ?? keeper.round;
      
      // Update keeper status
      await prisma.rosterEntry.update({
        where: { id: rosterEntry.id },
        data: {
          isKeeper: true,
          originalDraftRound: keeper.round,
          keeperYearIndex: keeperYearIndex,
          yearsRemaining: yearsRemaining,
          keeperRoundCost: keeperRoundCost,
        }
      });
      
      updated++;
      console.log(`[Populate Keepers] ✅ ${keeper.player} → ${rosterEntry.team.name} (R${keeper.round}, Year ${keeperYearIndex + 1}, ${yearsRemaining} yrs left)`);
    }
    
    console.log(`[Populate Keepers] Updated ${updated} keeper records`);
    
    return NextResponse.json({ 
      ok: true, 
      message: `Successfully populated ${updated} keeper records`,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("[Populate Keepers] Error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to populate keepers" },
      { status: 500 }
    );
  }
}

