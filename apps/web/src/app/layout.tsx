import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { FixtureSheets } from "@/components/fixture-sheets";
import { WalletSessionProvider } from "@/lib/wallet/session";
import "./globals.css";

// One variable family, as in Dylan's prototype: Archivo's width axis gives the expanded display
// cut and the text cut. Vendored in ./fonts (SIL Open Font License), so building needs no network.
const archivo = localFont({
  src: "./fonts/archivo-latin.woff2",
  weight: "100 900",
  variable: "--font-archivo",
  display: "swap",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "Wincentive",
  description: "Win and it's free. Buy your coffee now; if your team wins, the money comes back.",
  applicationName: "Wincentive",
  // A static file, not an app/manifest.ts route: the route recompiled on every request in dev and
  // made the page reload in a loop.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Wincentive", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#0b0710",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="min-h-dvh bg-bg font-sans text-ink antialiased">
        <WalletSessionProvider>
          {children}
          <FixtureSheets />
        </WalletSessionProvider>
      </body>
    </html>
  );
}
