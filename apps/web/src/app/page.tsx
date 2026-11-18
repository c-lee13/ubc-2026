import Link from "next/link";
import { ExploreDemoLink, HomePlayground } from "@/components/home/HomeLive";
import { DisclosureStrip } from "@/components/layout/DisclosureStrip";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { BTN_PRIMARY, DISPLAY, EYEBROW, EYEBROW_RULE } from "@/components/layout/styles";

// Homepage (Zahin's design). A Server Component; the two live pieces are client components that
// read GET /api/promotions: the hero preview shows the promo selling right now (or Zahin's labeled
// sample when none is), and "Explore demo" goes to that promo's checkout (or the list of offers).
// Nothing here is a deposit, a hedge fill or a settlement.

const STEPS = [
  {
    n: "01",
    title: "Create an offer",
    body: "A merchant picks the Gemini market the offer is based on, sets a price and a refund condition, and sets limits for the simulated hedge.",
  },
  {
    n: "02",
    title: "Customer checks out",
    body: "The customer logs in with an email and pays test USDC into an escrow on Arc. Wincentive reads Gemini prices and records a simulated hedge for the merchant.",
  },
  {
    n: "03",
    title: "Market outcome is finalized",
    body: "When the event ends, the market's official final outcome decides the result. A price, a live score or a hunch never settles anything.",
  },
  {
    n: "04",
    title: "Eligible party claims",
    body: "If the refund condition happened, the customer claims their payment back. If it didn't, the merchant claims the escrowed USDC.",
  },
];

// The two things that quietly support one customer-facing offer. Descriptive only: no figures.
const SUPPORTS = [
  {
    name: "Gemini market signals",
    lead: "Read-only prediction-market pricing",
    body: "Used to inform simulated promotion hedge-cost estimates.",
    rows: [
      ["Access", "Read-only"],
      ["Feeds", "Simulated estimates"],
    ],
  },
  {
    name: "Arc conditional claims",
    lead: "Escrow contract on Arc testnet",
    body: "Holds each payment until the finalized outcome decides who can claim it. Email wallets by Circle.",
    rows: [
      ["Network", "Arc testnet"],
      ["Money", "Test USDC, no value"],
    ],
  },
];

export default function Home() {
  return (
    <>
      <DisclosureStrip />

      <SiteHeader current="home" extraLinks={[{ label: "How it works", href: "#how-it-works" }]} />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-16 pt-8 sm:px-8 lg:grid-cols-12 lg:items-center lg:gap-12 lg:pb-24 lg:pt-12">
          <div className="lg:col-span-6">
            <p className={EYEBROW}>
              <span aria-hidden className={EYEBROW_RULE} />
              Outcome-powered commerce
            </p>

            <h1
              className={`${DISPLAY} mt-6 max-w-[9em] text-balance text-[clamp(3rem,8vw,4.75rem)] font-semibold leading-[0.94] tracking-[-0.045em]`}
            >
              A better reason to buy.
            </h1>

            <p className="mt-7 max-w-[32rem] text-lg leading-relaxed text-[#5A5463]">
              Turn real-world events into refund promotions customers actually get excited about.
              Wincentive helps merchants create conditional offers informed by prediction-market
              pricing.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/merchant/new" className={BTN_PRIMARY}>
                Create a promotion
              </Link>
              <ExploreDemoLink />
            </div>

            <ul className="mt-12 flex flex-col gap-1.5 text-sm text-[#4E4858] sm:flex-row sm:flex-wrap sm:gap-y-3 lg:flex-col xl:flex-row">
              {["Arc testnet", "Gemini Predictions, read-only", "Simulated hedging"].map((item) => (
                <li
                  key={item}
                  className="sm:border-l sm:border-[#211D28]/20 sm:px-4 sm:first:border-l-0 sm:first:pl-0 lg:border-l-0 lg:px-0 xl:border-l xl:px-4 xl:first:border-l-0 xl:first:pl-0"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Product preview: the hero visual. The live promo, or the labeled sample. */}
          <div className="lg:col-span-6">
            <div className="mx-auto w-full max-w-[600px] lg:mr-0">
              <HomePlayground />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          aria-labelledby="how-heading"
          className="scroll-mt-4 border-t border-[#E6E1D8]"
        >
          <div className="mx-auto max-w-[1240px] px-5 py-20 sm:px-8 lg:py-28">
            <div className="grid gap-6 lg:grid-cols-12">
              <h2
                id="how-heading"
                className={`${DISPLAY} text-[clamp(2.6rem,6vw,4.4rem)] font-semibold leading-[0.98] tracking-[-0.04em] lg:col-span-6`}
              >
                How it works
              </h2>
              <p className="max-w-md self-end text-lg leading-relaxed text-[#5A5463] lg:col-span-5 lg:col-start-8">
                Four steps, from the merchant&apos;s offer to the final claim.
              </p>
            </div>

            <ol className="mt-14 grid gap-12 md:grid-cols-4 md:gap-0">
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
                    className={`${DISPLAY} text-[3.6rem] font-light leading-none tracking-[-0.05em] text-[#6133A7] tabular-nums`}
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

            <aside className="mt-16 max-w-3xl border-l-[3px] border-[#F58C38] pl-5">
              <p className={`${DISPLAY} text-lg font-semibold tracking-[-0.01em]`}>
                About the hedge
              </p>
              <p className="mt-1.5 leading-relaxed text-[#5A5463]">
                The hedge in this demo is simulated. Wincentive reads Gemini Predictions prices to
                estimate what a hedge would cost, and records that estimate. It never places a
                Gemini order, and no real money moves.
              </p>
            </aside>
          </div>
        </section>

        {/* What Wincentive enables: one offer, two quiet supports */}
        <section aria-labelledby="enable-heading" className="border-t border-[#E6E1D8]">
          <div className="mx-auto grid max-w-[1240px] gap-14 px-5 py-20 sm:px-8 lg:grid-cols-12 lg:gap-8 lg:py-28">
            <div className="lg:col-span-5">
              <h2
                id="enable-heading"
                className={`${DISPLAY} text-[clamp(2.6rem,5.6vw,4.6rem)] font-semibold leading-[0.98] tracking-[-0.04em]`}
              >
                Not your average promotion.
              </h2>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-[#5A5463]">
                Wincentive brings real-world outcomes into the shopping experience. Merchants create
                offers customers can root for, while prediction-market pricing and blockchain
                infrastructure support the mechanics behind them.
              </p>
            </div>

            <figure className="lg:col-span-7 lg:pl-10">
              <p className="text-sm font-semibold">What the customer sees</p>

              {/* The offer, drawn as a ticket: dashed perforation and a punch hole (a nod to the logo's price tag) */}
              <div className="relative mt-3 rounded-2xl border border-[#E6E1D8] bg-white p-6 shadow-[0_1px_0_rgba(33,29,40,0.04),0_28px_56px_-32px_rgba(33,29,40,0.28)] sm:p-8">
                <span
                  aria-hidden
                  className="absolute right-5 top-5 h-3.5 w-3.5 rounded-full border-2 border-[#CFC8BC]"
                />
                <p
                  className={`${DISPLAY} max-w-[30rem] text-balance text-[1.9rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[2.3rem]`}
                >
                  Buy today. Get it back if the outcome goes your way.
                </p>
                <div aria-hidden className="my-6 border-t border-dashed border-[#CFC8BC]" />
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
                  <span className="rounded-full bg-[#FDEBD9] px-3 py-1 text-xs font-bold text-[#7A4208]">
                    Illustrative offer
                  </span>
                  <span className="text-[#5A5463]">Claims open once the outcome is final.</span>
                </div>
              </div>

              {/* Two supports, each tied to the ticket by a thin line (a single rail on mobile) */}
              <div className="relative pt-8 md:grid md:grid-cols-2 md:gap-x-10 md:pt-0">
                <span
                  aria-hidden
                  className="absolute left-[4px] top-0 h-8 w-px bg-[#211D28]/35 md:hidden"
                />
                {SUPPORTS.map((s) => (
                  <div
                    key={s.name}
                    className="relative ml-[4px] border-l border-[#211D28]/35 pb-10 pl-8 last:[border-image:linear-gradient(to_bottom,rgb(33_29_40/0.35)_13px,transparent_13px)_1] last:pb-0 md:ml-0 md:flex md:flex-col md:border-l-0 md:pb-0 md:pl-9 md:pt-14"
                  >
                    <span
                      aria-hidden
                      className="absolute -left-[4.5px] top-2 h-[9px] w-[9px] rounded-full bg-[#6133A7] md:left-0 md:top-16"
                    />
                    <span
                      aria-hidden
                      className="absolute left-[4px] top-0 hidden h-16 w-px bg-[#211D28]/35 md:block"
                    />
                    <h3
                      className={`${DISPLAY} text-[1.4rem] font-semibold leading-tight tracking-[-0.025em]`}
                    >
                      {s.name}
                    </h3>
                    <p className="mt-2 font-medium leading-snug">{s.lead}</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-[#5A5463] md:mb-5">
                      {s.body}
                    </p>
                    <dl className="mt-5 divide-y divide-[#E6E1D8] border-y border-[#E6E1D8] text-[13px] md:mt-auto">
                      {s.rows.map(([k, v]) => (
                        <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                          <dt className="text-[#5A5463]">{k}</dt>
                          <dd className="text-right font-medium">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>

              <figcaption className="mt-10 text-xs leading-relaxed text-[#5A5463]">
                Illustrative diagram. No live market data, odds or settlements are shown.
              </figcaption>
            </figure>
          </div>
        </section>
      </main>

      <SiteFooter
        links={[
          { label: "Merchant dashboard", href: "/merchant" },
          { label: "Create a promotion", href: "/merchant/new" },
          { label: "Live offers", href: "/discover" },
        ]}
      />
    </>
  );
}
