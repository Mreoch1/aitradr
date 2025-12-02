-- CreateTable
CREATE TABLE "player_values" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "breakdown" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "player_values_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "player_values_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "draft_pick_values" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leagueId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "score" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "draft_pick_values_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "leagues" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "player_values_playerId_leagueId_key" ON "player_values"("playerId", "leagueId");

-- CreateIndex
CREATE UNIQUE INDEX "draft_pick_values_leagueId_round_key" ON "draft_pick_values"("leagueId", "round");
