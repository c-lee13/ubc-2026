import type { GeminiAdapter } from "../gemini/adapter";
import { BASE_UNITS_PER_HUNDREDTH, ceilDiv, hundredthsToQty } from "../gemini/decimal";
import { computeEventDesk, planOrders, walkBook, type DeskFill, type Exposure } from "./desk";

/**
 * "What would the desk do?" for a hypothetical pair of shops on opposite sides of one real game,
 * priced against LIVE Gemini books. Pure calculation: nothing is stored and no worker sees it, so it
 * can be shown on stage without seeding fake shops into the database. Every number is simulated.
 *
 * Shop A runs "free if <side 1> wins", shop B "free if <side 2> wins". Each sale's hedge is priced
 * at its side's live best ask (what the shop pays); the desk then nets and buys only the remainder,
 * walking the live book in lots.
 */
export interface NettingDemoInput {
  eventTicker: string;
  /** Item price in base units (6 decimals), e.g. 5_000_000 = $5. */
  price: bigint;
  /** Sales per side, in the event's contract order. */
  sales: [number, number];
  lotContracts: number;
}

export async function nettingDemo(
  gemini: Pick<GeminiAdapter, "getEventInfo" | "getBook">,
  input: NettingDemoInput,
) {
  const info = await gemini.getEventInfo(input.eventTicker);
  if (!info.exclusive || info.contracts.length !== 2) {
    return { error: "not_a_two_sided_moneyline" as const };
  }
  const books = await Promise.all(info.contracts.map((c) => gemini.getBook(c.marketId)));
  const contractsPerSaleH = ceilDiv(input.price, BASE_UNITS_PER_HUNDREDTH);

  const sides = info.contracts.map((c, i) => {
    const ask = books.at(i)!.asks.at(0);
    const sales = BigInt(input.sales.at(i)!);
    const perSale = ask ? ceilDiv(contractsPerSaleH * BigInt(ask.priceMicroUsd), 100n) : null;
    return {
      marketId: c.marketId,
      label: c.label,
      sales: Number(sales),
      liveAskMicroUsd: ask?.priceMicroUsd ?? null,
      perSalePremium: perSale,
      exposure: {
        marketId: c.marketId,
        contractsH: contractsPerSaleH * sales,
        premium: perSale === null ? 0n : perSale * sales,
      } satisfies Exposure,
    };
  });
  if (sides.some((s) => s.perSalePremium === null && s.sales > 0)) {
    return { error: "no_live_price" as const };
  }

  const exposures = sides.map((s) => s.exposure);
  const before = computeEventDesk({
    exclusive: true,
    contracts: info.contracts,
    exposures,
    fills: [],
  });
  const fills: DeskFill[] = [];
  for (const order of planOrders(before, BigInt(input.lotContracts) * 100n)) {
    if (order.side !== "BUY") continue; // nothing held yet, so there is nothing to sell back
    const i = info.contracts.findIndex((c) => c.marketId === order.marketId);
    const f = walkBook(books.at(i)!.asks, order.contractsH);
    if (f.filledH > 0n) {
      fills.push({
        marketId: order.marketId,
        side: "BUY",
        contractsH: f.filledH,
        amount: f.amount,
      });
    }
  }
  const after = computeEventDesk({ exclusive: true, contracts: info.contracts, exposures, fills });

  return {
    scenario: "demo" as const,
    simulated: true as const,
    eventTicker: info.eventTicker,
    title: info.title,
    assumptions: [
      "Hypothetical shops; nothing is stored.",
      "Each sale is priced at its side's live best ask; the desk walks the live book in lots.",
      "Simulated only: no Gemini order is placed.",
    ],
    sides: sides.map((s) => ({
      label: s.label,
      marketId: s.marketId,
      sales: s.sales,
      liveAskMicroUsd: s.liveAskMicroUsd,
      perSalePremium: s.perSalePremium?.toString() ?? null,
      premiumsCollected: s.exposure.premium.toString(),
    })),
    hedgingEverySaleCosts: after.premiumsCollected.toString(),
    deskBuys: fills.map((f) => ({
      marketId: f.marketId,
      contracts: hundredthsToQty(f.contractsH),
      cost: f.amount.toString(),
    })),
    deskCost: after.deskCost.toString(),
    savings: after.savings.toString(),
    certainLiability: hundredthsToQty(after.certainLiabilityH),
    covered: after.covered,
    pnlIfWins: after.pnlIfWins!.map((o) => ({
      label: info.contracts.find((c) => c.marketId === o.marketId)?.label ?? o.marketId,
      pnl: o.pnl.toString(),
    })),
  };
}
