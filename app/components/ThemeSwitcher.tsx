"use client";

import { useTheme } from "./ThemeProvider";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  const themes = [
    { id: "light", label: "☀️ Light", icon: "☀️" },
    { id: "dark", label: "🌙 Dark", icon: "🌙" },
    { id: "mooninites", label: "👽 Mooninites", icon: "👽" },
    { id: "athf", label: "🍔 ATHF", icon: "🍔" },
  ] as const;

  return (
    <div className="flex items-center gap-2">
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as any)}
        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1 text-sm theme-text-primary focus:border-purple-500 dark:focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500 dark:focus:ring-purple-400"
        aria-label="Select theme"
      >
        {themes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}

