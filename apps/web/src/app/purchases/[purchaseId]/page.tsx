import type { Metadata } from "next";
import { DisclosureStrip } from "@/components/layout/DisclosureStrip";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DISPLAY } from "@/components/layout/styles";
import { ReceiptScreen } from "@/components/purchases/ReceiptScreen";

export const metadata: Metadata = { title: "Receipt: Wincentive" };

// Purchase receipt (Zahin's design) for one purchase key (bytes32 hex from the Arc escrow). The
// receipt is GET /api/purchases/:key, polled; every stage marked done comes from on-chain escrow
// state, and the refund claim is the customer's own approval in Circle's window.

const DECIDES = [
  {
    title: "The payment waits in escrow",
    body: "Your test USDC sits in the escrow contract on Arc. The shop can't take it early, and nobody else can move it.",
  },
  {
    title: "The official result decides",
    body: "A refund depends on the Gemini market's official final outcome. A live score or a price never counts.",
  },
  {
    title: "What makes you eligible",
    body: "A covered purchase whose outcome happened, or a purchase the shop couldn't cover (then you get it all back). A status label or a logged-in wallet alone never makes a purchase eligible.",
  },
];

export default async function PurchaseReceiptPage({
  params,
}: {
  params: Promise<{ purchaseId: string }>;
}) {
  const { purchaseId } = await params;

  return (
    <>
      <DisclosureStrip />

      {/* The account control lives in the claim panel, where it matters. */}
      <SiteHeader current="purchases" showWallet={false} />

      <main>
        <ReceiptScreen purchaseKey={decodeURIComponent(purchaseId)} />

        {/* Customer education: what decides a refund */}
        <section aria-labelledby="why-heading" className="border-t border-[#E6E1D8]">
          <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 lg:py-20">
            <h2
              id="why-heading"
              className={`${DISPLAY} text-[clamp(2.1rem,4.2vw,3.2rem)] font-semibold leading-[1] tracking-[-0.04em]`}
            >
              How a refund is decided
            </h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-0">
              {DECIDES.map((item) => (
                <li key={item.title} className="border-t border-[#CFC8BC] pt-6 md:pr-8">
                  <h3 className={`${DISPLAY} text-xl font-semibold tracking-[-0.02em]`}>
                    {item.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#5A5463]">{item.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <SiteFooter
        links={[
          { label: "Home", href: "/" },
          { label: "My purchases", href: "/me" },
          { label: "For merchants", href: "/merchant" },
        ]}
      />
    </>
  );
}
