import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

// §7: Inter, with a system fallback stack. Bound to --font-sans, which
// globals.css maps onto Tailwind's font-sans.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "JSS MIS",
  description: "Order tracking for JSS The Print Zone",
  icons: { icon: "/jss-logo.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning is required by next-themes: it sets the theme
    // class before first paint, so the class the server rendered and the one
    // in the browser legitimately differ for a tick. It suppresses the warning
    // on THIS element only, not on the tree below.
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          {/* §7 asks for a toast on save. Mounted once at the root so a
              screen only has to call toast(), and inline validation stays the
              channel for errors — §7 is explicit that an error is never a
              modal, and a toast that disappears is no place for one. */}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
