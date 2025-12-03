-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "isOwner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "yahooManagerId" TEXT;
