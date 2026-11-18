import type { Metadata } from "next";
import { DiscoverView } from "@/components/discover-view";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Discover: Hedged (Arc testnet demo)" };

export default function DiscoverPage() {
  return (
    <>
      <SiteHeader active="discover" />
      <main className="mx-auto max-w-[1240px] px-5 pt-4 pb-20 md:px-8 md:pt-8">
        <h1 className="mb-8 font-display text-[34px] md:text-[44px]">Free if it happens</h1>

        <DiscoverView />
      </main>
    </>
  );
}
