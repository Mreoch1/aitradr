"use client";

export function SignOutButton() {
  const handleSignOut = async () => {
    try {
      await fetch("/api/auth/signout", { method: "POST" });
      window.location.href = "/login";
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <button
      onClick={handleSignOut}
      className="rounded bg-red-600 px-2 py-1 text-xs font-mono text-white hover:bg-red-700"
      title="Sign Out"
    >
      🚪 Out
    </button>
  );
}
