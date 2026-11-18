import type { Metadata } from "next";
import { MeView } from "@/components/me-view";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "My promos: Hedged (Arc testnet demo)" };

export default function MePage() {
  return (
    <>
      <SiteHeader active="me" />
      <main className="mx-auto max-w-[1240px] px-5 pt-4 pb-20 md:px-8 md:pt-8">
        <h1 className="mb-6 font-display text-[34px] md:text-[44px]">My promos</h1>
        <MeView />
      </main>
    </>
  );
}
