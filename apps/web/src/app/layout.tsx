import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { FixtureSheets } from "@/components/fixture-sheets";
import { WalletSessionProvider } from "@/lib/wallet/session";
import "./globals.css";

// Zahin's two faces, vendored in ./fonts (SIL Open Font License) so building needs no network.
// Loaded once here; every page and component uses --font-display and --font-body.
const display = localFont({
  src: "./fonts/bricolage-grotesque-latin.woff2",
  weight: "200 800",
  variable: "--font-display",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
const body = localFont({
  src: "./fonts/instrument-sans-latin.woff2",
  weight: "400 700",
  variable: "--font-body",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Wincentive",
  description:
    "Outcome-based refund promotions for merchants, informed by prediction-market prices. Customers pay test USDC with an email login into an escrow on Arc testnet; hedging is simulated.",
  applicationName: "Wincentive",
  // A static file, not an app/manifest.ts route: the route recompiled on every request in dev and
  // made the page reload in a loop.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Wincentive", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#FAF9F6", viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen bg-[#FAF9F6] font-[family-name:var(--font-body)] text-[#211D28] antialiased">
        <WalletSessionProvider>
          {children}
          <FixtureSheets />
        </WalletSessionProvider>
      </body>
    </html>
  );
}
