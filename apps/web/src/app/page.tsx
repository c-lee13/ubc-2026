import { DEMO_PURCHASE_AMOUNT } from "@hedged/shared";
import { HomeLive, HomeOdds } from "@/components/home-live";
import { SiteHeader } from "@/components/site-header";
import { ChainTag, SimTag } from "@/components/ui";
import { Voucher } from "@/components/voucher";

const STEPS = [
  {
    title: "Pay with an email code",
    body: "The customer types an email and a 6-digit code. Circle creates their dollar wallet, and the $5 in USDC goes into the escrow on Arc, not to the shop.",
    tag: <ChainTag>Real on Arc testnet</ChainTag>,
  },
  {
    title: "The shop covers the refund",
    body: "The backend prices YES contracts on Gemini's live order book. At 50¢ each, covering $5 costs $2.50.",
    tag: <SimTag>Simulated hedge</SimTag>,
  },
  {
    title: "The official result pays out",
    body: "When Gemini settles the market, the escrow pays the customer back if it happened, or the shop if it didn't.",
    tag: <ChainTag>Real on Arc testnet</ChainTag>,
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1240px] px-5 pb-16 md:px-8">
        <section className="pt-4 pb-12 md:pt-8">
          <h1 className="font-display text-[42px] leading-[0.95] sm:text-[64px] lg:text-[88px] xl:text-[96px]">
            <span className="block">Sell the promise.</span>
            <span className="block">Buy the odds.</span>
          </h1>
          <div className="mt-8 grid items-start gap-10 lg:mt-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
            <div className="max-w-[36rem]">
              <p className="text-[18px] leading-relaxed text-ink-soft sm:text-[19px]">
                A café offers: pay $5 for a latte, and if SOL closes up, you get your $5 back. The
                payment waits in an escrow on Arc, the shop covers the refund at Gemini&apos;s live
                odds, and the official result decides who the escrow pays.
              </p>
              <CustomerSees />
              <HomeLive />
            </div>
            <div className="relative lg:-mt-4">
              <Voucher
                seed="hill-country-coffee-sample"
                shopName="Hill Country Coffee"
                itemName="Latte"
                amount={DEMO_PURCHASE_AMOUNT}
                condition="SOL closes up"
                closesLabel="Sales close 5 min before the window"
                serial={null}
                marketId="GEMI-SOL05M-UP"
                tilt
              />
              <p className="mt-5 text-center text-[13px] text-ink-faint md:mt-7">
                Sample voucher. Every promo prints its own pattern from its on-chain address.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="how" className="border-t border-ink/15 pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="how" className="font-wide text-[20px] font-bold">
              How the money moves
            </h2>
            <HomeOdds />
          </div>
          <ol className="mt-6 grid gap-6 md:grid-cols-3 md:gap-0">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="relative md:border-l md:border-ink/15 md:px-6 md:first:border-l-0 md:first:pl-0"
              >
                <div className="flex items-center gap-3">
                  <span className="font-display grid h-9 w-9 place-items-center rounded-full bg-ink text-[15px] text-paper-raised">
                    {i + 1}
                  </span>
                  <h3 className="text-[17px] font-bold">{s.title}</h3>
                </div>
                <p className="mt-3 text-[15px] text-ink-soft">{s.body}</p>
                <div className="mt-3">{s.tag}</div>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}

/** The whole customer experience in three tokens: an email, a code, dollars. */
function CustomerSees() {
  const chip = "rounded-lg bg-paper-raised px-3 py-2 ring-1 ring-ink/15";
  return (
    <div className="mt-6">
      <p className="text-[14px] font-semibold text-ink">All the customer ever sees:</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[15px]">
        <span className={chip}>sam@example.com</span>
        <Arrow />
        <span className={`${chip} font-mono tracking-[0.3em]`}>481027</span>
        <Arrow />
        <span className={`${chip} font-wide font-bold text-note`}>$5.00</span>
      </div>
      <p className="mt-2 text-[13.5px] text-ink-soft">
        No app, no seed phrase, no tokens to buy. Fees are paid in dollars too.
      </p>
    </div>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 10" className="h-2.5 w-4 text-ink-faint" aria-hidden>
      <path d="M0 5h14M10 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
