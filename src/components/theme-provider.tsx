"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Theme handling.
 *
 * next-themes writes the chosen theme to localStorage and applies the `dark`
 * class before first paint via a small inline script, which is what stops the
 * page flashing white on load for anyone using dark mode. That script is also
 * why <html> needs suppressHydrationWarning in the root layout: the server
 * cannot know the theme, so the class it renders and the class in the browser
 * legitimately differ for one tick.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
