import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default async function LeagueDetailPage({
  params,
}: {
  params: Promise<{ leagueKey: string }>;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const { leagueKey } = await params;

  if (!leagueKey) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container mx-auto px-4 py-8">
          <div className="rounded border border-red-200 bg-red-50 p-6">
            <p className="text-red-600">League key is missing</p>
          </div>
        </div>
      </div>
    );
  }

  // Redirect directly to trade builder
  redirect(`/league/${encodeURIComponent(leagueKey)}/trade`);
}
