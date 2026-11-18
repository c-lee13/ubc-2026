import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckoutScreen } from "@/components/checkout/CheckoutScreen";
import { DisclosureStrip } from "@/components/layout/DisclosureStrip";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { DISPLAY } from "@/components/layout/styles";

export const metadata: Metadata = { title: "Checkout: Wincentive" };

const PURCHASE_KEY = /^0x[0-9a-fA-F]{64}$/;

// Customer checkout (Zahin's design) for one promo, reached from the shop's QR code. The promo is
// loaded from GET /api/promotions/:id and paid with the email wallet's approve + deposit flow
// (docs/email-wallets.md); CheckoutScreen does both. After paying, the receipt is
// /purchases/<purchaseKey>. Old links with ?p=<purchaseKey> go straight to that receipt.

const STEPS = [
  {
    n: "01",
    title: "Pay into escrow",
    body: "You pay test USDC into an escrow contract on Arc. Neither the merchant nor Wincentive can spend it early.",
  },
  {
    n: "02",
    title: "A hedge is simulated",
    body: "A live Gemini prediction-market quote informs a simulated hedge for the merchant. No real orders are placed.",
  },
  {
    n: "03",
    title: "Outcome is finalized",
    body: "Once the market's official outcome is final, the escrow is settled once.",
  },
  {
    n: "04",
    title: "Claim the escrowed USDC",
    body: "If the refund condition is met you claim your payment back. Otherwise the merchant claims it.",
  },
];

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ promoId: string }>;
  searchParams: Promise<{ p?: string | string[] }>;
}) {
  const { promoId } = await params;
  const { p } = await searchParams;
  if (typeof p === "string" && PURCHASE_KEY.test(p)) redirect(`/purchases/${p}`);

  return (
    <>
      <DisclosureStrip />

      {/* The account control lives in the checkout panel, where the wallet is actually relevant. */}
      <SiteHeader
        current="offers"
        showWallet={false}
        extraLinks={[{ label: "How it works", href: "#how-it-works" }]}
      />

      <main>
        <CheckoutScreen promoId={decodeURIComponent(promoId)} />

        {/* After the outcome: what happens to the escrow */}
        <section
          id="how-it-works"
          aria-labelledby="how-heading"
          className="scroll-mt-4 border-t border-[#E6E1D8]"
        >
          <div className="mx-auto max-w-[1240px] px-5 py-16 sm:px-8 lg:py-24">
            <h2
              id="how-heading"
              className={`${DISPLAY} text-[clamp(2.2rem,4.6vw,3.4rem)] font-semibold leading-[1] tracking-[-0.04em]`}
            >
              How Your Refund Works
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-2 md:gap-x-0 md:gap-y-12 lg:grid-cols-4 lg:gap-y-0">
              {STEPS.map((step) => (
                <li
                  key={step.n}
                  className="relative border-l border-[#CFC8BC] pl-7 md:border-l-0 md:border-t md:pl-0 md:pr-8 md:pt-9"
                >
                  <span
                    aria-hidden
                    className="absolute -left-[5px] top-2 h-[9px] w-[9px] rounded-full bg-[#6133A7] md:-top-[5px] md:left-0"
                  />
                  <p
                    className={`${DISPLAY} text-[3.2rem] font-light leading-none tracking-[-0.05em] text-[#6133A7] tabular-nums`}
                  >
                    {step.n}
                  </p>
                  <h3 className={`${DISPLAY} mt-5 text-xl font-semibold tracking-[-0.02em]`}>
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-[#5A5463]">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <SiteFooter
        links={[
          { label: "Home", href: "/" },
          { label: "Live offers", href: "/discover" },
          { label: "For merchants", href: "/merchant" },
        ]}
      />
    </>
  );
}
