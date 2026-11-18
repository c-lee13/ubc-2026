import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import { FixtureSheets } from "@/components/fixture-sheets";
import { WalletSessionProvider } from "@/lib/wallet/session";
import "./globals.css";

// One variable family: the width axis gives the expanded display cut and the text cut.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wincentive: free if it happens (Arc testnet demo)",
  description:
    "A shop offers your money back if something happens. You pay in dollars with an email login; the payment waits in an escrow on Arc and the shop's risk is covered at live Gemini odds (simulated). Test USDC only.",
};

export const viewport: Viewport = { themeColor: "#0b0710" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="min-h-screen bg-paper text-ink antialiased">
        <WalletSessionProvider>
          {children}
          <FixtureSheets />
        </WalletSessionProvider>
      </body>
    </html>
  );
}
