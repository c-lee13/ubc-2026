/* global process, URL, console, setInterval */
// SAMPLE-DATA mock of the promo server (apps/api) for local design review only.
// Plain node http, no deps. Every promo, purchase, price and outcome here is invented sample data
// (Austin shops), shaped like docs/FRONTEND-API.md and apps/web/src/lib/api.ts. Outcomes are
// labeled "manual-demo-fixture". GET /__sample lists ids. The real API is the reference: build
// against it, and keep this file in step when its shapes change.
// Behaves like escrow v2 (checkout "one-tap", autoPayout true); SAMPLE_ESCROW=v1 for the v1 shapes.
// Preview with sample data: `pnpm dev:sample` in one terminal, then
// `NEXT_PUBLIC_WALLET_FIXTURE=1 pnpm dev:web` in another, and open http://localhost:3000. PORT env, default 4000.
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 4000);
/** Escrow v2 (default): one-tap checkout and automatic payouts. */
const AUTO = process.env.SAMPLE_ESCROW !== "v1";
const now = () => Math.floor(Date.now() / 1000);
const iso = (s) => new Date(s * 1000).toISOString();
const pad = (n) => String(n).padStart(2, "0");
const sha = (s) => createHash("sha256").update(s).digest("hex");
const h32 = (s) => `0x${sha(s)}`;
const addr = (s) => `0x${sha(s).slice(0, 40)}`;
const uuid = (s) => {
  const h = sha(s);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const USD = (d) => String(Math.round(d * 1_000_000));
const T0 = now();

/* ---------- market ids ---------- */
function solId(closeUnix) {
  const d = new Date(closeUnix * 1000);
  return `GEMI-SOL05M${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}-UP`;
}
function solClose(id) {
  const m = /^GEMI-SOL05M(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-UP$/.exec(id);
  if (!m) return null;
  return Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000;
}
const floor5 = (s) => Math.floor(s / 300) * 300;
/** Live SOL window for a promo: deposit deadline 6-11 min out, window closes 10 min after that. */
function liveSolWindow(offsetSlots = 0) {
  const deadline = floor5(now() + 360) + 300 + offsetSlots * 300;
  return { deadline, marketId: solId(deadline + 600) };
}

// Sports markets (Gemini-style instrument symbols). Kickoff = startsAt = latest deposit deadline.
const KICK_TEX_ARK = Date.UTC(2026, 10, 21, 20, 30) / 1000; // Sat Nov 21, 2:30 PM CT
const KICK_DAL_PHI = Date.UTC(2026, 10, 23, 1, 20) / 1000; // Sun Nov 22, 7:20 PM CT
const KICK_SAS_HOU = Date.UTC(2026, 10, 19, 1, 0) / 1000; // tonight 7:00 PM CT
const KICK_TEX_UK = Date.UTC(2026, 10, 14, 17, 0) / 1000; // last Sat, 11 AM CT (final)
const tipId = (prefix, t, teams) => {
  const d = new Date(t * 1000);
  return `GEMI-${prefix}-${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}-${teams}`;
};
const SPORTS = [
  {
    marketId: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
    eventTicker: "GEMI-NCAAF-2611212030-ARK-TEX",
    eventTitle: "Arkansas at Texas",
    outcomeLabel: "Texas wins",
    category: "Sports",
    startsAt: KICK_TEX_ARK,
    ask: 640000,
  },
  {
    marketId: "GEMI-NCAAF-2611212030-ARK-TEX-M-ARK",
    eventTicker: "GEMI-NCAAF-2611212030-ARK-TEX",
    eventTitle: "Arkansas at Texas",
    outcomeLabel: "Arkansas wins",
    category: "Sports",
    startsAt: KICK_TEX_ARK,
    ask: 380000,
  },
  {
    marketId: "GEMI-NCAAF-2611212030-ARK-TEX-S-TEX-10.5",
    eventTicker: "GEMI-NCAAF-2611212030-ARK-TEX",
    eventTitle: "Arkansas at Texas",
    outcomeLabel: "Texas wins by more than 10.5 points",
    category: "Sports",
    startsAt: KICK_TEX_ARK,
    ask: 470000,
  },
  {
    marketId: "GEMI-NFL-2611230120-PHI-DAL-M-DAL",
    eventTicker: "GEMI-NFL-2611230120-PHI-DAL",
    eventTitle: "Eagles at Cowboys",
    outcomeLabel: "Cowboys win",
    category: "Sports",
    startsAt: KICK_DAL_PHI,
    ask: 560000,
  },
  {
    marketId: "GEMI-NFL-2611230120-PHI-DAL-M-PHI",
    eventTicker: "GEMI-NFL-2611230120-PHI-DAL",
    eventTitle: "Eagles at Cowboys",
    outcomeLabel: "Eagles win",
    category: "Sports",
    startsAt: KICK_DAL_PHI,
    ask: 460000,
  },
  {
    marketId: `${tipId("NBA", KICK_SAS_HOU, "HOU-SAS")}-M-SAS`,
    eventTicker: tipId("NBA", KICK_SAS_HOU, "HOU-SAS"),
    eventTitle: "Rockets at Spurs",
    outcomeLabel: "Spurs win",
    category: "Sports",
    startsAt: KICK_SAS_HOU,
    ask: 510000,
  },
  {
    marketId: "GEMI-NCAAF-2611141700-UK-TEX-M-TEX",
    eventTicker: "GEMI-NCAAF-2611141700-UK-TEX",
    eventTitle: "Kentucky at Texas",
    outcomeLabel: "Texas wins",
    category: "Sports",
    startsAt: KICK_TEX_UK,
    ask: 780000,
  },
];
const sportById = new Map(SPORTS.map((m) => [m.marketId, m]));

// Past SOL windows used by resolved promos.
const SOL_NO = solId(floor5(T0 - 4 * 3600)); // closed ~4 h ago, SOL closed down
const SOL_YES = solId(floor5(T0 - 75 * 60)); // closed ~75 min ago, SOL closed up
const OUTCOMES = new Map([
  ["GEMI-NCAAF-2611141700-UK-TEX-M-TEX", { outcome: "YES", at: KICK_TEX_UK + 4 * 3600 }],
  [SOL_NO, { outcome: "NO", at: solClose(SOL_NO) + 20 }],
  [SOL_YES, { outcome: "YES", at: solClose(SOL_YES) + 20 }],
]);
function outcomeOf(marketId) {
  const o = OUTCOMES.get(marketId);
  if (o) return o;
  // Any other SOL window that has ended (e.g. the app's own fixture promos): a stable sample result.
  const c = solClose(marketId);
  if (c && now() >= c + 5)
    return { outcome: parseInt(sha(marketId).slice(0, 2), 16) % 2 ? "YES" : "NO", at: c + 5 };
  return null;
}
function askOf(marketId) {
  const s = sportById.get(marketId);
  if (s) return s.ask;
  if (solClose(marketId)) return 470000 + (parseInt(sha(marketId).slice(0, 4), 16) % 5) * 10000; // 47-51¢
  return 550000;
}

/* ---------- shops ---------- */
const SHOPS = {
  barton: {
    merchant: addr("shop:barton-springs-coffee"),
    name: "Barton Springs Coffee Co.",
    location: "S Lamar Blvd, Austin",
    createdAt: iso(T0 - 9 * 86400),
  },
  lomita: {
    merchant: addr("shop:la-lomita"),
    name: "Taquería La Lomita",
    location: "E Cesar Chavez St, Austin",
    createdAt: iso(T0 - 6 * 86400),
  },
  spur: {
    merchant: addr("shop:rusty-spur"),
    name: "The Rusty Spur",
    location: "Rainey St, Austin",
    createdAt: iso(T0 - 5 * 86400),
  },
  bluebonnet: {
    merchant: addr("shop:bluebonnet-bakehouse"),
    name: "Bluebonnet Bakehouse",
    location: "E 6th St, Austin",
    createdAt: iso(T0 - 3 * 86400),
  },
};

/* ---------- promos ---------- */
// market: a sports market id, "SOL_LIVE[:slot]" (rolling live window), or a fixed past SOL id.
const PROMOS = [
  {
    key: "barton-latte-texas",
    shop: "barton",
    itemName: "Latte",
    offer: 5,
    market: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
    cap: 0.7,
    budget: 120,
  },
  {
    key: "barton-coldbrew-sol",
    shop: "barton",
    itemName: "Cold brew",
    offer: 4.5,
    market: "SOL_LIVE:0",
    cap: 0.55,
    budget: 40,
    outcomeLabel: "Up",
  },
  {
    key: "barton-cortado-sol",
    shop: "barton",
    itemName: "Cortado",
    offer: 4.5,
    market: "SOL_WAIT",
    cap: 0.55,
    budget: 30,
    outcomeLabel: "Up",
  },
  {
    key: "barton-latte-kentucky",
    shop: "barton",
    itemName: "Latte",
    offer: 5,
    market: "GEMI-NCAAF-2611141700-UK-TEX-M-TEX",
    cap: 0.85,
    budget: 80,
  },
  {
    key: "barton-mocha-sol",
    shop: "barton",
    itemName: "Mocha",
    offer: 5.5,
    market: SOL_NO,
    cap: 0.55,
    budget: 30,
    outcomeLabel: "Up",
  },
  {
    key: "lomita-plate-texas",
    shop: "lomita",
    itemName: "Taco plate",
    offer: 9,
    market: "GEMI-NCAAF-2611212030-ARK-TEX-M-TEX",
    cap: 0.7,
    budget: 150,
  },
  {
    key: "lomita-breakfast-sol",
    shop: "lomita",
    itemName: "Breakfast taco",
    offer: 3.75,
    market: "SOL_LIVE:1",
    cap: 0.55,
    budget: 25,
    outcomeLabel: "Up",
  },
  {
    key: "spur-pint-cowboys",
    shop: "spur",
    itemName: "Pint of Lone Star",
    offer: 7,
    market: "GEMI-NFL-2611230120-PHI-DAL-M-DAL",
    cap: 0.55,
    budget: 100,
  },
  {
    key: "bluebonnet-kolache-sol",
    shop: "bluebonnet",
    itemName: "Kolache box",
    offer: 12,
    market: SOL_YES,
    cap: 0.55,
    budget: 60,
    outcomeLabel: "Up",
  },
].map((p) => {
  const nonce = BigInt(`0x${sha(`nonce:${p.key}`).slice(0, 14)}`);
  return {
    id: uuid(`promo:${p.key}`),
    key: p.key,
    status: "ACTIVE",
    promoPda: h32(`promoPda:${p.key}`),
    promoNonce: nonce.toString(),
    shopKey: p.shop,
    itemName: p.itemName,
    offerAmount: USD(p.offer),
    market: p.market,
    outcomeLabelFixed: p.outcomeLabel ?? null,
    maxYesPriceMicroUsd: String(Math.round(p.cap * 1e6)),
    hedgeBudget: USD(p.budget),
    createdAt: T0 - 86400,
  };
});
const shopOf = (p) => (p.shopKey ? SHOPS[p.shopKey] : p.shop);

function marketOfPromo(p) {
  if (p.market === "SOL_WAIT") {
    // Sales closed 5-10 min ago; the window is still running, so the result is not in yet.
    const close = floor5(now()) + 300;
    return { marketId: solId(close), deadline: close - 600 };
  }
  if (typeof p.market === "string" && p.market.startsWith("SOL_LIVE")) {
    const w = liveSolWindow(Number(p.market.split(":")[1] ?? 0));
    return { marketId: w.marketId, deadline: w.deadline };
  }
  const s = sportById.get(p.market);
  if (s) return { marketId: s.marketId, deadline: s.startsAt };
  const c = solClose(p.market);
  if (c) return { marketId: p.market, deadline: c - 600 };
  return { marketId: p.market, deadline: p.depositDeadline ?? now() + 3600 };
}
function outcomeLabelOf(p, marketId) {
  if (p.outcomeLabelFixed) return p.outcomeLabelFixed;
  return sportById.get(marketId)?.outcomeLabel ?? "it happens";
}
function resolvedOf(p) {
  const { marketId, deadline } = marketOfPromo(p);
  if (now() < deadline) return null;
  return outcomeOf(marketId)?.outcome ?? null;
}

/* ---------- purchases ---------- */
const CUSTOMERS = [
  "ana",
  "marcus",
  "priya",
  "jordan",
  "sofia",
  "dev",
  "kayla",
  "luis",
  "emma",
  "tyler",
  "grace",
  "omar",
].map((n) => addr(`customer:${n}`));
const PURCHASES = [];
let seq = 0;
/** kind: deposited | hedged | failed (Cancelled) | refunded | won (Hedged, YES) | wonClaimed | lost (Hedged, NO) | lostClaimed */
function addPurchase(promoKey, kind, agoSecs, customerIdx) {
  const promo = PROMOS.find((p) => p.key === promoKey);
  const n = seq++;
  const key = h32(`purchase:${promoKey}:${n}`);
  const ask = askOf(marketOfPromo(promo).marketId);
  const amount = BigInt(promo.offerAmount);
  const filled = !["deposited", "failed", "refunded"].includes(kind);
  const premium = filled ? (amount * BigInt(ask) + 999_999n) / 1_000_000n : null;
  PURCHASES.push({
    key,
    promotionId: promo.id,
    customer: CUSTOMERS[customerIdx % CUSTOMERS.length],
    amount: promo.offerAmount,
    depositedAt: now() - agoSecs,
    hedge:
      kind === "deposited"
        ? null
        : filled
          ? {
              status: "SIMULATED_FILLED",
              failureReason: null,
              contracts: (Number(amount) / 1e6).toFixed(2),
              avgFillPriceMicroUsd: String(ask),
              premium: premium.toString(),
              quoteFetchedAt: iso(now() - agoSecs + 2),
            }
          : {
              status: "FAILED",
              failureReason: n % 2 ? "QUOTE_OVER_CAP" : "INSUFFICIENT_LIQUIDITY",
              contracts: "0",
              avgFillPriceMicroUsd: null,
              premium: null,
              quoteFetchedAt: iso(now() - agoSecs + 2),
            },
    depositTx: h32(`tx:dep:${key}`),
    markTx: filled ? h32(`tx:mark:${key}`) : null,
    cancelTx: kind === "failed" || kind === "refunded" ? h32(`tx:cancel:${key}`) : null,
    claimTx:
      kind === "refunded" || kind === "wonClaimed" || kind === "lostClaimed"
        ? h32(`tx:claim:${key}`)
        : null,
    claimedBy:
      kind === "refunded" || kind === "wonClaimed"
        ? "customer"
        : kind === "lostClaimed"
          ? "merchant"
          : null,
  });
  return key;
}
const SAMPLE = {};
// Barton latte / Texas vs Arkansas: selling now.
SAMPLE.hedged = addPurchase("barton-latte-texas", "hedged", 3 * 3600, 0);
addPurchase("barton-latte-texas", "hedged", 2 * 3600, 1);
addPurchase("barton-latte-texas", "hedged", 95 * 60, 2);
addPurchase("barton-latte-texas", "hedged", 40 * 60, 3);
SAMPLE.refundReady = addPurchase("barton-latte-texas", "failed", 25 * 60, 4);
addPurchase("barton-latte-texas", "hedged", 9 * 60, 5);
SAMPLE.deposited = addPurchase("barton-latte-texas", "deposited", 1, 6);
// Barton cold brew / SOL live window.
addPurchase("barton-coldbrew-sol", "hedged", 4 * 60, 7);
addPurchase("barton-coldbrew-sol", "hedged", 2 * 60, 8);
// Barton cortado / SOL window still running: sales closed, waiting for the result.
SAMPLE.waiting = addPurchase("barton-cortado-sol", "hedged", 16 * 60, 9);
addPurchase("barton-cortado-sol", "hedged", 15 * 60, 10);
addPurchase("barton-cortado-sol", "hedged", 14 * 60, 11);
SAMPLE.refunded = addPurchase("barton-cortado-sol", "refunded", 13 * 60, 0);
// Barton latte / Texas beat Kentucky: YES, customers get their money back.
SAMPLE.wonClaimable = addPurchase("barton-latte-kentucky", "won", 5 * 86400, 1);
SAMPLE.wonClaimed = addPurchase("barton-latte-kentucky", "wonClaimed", 5 * 86400 - 600, 2);
addPurchase("barton-latte-kentucky", "wonClaimed", 5 * 86400 - 1200, 3);
addPurchase("barton-latte-kentucky", "won", 4 * 86400, 4);
addPurchase("barton-latte-kentucky", "wonClaimed", 4 * 86400 - 900, 5);
addPurchase("barton-latte-kentucky", "refunded", 4 * 86400 - 1800, 6);
// Barton mocha / SOL closed down: NO, the shop keeps the money.
SAMPLE.lostClaimable = addPurchase("barton-mocha-sol", "lost", 4 * 3600 + 1800, 7);
addPurchase("barton-mocha-sol", "lost", 4 * 3600 + 1700, 8);
SAMPLE.lostClaimed = addPurchase("barton-mocha-sol", "lostClaimed", 4 * 3600 + 1600, 9);
addPurchase("barton-mocha-sol", "lostClaimed", 4 * 3600 + 1500, 10);
// Other shops.
addPurchase("lomita-plate-texas", "hedged", 5 * 3600, 2);
addPurchase("lomita-plate-texas", "hedged", 3 * 3600, 5);
addPurchase("lomita-plate-texas", "hedged", 30 * 60, 8);
addPurchase("lomita-breakfast-sol", "hedged", 3 * 60, 11);
addPurchase("spur-pint-cowboys", "hedged", 26 * 3600, 3);
addPurchase("spur-pint-cowboys", "hedged", 20 * 3600, 6);
addPurchase("spur-pint-cowboys", "failed", 2 * 3600, 9);
addPurchase("bluebonnet-kolache-sol", "won", 105 * 60, 4);
addPurchase("bluebonnet-kolache-sol", "wonClaimed", 100 * 60, 7);
addPurchase("bluebonnet-kolache-sol", "won", 96 * 60, 10);

/* ---------- DTO builders (ports of apps/api rules, same as the web fixture) ---------- */
function liveState(p, owner) {
  const { marketId, deadline } = marketOfPromo(p);
  const resolved = resolvedOf(p);
  const ask = now() < deadline ? askOf(marketId) : null;
  const cap = BigInt(p.maxYesPriceMicroUsd);
  const reserved = PURCHASES.filter((x) => x.promotionId === p.id && x.markTx).reduce(
    (a, x) => a + BigInt(x.hedge.premium),
    0n,
  );
  const budgetRemaining = BigInt(p.hedgeBudget) - reserved;
  const costPerSale =
    ask === null ? null : (BigInt(p.offerAmount) * BigInt(ask) + 999_999n) / 1_000_000n;
  const base = {
    liveAskMicroUsd: ask === null ? null : String(ask),
    costPerSale: costPerSale?.toString() ?? null,
  };
  if (owner)
    Object.assign(base, {
      thresholdBps: Number((cap * 10_000n) / 1_000_000n),
      budgetRemaining: budgetRemaining.toString(),
    });
  if (resolved === "YES") return { ...base, phase: "RESULT_YES", pauseReason: null, canBuy: false };
  if (resolved === "NO") return { ...base, phase: "RESULT_NO", pauseReason: null, canBuy: false };
  if (now() >= deadline)
    return { ...base, phase: "WAITING_FOR_RESULT", pauseReason: null, canBuy: false };
  const pause = (pauseReason) => ({ ...base, phase: "PAUSED", pauseReason, canBuy: false });
  if (ask === null) return pause("NO_LIVE_PRICE");
  if (BigInt(ask) > cap) return pause("PRICE_ABOVE_THRESHOLD");
  const buffer = cap / 5n < 20_000n ? cap / 5n : 20_000n;
  if (BigInt(ask) > cap - buffer) return pause("PRICE_NEAR_THRESHOLD");
  if (costPerSale > budgetRemaining) return pause("BUDGET_USED");
  return { ...base, phase: "LIVE", pauseReason: null, canBuy: true };
}
function promoDto(p, owner = false) {
  const { marketId, deadline } = marketOfPromo(p);
  const resolved = resolvedOf(p);
  const s = shopOf(p);
  const dto = {
    id: p.id,
    status: p.status,
    promoPda: p.status === "ACTIVE" ? p.promoPda : null,
    shop: { merchant: s.merchant, name: s.name, location: s.location },
    itemName: p.itemName,
    offerAmount: p.offerAmount,
    outcomeLabel: outcomeLabelOf(p, marketId),
    geminiMarketId: marketId,
    depositDeadline: deadline,
    onChainState: resolved === "YES" ? "ResolvedYes" : resolved === "NO" ? "ResolvedNo" : "Active",
    live: p.status === "ACTIVE" ? liveState(p, owner) : null,
  };
  if (owner)
    Object.assign(dto, { maxYesPriceMicroUsd: p.maxYesPriceMicroUsd, hedgeBudget: p.hedgeBudget });
  return dto;
}
function chainState(x) {
  if (x.claimedBy === "merchant") return "ClaimedByMerchant";
  if (x.claimedBy === "customer") return x.cancelTx ? "Refunded" : "ClaimedByCustomer";
  if (x.cancelTx) return "Cancelled";
  if (x.markTx) return "Hedged";
  return "Deposited";
}
function receiptStep(status, outcome) {
  const resolved = (o) =>
    o === "YES"
      ? {
          step: "YOU_WON",
          canServe: true,
          message: AUTO
            ? "It happened! Your money back is on its way."
            : "It happened! Your money back is ready.",
        }
      : o === "NO"
        ? { step: "NOT_THIS_TIME", canServe: true, message: "Not this time. Thanks for playing!" }
        : {
            step: "WAITING_FOR_RESULT",
            canServe: true,
            message: "Waiting for the official result.",
          };
  switch (status) {
    case "DEPOSITED":
    case "PENDING_HEDGE":
    case "HEDGE_SIMULATED":
      return { step: "PROCESSING", canServe: false, message: "Locking in your promo…" };
    case "HEDGED":
      return outcome
        ? resolved(outcome)
        : { step: "HEDGED", canServe: true, message: "You're in. Enjoy, and good luck!" };
    case "HEDGE_FAILED":
    case "CANCEL_PENDING":
      return {
        step: "REFUNDING",
        canServe: false,
        message: "This promo isn't available right now. Your payment is being returned.",
      };
    case "CANCELLED":
      return {
        step: "REFUND_READY",
        canServe: false,
        message: AUTO ? "Your refund is on its way." : "Your refund is ready to claim.",
      };
    case "REFUNDED":
      return { step: "REFUNDED", canServe: false, message: "Refunded." };
    case "RESOLVED":
      return resolved(outcome);
    case "CLAIMED":
      return { step: "DONE", canServe: true, message: "All settled." };
  }
}
function receipt(x) {
  const p = PROMOS.find((q) => q.id === x.promotionId);
  const { marketId, deadline } = marketOfPromo(p);
  const outcome = resolvedOf(p);
  const onChainState = chainState(x);
  const status =
    onChainState === "Refunded"
      ? "REFUNDED"
      : onChainState === "Cancelled"
        ? "CANCELLED"
        : onChainState === "ClaimedByCustomer" || onChainState === "ClaimedByMerchant"
          ? "CLAIMED"
          : onChainState === "Hedged"
            ? outcome
              ? "RESOLVED"
              : "HEDGED"
            : x.hedge?.status === "FAILED"
              ? "HEDGE_FAILED"
              : "PENDING_HEDGE";
  let hedgeStatus = x.hedge?.status;
  if (hedgeStatus === "SIMULATED_FILLED" && outcome)
    hedgeStatus = outcome === "YES" ? "SETTLED_WIN" : "SETTLED_LOSS";
  if (hedgeStatus === "FAILED" && x.cancelTx) hedgeStatus = "FAILED";
  void deadline;
  return {
    purchasePda: x.key,
    orderCode: orderCode(x.key),
    customer: x.customer,
    amount: x.amount,
    status,
    onChainState,
    ...receiptStep(status, outcome),
    autoPayout: AUTO,
    promotion: {
      id: p.id,
      shopName: shopOf(p).name,
      itemName: p.itemName,
      outcomeLabel: outcomeLabelOf(p, marketId),
      geminiMarketId: marketId,
      resolvedOutcome: outcome,
    },
    hedge: x.hedge && {
      simulated: true,
      status: hedgeStatus,
      failureReason: x.hedge.failureReason,
      contracts: x.hedge.contracts,
      avgFillPriceMicroUsd: x.hedge.avgFillPriceMicroUsd,
      premium: x.hedge.premium,
      virtualPayout:
        hedgeStatus === "SETTLED_WIN"
          ? String(Math.round(Number(x.hedge.contracts) * 1e6))
          : hedgeStatus === "SETTLED_LOSS"
            ? "0"
            : null,
      quoteFetchedAt: x.hedge.quoteFetchedAt,
      fingerprint: `sample-${x.key.slice(2, 26)}`,
    },
    transactions: {
      deposit: x.depositTx,
      markHedged: x.markTx,
      cancel: x.cancelTx,
      claim: x.claimTx,
    },
  };
}
const orderCode = (key) => key.slice(-4).toUpperCase();
/** A list row (counter feed, customer purchases): no hedge detail, like the API's summary. */
function summaryOf(x) {
  const r = receipt(x);
  return {
    purchasePda: r.purchasePda,
    orderCode: r.orderCode,
    customer: r.customer,
    amount: r.amount,
    depositedAt: x.depositedAt,
    status: r.status,
    onChainState: r.onChainState,
    step: r.step,
    canServe: r.canServe,
    message: r.message,
    autoPayout: AUTO,
    receipt: `/api/purchases/${x.key}`,
  };
}
const newestFirst = (a, b) => b.depositedAt - a.depositedAt;
function stats(p) {
  const rows = PURCHASES.filter((x) => x.promotionId === p.id).map(receipt);
  let hedged = 0,
    refunded = 0,
    sales = 0n,
    hundredths = 0n,
    premium = 0n;
  for (const r of rows) {
    if (
      r.hedge &&
      ["SIMULATED_FILLED", "SETTLED_WIN", "SETTLED_LOSS"].includes(r.hedge.status) &&
      ["HEDGED", "RESOLVED", "CLAIMED"].includes(r.status)
    ) {
      hedged++;
      sales += BigInt(r.amount);
      hundredths += BigInt(Math.round(Number(r.hedge.contracts) * 100));
      premium += BigInt(r.hedge.premium ?? "0");
    }
    if (["CANCELLED", "REFUNDED", "CANCEL_PENDING", "HEDGE_FAILED"].includes(r.status)) refunded++;
  }
  const payoutIfYes = hundredths * 10_000n;
  return {
    purchases: rows.length,
    hedged,
    refundedOrCancelled: refunded,
    hedgedSales: sales.toString(),
    contracts: (Number(hundredths) / 100).toFixed(2),
    premium: premium.toString(),
    ifYes: (payoutIfYes - premium).toString(),
    ifNo: (sales - premium).toString(),
  };
}

/* ---------- markets ---------- */
function windows(limit = 12) {
  const out = [];
  for (let i = 0; out.length < limit; i++) {
    const deadline = floor5(now() + 120) + i * 300;
    const opens = deadline + 300;
    const exp = opens + 300;
    const id = solId(exp);
    out.push({
      source: "gemini-predictions",
      marketId: id,
      eventTicker: id.replace(/-UP$/, ""),
      title: "SOL up or down",
      asset: "SOL",
      opensAt: iso(opens),
      expiresAt: iso(exp),
      phase: "upcoming",
      strikeUsd: null,
      strikeAvailableAt: null,
      bestAskMicroUsd: String(askOf(id)),
      askDepthContracts: String(800 + (parseInt(sha(id).slice(0, 3), 16) % 900)),
      recommendedDepositDeadline: deadline,
      fetchedAt: iso(now()),
    });
  }
  return out;
}
function summary(m) {
  return {
    source: "gemini-predictions",
    marketId: m.marketId,
    eventTicker: m.eventTicker,
    eventTitle: m.eventTitle,
    outcomeLabel: m.outcomeLabel.replace(/ wins?$/, "").replace(/^(.*) wins by/, "$1 wins by"),
    category: m.category,
    marketState: now() < m.startsAt ? "open" : "closed",
    bestAskMicroUsd: String(m.ask),
    bestBidMicroUsd: String(m.ask - 20000),
    lastTradeMicroUsd: String(m.ask - 10000),
    expiresAt: iso(m.startsAt + 5 * 3600),
    startsAt: iso(m.startsAt),
    opensAt: null,
    marketKind: "STANDARD",
    fetchedAt: iso(now()),
  };
}
function quote(marketId, refundAmount) {
  const ask = askOf(marketId);
  const s = sportById.get(marketId);
  const amount = BigInt(refundAmount ?? "5000000");
  const contracts = (Number(amount) / 1e6).toFixed(2);
  return {
    quote: {
      source: "gemini-predictions",
      marketId,
      fetchedAt: iso(now()),
      yesAskMicroUsd: String(ask),
      asks: [
        { priceMicroUsd: String(ask), quantity: "1200" },
        { priceMicroUsd: String(ask + 10000), quantity: "2500" },
        { priceMicroUsd: String(ask + 20000), quantity: "4000" },
      ],
    },
    eventTicker: s?.eventTicker ?? marketId.replace(/-UP$/, ""),
    eventTitle: s?.eventTitle ?? "SOL up or down",
    outcomeLabel: s?.outcomeLabel ?? "Up",
    marketState: s && now() >= s.startsAt ? "closed" : "open",
    estimate: {
      simulated: true,
      marketId,
      status: "SIMULATED_FILLED",
      failureReason: null,
      requestedContracts: contracts,
      filledContracts: contracts,
      avgFillPriceMicroUsd: String(ask),
      premium: ((amount * BigInt(ask) + 999_999n) / 1_000_000n).toString(),
      modeledFee: "0",
      quoteFetchedAt: iso(now()),
      assumptions: [
        "Sample data: invented prices, no Gemini call",
        "Fills at the best ask up to the listed depth",
      ],
    },
  };
}

/* ---------- http ---------- */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(status === 204 ? "" : JSON.stringify(body));
}
const readBody = (req) =>
  new Promise((r) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => {
      try {
        r(s ? JSON.parse(s) : {});
      } catch {
        r({});
      }
    });
  });
const findPromo = (id) => PROMOS.find((p) => p.id === id);
const isOwner = (req) => Boolean(req.headers["x-user-token"]);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const method = req.method;
  const qp = (k) => url.searchParams.get(k);
  let m;
  try {
    if (method === "OPTIONS") return send(res, 204, null);
    console.log(`${new Date().toISOString()} ${method} ${p}${url.search}`);
    if (p === "/health") return send(res, 200, { status: "ok", time: iso(now()) });
    if (p === "/__sample") {
      const promos = PROMOS.map((x) => ({
        id: x.id,
        key: x.key,
        shop: shopOf(x).name,
        item: x.itemName,
        merchant: shopOf(x).merchant,
        phase: liveState(x).phase,
      }));
      const receipts = Object.fromEntries(
        Object.entries(SAMPLE).map(([k, key]) => [
          k,
          {
            key,
            promotionId: PURCHASES.find((x) => x.key === key).promotionId,
            customer: PURCHASES.find((x) => x.key === key).customer,
          },
        ]),
      );
      return send(res, 200, { note: "SAMPLE DATA ONLY", shops: SHOPS, promos, receipts });
    }
    if (p === "/api/markets/windows")
      return send(res, 200, {
        source: "gemini-predictions",
        asset: qp("asset") ?? "SOL",
        windows: windows(Number(qp("limit") ?? 12)),
      });
    if (p === "/api/markets") {
      const q = (qp("search") ?? "").toLowerCase();
      const list = SPORTS.filter(
        (s) =>
          now() < s.startsAt &&
          (!q || `${s.eventTitle} ${s.outcomeLabel}`.toLowerCase().includes(q)),
      ).map(summary);
      return send(res, 200, {
        source: "gemini-predictions",
        totalEvents: new Set(list.map((x) => x.eventTicker)).size,
        markets: list.slice(0, Number(qp("limit") ?? 20)),
      });
    }
    if ((m = /^\/api\/markets\/([^/]+)\/quote$/.exec(p)))
      return send(res, 200, quote(decodeURIComponent(m[1]), qp("refundAmount")));
    if ((m = /^\/api\/markets\/([^/]+)\/deadline-check$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      const dl = Number(qp("depositDeadline"));
      const c = solClose(id);
      const s = sportById.get(id);
      const latest = c ? c - 600 : s ? s.startsAt : null;
      if (latest === null)
        return send(res, 200, {
          marketId: id,
          marketKind: "STANDARD",
          ok: false,
          latest: null,
          reason: "MARKET_TIMING_UNKNOWN",
        });
      const kind = c ? "UP_DOWN" : "STANDARD";
      if (latest <= now())
        return send(res, 200, {
          marketId: id,
          marketKind: kind,
          ok: false,
          latest,
          reason: "MARKET_NOT_OPEN",
        });
      if (dl < now() + 60)
        return send(res, 200, {
          marketId: id,
          marketKind: kind,
          ok: false,
          latest,
          reason: "DEADLINE_TOO_SOON",
        });
      if (dl > latest)
        return send(res, 200, {
          marketId: id,
          marketKind: kind,
          ok: false,
          latest,
          reason: "DEADLINE_AFTER_LAST_HEDGEABLE_TIME",
        });
      return send(res, 200, { marketId: id, marketKind: kind, ok: true, latest });
    }
    if ((m = /^\/api\/markets\/([^/]+)\/outcome$/.exec(p))) {
      const id = decodeURIComponent(m[1]);
      const o = outcomeOf(id);
      return send(res, 200, {
        marketId: id,
        outcome: o
          ? {
              marketId: id,
              outcome: o.outcome,
              source: "manual-demo-fixture",
              resolvedAt: iso(o.at),
              fetchedAt: iso(now()),
            }
          : null,
      });
    }
    if ((m = /^\/api\/events\/([^/]+)\/lines$/.exec(p))) {
      const ticker = decodeURIComponent(m[1]);
      const team = (qp("team") ?? "").toUpperCase();
      const refund = BigInt(qp("refundAmount") ?? "5000000");
      const maxBps = BigInt(qp("maxCostBps") ?? "7000");
      const lines = SPORTS.filter(
        (s) => s.eventTicker === ticker && (!team || s.marketId.includes(`-${team}`)),
      ).map((s) => {
        const cost = (refund * BigInt(s.ask) + 999_999n) / 1_000_000n;
        const fits = cost * 10_000n <= refund * maxBps;
        return {
          marketId: s.marketId,
          eventTitle: s.eventTitle,
          label: s.outcomeLabel,
          bestAskMicroUsd: String(s.ask),
          costPerSale: cost.toString(),
          fits,
          reason: fits ? null : "Costs more than your limit",
        };
      });
      return send(res, 200, {
        lines,
        suggested: lines.find((l) => l.fits) ?? null,
        simulated: true,
      });
    }
    if (p === "/api/promotions" && method === "GET")
      return send(res, 200, {
        promotions: PROMOS.filter((x) => x.status === "ACTIVE").map((x) => promoDto(x)),
      });
    if (p === "/api/promotions" && method === "POST") {
      const b = await readBody(req);
      const nonce = BigInt(`0x${sha(randomUUID()).slice(0, 14)}`);
      const promo = {
        id: randomUUID(),
        key: `created-${PROMOS.length}`,
        status: "DRAFT",
        promoPda: h32(`created:${nonce}`),
        promoNonce: nonce.toString(),
        shop: {
          merchant: String(b.merchant ?? "").toLowerCase(),
          name: b.shopName ?? "New shop",
          location: b.location ?? "",
        },
        itemName: b.itemName ?? "Item",
        offerAmount: String(b.offerAmount ?? "5000000"),
        market: b.geminiMarketId,
        depositDeadline: Number(b.depositDeadline),
        outcomeLabelFixed: b.outcomeLabel ?? null,
        maxYesPriceMicroUsd: String(b.maxYesPriceMicroUsd ?? "550000"),
        hedgeBudget: String(b.hedgeBudget ?? "25000000"),
        createdAt: now(),
      };
      // A created promo keeps its own deadline (not the market's).
      PROMOS.push(promo);
      return send(res, 201, {
        promotion: promoDto(promo, true),
        initializePromo: {
          promoNonce: promo.promoNonce,
          offerAmount: promo.offerAmount,
          depositDeadline: promo.depositDeadline,
          marketId: promo.market,
        },
      });
    }
    if ((m = /^\/api\/promotions\/([^/]+)\/confirm$/.exec(p)) && method === "POST") {
      const x = findPromo(decodeURIComponent(m[1]));
      if (!x) return send(res, 404, { error: "promotion_not_found" });
      x.status = "ACTIVE";
      return send(res, 200, { promotion: promoDto(x, true) });
    }
    if ((m = /^\/api\/promotions\/([^/]+)\/initialize$/.exec(p)) && method === "POST") {
      const x = findPromo(decodeURIComponent(m[1]));
      if (!x) return send(res, 404, { error: "promotion_not_found" });
      if (x.status !== "DRAFT") return send(res, 409, { error: "already_published" });
      return send(res, 200, {
        challengeId: randomUUID(),
        promoPda: x.promoPda,
        confirm: `/api/promotions/${x.id}/confirm`,
      });
    }
    if ((m = /^\/api\/promotions\/([^/]+)\/purchases$/.exec(p))) {
      const x = findPromo(decodeURIComponent(m[1]));
      if (!x) return send(res, 404, { error: "promotion_not_found" });
      return send(res, 200, {
        promotionId: x.id,
        purchases: PURCHASES.filter((y) => y.promotionId === x.id)
          .sort(newestFirst)
          .slice(0, 50)
          .map(summaryOf),
      });
    }
    if ((m = /^\/api\/promotions\/([^/]+)$/.exec(p))) {
      const x = findPromo(decodeURIComponent(m[1]));
      if (!x) return send(res, 404, { error: "promotion_not_found" });
      return send(res, 200, { promotion: promoDto(x) });
    }
    if ((m = /^\/api\/merchants\/([^/]+)\/dashboard$/.exec(p))) {
      const a = decodeURIComponent(m[1]).toLowerCase();
      const mine = PROMOS.filter((x) => shopOf(x).merchant === a);
      const shop = Object.values(SHOPS).find((s) => s.merchant === a);
      if (!mine.length) return send(res, 404, { error: "merchant_not_found" });
      const owner = isOwner(req);
      return send(res, 200, {
        merchant: {
          pubkey: a,
          shopName: shop?.name ?? shopOf(mine[0]).name,
          location: shop?.location ?? shopOf(mine[0]).location,
          createdAt: shop?.createdAt ?? iso(mine[0].createdAt),
        },
        viewer: owner ? "owner" : "public",
        simulatedHedges: true,
        promotions: mine.map((x) => ({ ...promoDto(x, owner), stats: stats(x) })),
      });
    }
    if (p === "/api/purchases" && method === "GET") {
      const c = (qp("customer") ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(c)) return send(res, 400, { error: "invalid_customer" });
      const rows = PURCHASES.filter((y) => y.customer === c)
        .sort(newestFirst)
        .slice(0, 50)
        .map((y) => {
          const promo = findPromo(y.promotionId);
          const { marketId } = marketOfPromo(promo);
          return {
            ...summaryOf(y),
            promotion: {
              id: promo.id,
              shopName: shopOf(promo).name,
              itemName: promo.itemName,
              outcomeLabel: outcomeLabelOf(promo, marketId),
              resolvedOutcome: resolvedOf(promo),
            },
          };
        });
      return send(res, 200, { customer: c, purchases: rows });
    }
    if ((m = /^\/api\/purchases\/(0x[0-9a-fA-F]{64})$/.exec(p))) {
      const x = PURCHASES.find((y) => y.key === m[1].toLowerCase());
      if (!x) return send(res, 404, { error: "purchase_not_found" });
      return send(res, 200, receipt(x));
    }
    // Checkout (reached only when the web fixture is off): no real wallet, appends in memory.
    if ((m = /^\/api\/checkout\/([^/]+)\/(status|approve|deposit|sign|submit)$/.exec(p))) {
      const x = findPromo(decodeURIComponent(m[1]));
      if (!x) return send(res, 404, { error: "promotion_not_found" });
      if (!req.headers["x-user-token"]) return send(res, 401, { error: "login_required" });
      const live = liveState(x);
      if (m[2] === "status")
        return send(res, 200, {
          promoId: x.id,
          price: x.offerAmount,
          canBuy: live.canBuy,
          pauseReason: live.pauseReason,
          usdcBalance: "20000000",
          enoughBalance: true,
          checkout: AUTO ? "one-tap" : "approve-deposit",
          needsApproval: false,
        });
      if (m[2] === "approve") return send(res, 409, { error: "already_approved" });
      if ((m[2] === "sign" || m[2] === "submit") && !AUTO)
        return send(res, 409, { error: "one_tap_unavailable" });
      const b = await readBody(req);
      if (m[2] === "sign") {
        if (!live.canBuy)
          return send(res, 409, { error: "promo_not_buyable", pauseReason: live.pauseReason });
        const purchaseIdHex = sha(randomUUID()).slice(0, 32);
        return send(res, 200, {
          step: "sign",
          challengeId: randomUUID(),
          purchaseIdHex,
          purchaseKey: h32(`live:${x.id}:${purchaseIdHex}`),
          validBefore: now() + 300,
          submit: `/api/checkout/${x.id}/submit`,
        });
      }
      if (m[2] === "submit") {
        if (typeof b.purchaseIdHex !== "string" || !/^[0-9a-f]{32}$/.test(b.purchaseIdHex))
          return send(res, 400, { error: "invalid_purchase_id" });
        if (typeof b.validBefore !== "number")
          return send(res, 400, { error: "invalid_valid_before" });
        if (typeof b.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(b.signature))
          return send(res, 400, { error: "invalid_signature" });
        if (b.validBefore <= now()) return send(res, 409, { error: "signature_expired" });
      }
      if (!live.canBuy)
        return send(res, 409, { error: "promo_not_buyable", pauseReason: live.pauseReason });
      const purchaseIdHex = m[2] === "submit" ? b.purchaseIdHex : sha(randomUUID()).slice(0, 32);
      const key = h32(`live:${x.id}:${purchaseIdHex}`);
      if (!PURCHASES.some((y) => y.key === key))
        PURCHASES.push({
          key,
          promotionId: x.id,
          customer: addr(`wallet:${b.walletId ?? "anon"}`),
          amount: x.offerAmount,
          depositedAt: now(),
          hedge: null,
          depositTx: h32(`tx:${key}`),
          markTx: null,
          cancelTx: null,
          claimTx: null,
          claimedBy: null,
        });
      if (m[2] === "submit")
        return send(res, 200, {
          step: "submitted",
          purchaseKey: key,
          receipt: `/api/purchases/${key}`,
          txHash: h32(`tx:${key}`),
          alreadyApplied: false,
        });
      return send(res, 200, {
        step: "deposit",
        challengeId: randomUUID(),
        purchaseIdHex,
        purchaseKey: key,
        receipt: `/api/purchases/${key}`,
      });
    }
    if (p === "/api/purchases/claim-merchant" && method === "POST") {
      const b = await readBody(req);
      const keys = Array.isArray(b.purchaseKeys) ? b.purchaseKeys : [];
      if (keys.length === 0 || keys.length > 20)
        return send(res, 400, { error: "invalid_purchase_keys" });
      return send(res, 200, {
        challenges: keys.map((k) => ({
          purchaseKey: String(k).toLowerCase(),
          challengeId: randomUUID(),
        })),
      });
    }
    if (
      (m = /^\/api\/purchases\/([^/]+)\/(claim-refund|cancel-expired)$/.exec(p)) &&
      method === "POST"
    ) {
      const x = PURCHASES.find((y) => y.key === m[1].toLowerCase());
      if (!x) return send(res, 404, { error: "purchase_not_found" });
      const state = chainState(x);
      if (m[2] === "cancel-expired" && state !== "Deposited")
        return send(res, 409, { error: "not_cancellable", onChainState: state });
      return send(res, 200, { challengeId: randomUUID(), purchaseKey: x.key });
    }
    return send(res, 404, { error: "Not Found", message: `Route ${method}:${p} not found` });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: "internal", message: String(e?.message ?? e) });
  }
});

// Simulated hedging for purchases appended at runtime: covered 3 s after payment.
setInterval(() => {
  for (const x of PURCHASES) {
    if (
      !x.hedge &&
      now() - x.depositedAt >= 3 &&
      x.key.startsWith("0x") &&
      !Object.values(SAMPLE).includes(x.key)
    ) {
      const promo = findPromo(x.promotionId);
      const ask = askOf(marketOfPromo(promo).marketId);
      const amount = BigInt(x.amount);
      x.hedge = {
        status: "SIMULATED_FILLED",
        failureReason: null,
        contracts: (Number(amount) / 1e6).toFixed(2),
        avgFillPriceMicroUsd: String(ask),
        premium: ((amount * BigInt(ask) + 999_999n) / 1_000_000n).toString(),
        quoteFetchedAt: iso(now()),
      };
      x.markTx = h32(`tx:mark:${x.key}`);
    }
  }
}, 1000).unref();

server.listen(PORT, () =>
  console.log(`sample promo API on http://localhost:${PORT} (SAMPLE DATA ONLY)`),
);
