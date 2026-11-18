import type { Metadata } from "next";
import { DiscoverView } from "@/components/discover-view";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Discover: Hedged (Arc testnet demo)" };

export default function DiscoverPage() {
  return (
    <>
      <SiteHeader active="discover" />
      <main className="mx-auto max-w-[1240px] px-5 pt-4 pb-20 md:px-8 md:pt-8">
        <h1 className="font-display text-[34px] md:text-[44px]">Free if it happens</h1>
        <p className="mt-2 mb-8 max-w-2xl text-[16px] text-ink-soft">
          Shops near you that give your money back if something happens. Pay with your email; if it
          happens, the money comes back to your balance.
        </p>
        <DiscoverView />
      </main>
    </>
  );
}
