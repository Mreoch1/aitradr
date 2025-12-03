import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

// Hardcoded league key for atfh2
const ATFH2_LEAGUE_KEY = "465.l.9080";

export default async function LeaguesPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  // Always redirect to atfh2 league
  redirect(`/league/${ATFH2_LEAGUE_KEY}/trade`);
}

