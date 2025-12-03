import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import prisma from "@/lib/prisma";

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

  // Redirect directly to leagues page
  redirect("/leagues");
}

