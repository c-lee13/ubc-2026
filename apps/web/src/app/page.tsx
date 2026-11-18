import { HomeLive, HomeNumbers, HomeVoucher } from "@/components/home-live";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1240px] px-5 pb-16 md:px-8">
        <section className="pt-6 pb-14 md:pt-8">
          <h1 className="font-display text-[42px] leading-[0.95] sm:text-[64px] lg:text-[88px] xl:text-[96px]">
            <span className="block">Sell the promise.</span>
            <span className="block">Buy the odds.</span>
          </h1>
          <div className="mt-8 grid grid-cols-1 items-start gap-10 lg:mt-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
            <div className="max-w-[36rem]">
              <p className="text-[20px] leading-snug text-ink-soft sm:text-[22px]">
                Free if it happens. The shop covers the refund at live Gemini odds.
              </p>
              <p className="font-wide mt-7 flex items-baseline gap-x-2 text-[19px] font-bold whitespace-nowrap sm:gap-x-3 sm:text-[26px]">
                <span>sam@email</span>
                <Arrow />
                <span className="font-mono sm:tracking-[0.18em]">481027</span>
                <Arrow />
                <span className="text-note">$5.00</span>
              </p>
              <HomeLive />
            </div>
            <div className="relative lg:-mt-4">
              <HomeVoucher />
            </div>
          </div>
        </section>

        <section aria-labelledby="how" className="border-t border-ink/15 pt-10">
          <h2 id="how" className="sr-only">
            How the money moves
          </h2>
          <HomeNumbers />
        </section>
      </main>
    </>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 10" className="h-3 w-5 self-center text-ink-faint" aria-hidden>
      <path d="M0 5h14M10 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
