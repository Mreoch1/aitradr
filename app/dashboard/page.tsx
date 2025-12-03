import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

// Hardcoded league key for atfh2
const ATFH2_LEAGUE_KEY = "465.l.9080";

export default async function DashboardPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // Check if Yahoo is linked
  const yahooAccount = await prisma.yahooAccount.findUnique({
    where: { userId: session.userId },
  });

  if (!yahooAccount) {
    // Redirect to Yahoo OAuth if not linked
    redirect("/api/auth/yahoo/start");
  }

  // Redirect directly to atfh2 trade builder
  redirect(`/league/${ATFH2_LEAGUE_KEY}/trade`);
}

