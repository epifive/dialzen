/**
 * Theme before first paint. The root layout (src/app/layout.tsx) renders this code as an
 * inline script in <head>, so the saved theme is applied before the page is painted (no
 * flash of the wrong colours). The root layout is never re-rendered on the client, so React
 * never has to create the <script> element in the browser (it would warn and not run it).
 * Dependency-free: shared by the root layout and the theme toggle.
 */

export type ThemeChoice = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "tz-theme";

export function themeInitCode(defaultTheme: ThemeChoice): string {
  const fallback = defaultTheme === "light" || defaultTheme === "dark" ? defaultTheme : "system";
  return `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"${fallback}";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light";}catch(e){}})();`;
}
