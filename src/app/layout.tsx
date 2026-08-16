import type { Metadata } from "next";
import { Inter } from "next/font/google";
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
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
