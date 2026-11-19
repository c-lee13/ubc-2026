/**
 * DEV-ONLY FIXTURE. Never live: loaded only when NEXT_PUBLIC_WALLET_FIXTURE=1 in a non-production
 * build (see config.ts). It lets the Circle email-login checkout be clicked through without a
 * Circle App ID or a real email code, by mocking in the browser, in the shapes of
 * docs/FRONTEND-API.md:
 *   - Circle's code and approval screens (stand-in sheets, clearly labeled),
 *   - /api/wallet/*, /api/checkout/* (one-tap sign + submit; approve + deposit in v1 mode),
 *     receipts and purchase lists of fixture purchases, and the shop and claim routes
 *     (initialize, counter feed, customer purchases, claim-refund, cancel-expired, claim-merchant),
 *   - promos created here (kept in localStorage, never written to the real API).
 * It behaves like escrow v2 (one-tap checkout, automatic payouts). To try the v1 fallback (approve +
 * deposit, claim buttons) run `localStorage.setItem("hedged:fixture:escrow", "v1")` and reload.
 * Market data stays REAL: windows, quotes, deadline checks and official outcomes are fetched from
 * the API (or scripts/sample-api.mjs), so only the wallet and the chain side are faked.
 */
import { promoIdOf, purchaseKeyOf } from "@hedged/arc";
import type { Address, Hex } from "viem";
import type {
  CreatePromotionInput,
  CustomerPurchaseDto,
  LiveStateDto,
  PauseReason,
  PromotionDto,
  PromoStatsDto,
  PurchaseReceiptDto,
  PurchaseSummaryDto,
  ReceiptStep,
  Transport,
} from "../api";
import { marketMeaning } from "../format";
import type { ChallengeOutcome, CircleSession, WalletDriver } from "./driver";
import { WalletUserError } from "./driver";
import { showFixtureSheet } from "./fixture-bus";

const KEY = "hedged:fixture:v2";
const ALLOWANCE_CAP = 100_000_000n;
const DRIP = 20_000_000n;
/** Same as the API: a one-tap signature is valid 5 minutes (capped at the deadline). */
const SIGNATURE_TTL_SECS = 300;
/** Demo cancel timeout on Arc (the customer may cancel a still-uncovered payment after it). */
const CANCEL_TIMEOUT_SECS = 600;
/** Automatic payouts (v2) land this long after they become due. */
const AUTO_PAYOUT_DELAY_SECS = 3;

/** Escrow v2 (default): one-tap + automatic payouts. "v1": approve + deposit + claim buttons. */
const isV1 = () => {
  try {
    return window.localStorage.getItem("hedged:fixture:escrow") === "v1";
  } catch {
    return false;
  }
};

interface FxWallet {
  id: string;
  email: string;
  address: string;
  balance: string;
  allowance: string;
  initialized: boolean;
  lastDrip: number | null;
}
interface FxPromo {
  id: string;
  status: "DRAFT" | "ACTIVE";
  promoPda: string | null;
  promoNonce: string;
  merchant: string;
  shopName: string;
  location: string;
  itemName: string;
  offerAmount: string;
  outcomeLabel: string;
  geminiMarketId: string;
  depositDeadline: number;
  maxYesPriceMicroUsd: string;
  hedgeBudget: string;
  reservedPremium: string;
  initialized: boolean;
  resolvedOutcome: "YES" | "NO" | null;
  resolvedAt: number | null;
}
interface FxPurchase {
  key: string;
  promotionId: string;
  customer: string;
  amount: string;
  depositedAt: number;
  askAtDeposit: string | null;
  depositTx: string;
  hedge: {
    status: "SIMULATED_FILLED" | "FAILED" | "SETTLED_WIN" | "SETTLED_LOSS";
    failureReason: "QUOTE_OVER_CAP" | "QUOTE_UNAVAILABLE" | null;
    contracts: string;
    avgFillPriceMicroUsd: string | null;
    premium: string | null;
  } | null;
  markTx: string | null;
  cancelTx: string | null;
  cancelledAt: number | null;
  claimTx: string | null;
  claimedBy: "customer" | "merchant" | null;
}
interface FxChallenge {
  id: string;
  kind:
    | "init"
    | "approve"
    | "deposit"
    | "sign"
    | "initialize"
    | "claim-refund"
    | "cancel-expired"
    | "claim-merchant";
  walletId: string;
  ref: string[];
}
/** A one-tap payment authorization the fixture "signed" (sign challenge approved). */
interface FxSignature {
  walletId: string;
  promotionId: string;
  key: string;
  ask: string;
  purchaseIdHex: string;
  validBefore: number;
  used: boolean;
}
interface FxState {
  wallets: Record<string, FxWallet>;
  tokens: Record<string, string>;
  promos: FxPromo[];
  purchases: FxPurchase[];
  challenges: Record<string, FxChallenge>;
  signatures: Record<string, FxSignature>;
}

/* ---------- storage + ids ---------- */

function load(): FxState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const st = JSON.parse(raw) as Omit<FxState, "signatures"> & Partial<FxState>;
      return { ...st, signatures: st.signatures ?? {} };
    }
  } catch {
    // fall through
  }
  return { wallets: {}, tokens: {}, promos: [], purchases: [], challenges: {}, signatures: {} };
}
function save(s: FxState) {
  window.localStorage.setItem(KEY, JSON.stringify(s));
}
const hex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const fakeHash = () => `0x${hex(32)}`;
const nowS = () => Math.floor(Date.now() / 1000);

/* ---------- the stand-in Circle driver ---------- */

export function createFixtureDriver(): WalletDriver {
  return {
    kind: "fixture",
    async getDeviceId() {
      const k = "hedged:fixture:device";
      const v = window.localStorage.getItem(k) ?? `fixture-device-${hex(8)}`;
      window.localStorage.setItem(k, v);
      return v;
    },
    verifyEmail(login, email) {
      return new Promise<CircleSession>((resolve, reject) => {
        showFixtureSheet({
          kind: "otp",
          email,
          resolve: (code) => {
            showFixtureSheet(null);
            if (!/^\d{6}$/.test(code)) {
              reject(new WalletUserError("Code not accepted", "Enter the 6-digit code."));
              return;
            }
            const s = load();
            const token = `fixture-user-token-${hex(16)}`;
            s.tokens[token] = login.otpToken; // otpToken = wallet id in the fixture
            save(s);
            resolve({ userToken: token, encryptionKey: "fixture-encryption-key" });
          },
          reject: () => {
            showFixtureSheet(null);
            reject(new WalletUserError("Login cancelled", "You closed the code screen."));
          },
        });
      });
    },
    setAuthentication() {},
    execute(challengeId, what) {
      return new Promise<ChallengeOutcome>((resolve, reject) => {
        showFixtureSheet({
          kind: "approve",
          what,
          resolve: () => {
            showFixtureSheet(null);
            resolve(completeChallenge(challengeId));
          },
          reject: () => {
            showFixtureSheet(null);
            reject(
              new WalletUserError("Not approved", "You closed the approval, so nothing was sent."),
            );
          },
        });
      });
    },
  };
}

function completeChallenge(id: string): ChallengeOutcome {
  const s = load();
  const c = s.challenges[id];
  if (!c) return {};
  delete s.challenges[id];
  const w = s.wallets[c.walletId];
  if (!w) {
    save(s);
    return {};
  }
  let outcome: ChallengeOutcome = {};
  switch (c.kind) {
    case "init":
      w.initialized = true;
      break;
    case "approve":
      w.allowance = ALLOWANCE_CAP.toString();
      break;
    case "deposit": {
      const [promotionId, key, ask] = c.ref;
      const promo = s.promos.find((p) => p.id === promotionId);
      if (!promo || !key) break;
      w.allowance = (BigInt(w.allowance) - BigInt(promo.offerAmount)).toString();
      recordDeposit(s, w, promo, key, ask ?? "");
      break;
    }
    case "sign": {
      // A stand-in EIP-3009 signature: the fixture's submit route accepts it once.
      const [promotionId, key, ask, purchaseIdHex, validBefore] = c.ref;
      const signature = `0x${hex(65)}`;
      s.signatures[signature] = {
        walletId: w.id,
        promotionId: promotionId ?? "",
        key: key ?? "",
        ask: ask ?? "",
        purchaseIdHex: purchaseIdHex ?? "",
        validBefore: Number(validBefore),
        used: false,
      };
      outcome = { signature };
      break;
    }
    case "cancel-expired": {
      const p = s.purchases.find((x) => x.key === c.ref[0]);
      if (p && !p.markTx && !p.cancelTx) {
        p.cancelTx = fakeHash();
        p.cancelledAt = nowS();
      }
      break;
    }
    case "initialize": {
      const promo = s.promos.find((p) => p.id === c.ref[0]);
      if (promo) promo.initialized = true;
      break;
    }
    case "claim-refund":
    case "claim-merchant": {
      for (const key of c.ref) {
        const p = s.purchases.find((x) => x.key === key);
        if (!p || p.claimedBy) continue;
        payOut(s, p, c.kind === "claim-refund" ? "customer" : "merchant");
      }
      break;
    }
  }
  save(s);
  return outcome;
}

/** The payment lands in the escrow (deposit, or the relayer's one-tap submit). */
function recordDeposit(s: FxState, w: FxWallet, promo: FxPromo, key: string, ask: string) {
  w.balance = (BigInt(w.balance) - BigInt(promo.offerAmount)).toString();
  const tx = fakeHash();
  s.purchases.push({
    key,
    promotionId: promo.id,
    customer: w.address,
    amount: promo.offerAmount,
    depositedAt: nowS(),
    askAtDeposit: ask || null,
    depositTx: tx,
    hedge: null,
    markTx: null,
    cancelTx: null,
    cancelledAt: null,
    claimTx: null,
    claimedBy: null,
  });
  return tx;
}

/** Escrow pays a purchase out (a claim, or v2's automatic payout): credit the receiving wallet. */
function payOut(s: FxState, p: FxPurchase, to: "customer" | "merchant") {
  const promo = s.promos.find((x) => x.id === p.promotionId);
  const addr = to === "customer" ? p.customer : promo?.merchant;
  p.claimTx = fakeHash();
  p.claimedBy = to;
  const w = Object.values(s.wallets).find((x) => x.address === addr);
  if (w) w.balance = (BigInt(w.balance) + BigInt(p.amount)).toString();
}

/* ---------- the mocked API ---------- */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createFixtureTransport(real: Transport): Transport {
  const askCache = new Map<string, { at: number; ask: string | null }>();

  async function liveAsk(marketId: string, base: string): Promise<string | null> {
    const c = askCache.get(marketId);
    if (c && Date.now() - c.at < 8000) return c.ask;
    let ask: string | null = null;
    try {
      const r = await real(`${base}/api/markets/${encodeURIComponent(marketId)}/quote`, {
        cache: "no-store",
      });
      if (r.ok)
        ask = ((await r.json()) as { quote: { yesAskMicroUsd: string } }).quote.yesAskMicroUsd;
    } catch {
      ask = null;
    }
    askCache.set(marketId, { at: Date.now(), ask });
    return ask;
  }

  async function settle(s: FxState, base: string) {
    // Resolve fixture promos from Gemini's REAL official outcome once their window has ended.
    for (const promo of s.promos) {
      if (promo.status !== "ACTIVE" || promo.resolvedOutcome) continue;
      const m = marketMeaning(promo.geminiMarketId);
      const ended = m.closesAt ? nowS() >= m.closesAt + 3 : nowS() >= promo.depositDeadline + 600;
      if (!ended) continue;
      try {
        const r = await real(
          `${base}/api/markets/${encodeURIComponent(promo.geminiMarketId)}/outcome`,
          { cache: "no-store" },
        );
        if (!r.ok) continue;
        const o = (await r.json()) as { outcome: { outcome: "YES" | "NO" } | null };
        if (o.outcome) {
          promo.resolvedOutcome = o.outcome.outcome;
          promo.resolvedAt = nowS();
        }
      } catch {
        // stays pending
      }
    }
    // Purchases: simulated hedge 3 s after payment; a failed one is cancelled 3 s later.
    for (const p of s.purchases) {
      const promo = s.promos.find((x) => x.id === p.promotionId);
      if (!promo) continue;
      const age = nowS() - p.depositedAt;
      if (!p.hedge && age >= 3) {
        const ask = p.askAtDeposit ? BigInt(p.askAtDeposit) : null;
        if (ask !== null && ask <= BigInt(promo.maxYesPriceMicroUsd)) {
          const premium = (BigInt(p.amount) * ask + 999_999n) / 1_000_000n;
          p.hedge = {
            status: "SIMULATED_FILLED",
            failureReason: null,
            contracts: (Number(p.amount) / 1e6).toFixed(2),
            avgFillPriceMicroUsd: ask.toString(),
            premium: premium.toString(),
          };
          promo.reservedPremium = (BigInt(promo.reservedPremium) + premium).toString();
          p.markTx = fakeHash();
        } else {
          p.hedge = {
            status: "FAILED",
            failureReason: ask === null ? "QUOTE_UNAVAILABLE" : "QUOTE_OVER_CAP",
            contracts: "0",
            avgFillPriceMicroUsd: null,
            premium: null,
          };
        }
      }
      if (p.hedge?.status === "FAILED" && !p.cancelTx && age >= 6) {
        p.cancelTx = fakeHash();
        p.cancelledAt = nowS();
      }
      if (p.hedge?.status === "SIMULATED_FILLED" && promo.resolvedOutcome) {
        p.hedge.status = promo.resolvedOutcome === "YES" ? "SETTLED_WIN" : "SETTLED_LOSS";
      }
      // Escrow v2: the relayer pays out on its own (refund after a cancel; YES -> customer,
      // NO -> shop after the result).
      if (!isV1() && !p.claimedBy) {
        if (p.cancelTx && nowS() - (p.cancelledAt ?? p.depositedAt) >= AUTO_PAYOUT_DELAY_SECS) {
          payOut(s, p, "customer");
        } else if (
          p.markTx &&
          promo.resolvedOutcome &&
          nowS() - (promo.resolvedAt ?? 0) >= AUTO_PAYOUT_DELAY_SECS
        ) {
          payOut(s, p, promo.resolvedOutcome === "YES" ? "customer" : "merchant");
        }
      }
    }
  }

  function chainState(p: FxPurchase, promo: FxPromo): PurchaseReceiptDto["onChainState"] {
    if (p.claimedBy === "merchant") return "ClaimedByMerchant";
    if (p.claimedBy === "customer") return p.cancelTx ? "Refunded" : "ClaimedByCustomer";
    if (p.cancelTx) return "Cancelled";
    if (p.markTx) return "Hedged";
    void promo;
    return "Deposited";
  }

  function receipt(p: FxPurchase, promo: FxPromo): PurchaseReceiptDto {
    const onChainState = chainState(p, promo);
    const status: PurchaseReceiptDto["status"] =
      onChainState === "Refunded"
        ? "REFUNDED"
        : onChainState === "Cancelled"
          ? "CANCELLED"
          : onChainState === "ClaimedByCustomer" || onChainState === "ClaimedByMerchant"
            ? "CLAIMED"
            : onChainState === "Hedged"
              ? promo.resolvedOutcome
                ? "RESOLVED"
                : "HEDGED"
              : p.hedge?.status === "FAILED"
                ? "HEDGE_FAILED"
                : "PENDING_HEDGE";
    const r = receiptStep(status, promo.resolvedOutcome, !isV1());
    return {
      purchasePda: p.key,
      orderCode: p.key.slice(-4).toUpperCase(),
      customer: p.customer,
      amount: p.amount,
      status,
      onChainState,
      ...r,
      autoPayout: !isV1(),
      promotion: {
        id: promo.id,
        shopName: promo.shopName,
        itemName: promo.itemName,
        outcomeLabel: promo.outcomeLabel,
        geminiMarketId: promo.geminiMarketId,
        resolvedOutcome: promo.resolvedOutcome,
      },
      hedge: p.hedge && {
        simulated: true,
        status: p.hedge.status,
        failureReason: p.hedge.failureReason,
        contracts: p.hedge.contracts,
        avgFillPriceMicroUsd: p.hedge.avgFillPriceMicroUsd,
        premium: p.hedge.premium,
        virtualPayout: null,
        quoteFetchedAt: null,
        fingerprint: `fixture-${p.key.slice(2, 26)}`,
      },
      transactions: {
        deposit: p.depositTx,
        markHedged: p.markTx,
        cancel: p.cancelTx,
        claim: p.claimTx,
      },
    };
  }

  /** A list row (counter feed, customer purchases), from the full receipt. */
  function summary(p: FxPurchase, promo: FxPromo): PurchaseSummaryDto {
    const r = receipt(p, promo);
    return {
      purchasePda: r.purchasePda,
      orderCode: r.orderCode,
      customer: r.customer,
      amount: r.amount,
      depositedAt: p.depositedAt,
      status: r.status,
      onChainState: r.onChainState,
      step: r.step,
      canServe: r.canServe,
      message: r.message,
      autoPayout: r.autoPayout,
      receipt: `/api/purchases/${p.key}`,
    };
  }

  async function promoDto(promo: FxPromo, base: string): Promise<PromotionDto> {
    let live: LiveStateDto | null = null;
    if (promo.status === "ACTIVE") {
      const ask = nowS() < promo.depositDeadline ? await liveAsk(promo.geminiMarketId, base) : null;
      live = liveState(promo, ask);
    }
    return {
      id: promo.id,
      status: promo.status,
      promoPda: promo.status === "ACTIVE" ? promo.promoPda : null,
      shop: { merchant: promo.merchant, name: promo.shopName, location: promo.location },
      itemName: promo.itemName,
      offerAmount: promo.offerAmount,
      outcomeLabel: promo.outcomeLabel,
      geminiMarketId: promo.geminiMarketId,
      depositDeadline: promo.depositDeadline,
      maxYesPriceMicroUsd: promo.maxYesPriceMicroUsd,
      hedgeBudget: promo.hedgeBudget,
      onChainState:
        promo.resolvedOutcome === "YES"
          ? "ResolvedYes"
          : promo.resolvedOutcome === "NO"
            ? "ResolvedNo"
            : "Active",
      live,
    };
  }

  function stats(s: FxState, promo: FxPromo): PromoStatsDto {
    const ps = s.purchases.filter((p) => p.promotionId === promo.id);
    let hedged = 0,
      refunded = 0,
      hedgedSales = 0n,
      premium = 0n,
      contracts = 0;
    for (const p of ps) {
      if (p.markTx) {
        hedged++;
        hedgedSales += BigInt(p.amount);
        premium += BigInt(p.hedge?.premium ?? "0");
        contracts += Number(p.hedge?.contracts ?? 0);
      }
      if (p.hedge?.status === "FAILED") refunded++;
    }
    const payoutIfYes = BigInt(Math.round(contracts * 100)) * 10_000n;
    return {
      purchases: ps.length,
      hedged,
      refundedOrCancelled: refunded,
      hedgedSales: hedgedSales.toString(),
      contracts: contracts.toFixed(2),
      premium: premium.toString(),
      ifYes: (payoutIfYes - premium).toString(),
      ifNo: (hedgedSales - premium).toString(),
    };
  }

  function walletFor(s: FxState, init: RequestInit): FxWallet | null {
    const h = (init.headers ?? {}) as Record<string, string>;
    const id = s.tokens[h["x-user-token"] ?? ""];
    return id ? (s.wallets[id] ?? null) : null;
  }

  async function seed(s: FxState, base: string) {
    if (s.promos.some((p) => p.status === "ACTIVE" && p.depositDeadline > nowS() + 90)) return;
    try {
      const r = await real(`${base}/api/markets/windows?asset=SOL&windowMinutes=5&limit=12`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const { windows } = (await r.json()) as {
        windows: {
          marketId: string;
          bestAskMicroUsd: string | null;
          recommendedDepositDeadline: number;
        }[];
      };
      const w = windows.find(
        (x) => x.bestAskMicroUsd && x.recommendedDepositDeadline > nowS() + 240,
      );
      if (!w) return;
      const shop = ensureWallet(s, "shop@hillcountry.example");
      shop.initialized = true;
      const nonce = BigInt(`0x${hex(7)}`);
      s.promos.push({
        id: crypto.randomUUID(),
        status: "ACTIVE",
        promoPda: promoIdOf(shop.address as Address, nonce),
        promoNonce: nonce.toString(),
        merchant: shop.address,
        shopName: "Hill Country Coffee",
        location: "Guadalupe St, Austin",
        itemName: "Latte",
        offerAmount: "5000000",
        outcomeLabel: "SOL closes up",
        geminiMarketId: w.marketId,
        depositDeadline: w.recommendedDepositDeadline,
        maxYesPriceMicroUsd: "550000",
        hedgeBudget: "25000000",
        reservedPremium: "0",
        initialized: true,
        resolvedOutcome: null,
        resolvedAt: null,
      });
    } catch {
      // no seed without live windows
    }
  }

  function ensureWallet(s: FxState, email: string): FxWallet {
    const found = Object.values(s.wallets).find((w) => w.email === email.toLowerCase());
    if (found) return found;
    const w: FxWallet = {
      id: crypto.randomUUID(),
      email: email.toLowerCase(),
      address: `0x${hex(20)}`,
      balance: "0",
      allowance: "0",
      initialized: false,
      lastDrip: null,
    };
    s.wallets[w.id] = w;
    return w;
  }

  function challenge(s: FxState, kind: FxChallenge["kind"], walletId: string, ref: string[]) {
    const id = crypto.randomUUID();
    s.challenges[id] = { id, kind, walletId, ref };
    return id;
  }

  return async (url, init) => {
    const u = new URL(url);
    const base = u.origin;
    const path = u.pathname;
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const s = load();
    const done = (status: number, payload: unknown) => {
      save(s);
      return json(status, payload);
    };

    // --- wallet ---
    if (path === "/api/wallet/email-login" && method === "POST") {
      const email = String(body.email ?? "");
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(email)) {
        return json(400, { error: "invalid_email" });
      }
      const w = ensureWallet(s, email);
      return done(200, {
        appId: "fixture-app-id",
        deviceToken: "fixture-device-token",
        deviceEncryptionKey: "fixture-device-key",
        otpToken: w.id,
      });
    }
    if (
      path.startsWith("/api/wallet") ||
      path.startsWith("/api/checkout") ||
      /\/(claim-refund|claim-merchant|cancel-expired|initialize)$/.test(path)
    ) {
      const w = walletFor(s, init);
      if (!w) return json(401, { error: "login_required" });
      if (path === "/api/wallet/init") {
        if (w.initialized) return json(200, { alreadyInitialized: true });
        return done(200, { challengeId: challenge(s, "init", w.id, []) });
      }
      if (path === "/api/wallet" && method === "GET") {
        if (!w.initialized) return json(200, { wallets: [] });
        return json(200, {
          wallets: [
            { id: w.id, address: w.address, blockchain: "ARC-TESTNET", usdcBalance: w.balance },
          ],
        });
      }
      if (path === "/api/wallet/faucet") {
        if (body.walletId !== w.id) return json(404, { error: "wallet_not_found" });
        if (w.lastDrip && Date.now() - w.lastDrip < 86_400_000) {
          return json(502, {
            error: "faucet_unavailable",
            message: "Fixture: one drip per wallet per day",
            fallback: "https://faucet.circle.com (Arc Testnet)",
          });
        }
        w.balance = (BigInt(w.balance) + DRIP).toString();
        w.lastDrip = Date.now();
        return done(200, { ok: true, address: w.address, testnet: true });
      }
      const m = /^\/api\/checkout\/([^/]+)\/(status|approve|deposit|sign|submit)$/.exec(path);
      if (m) {
        const promo = s.promos.find((p) => p.id === decodeURIComponent(m[1]!));
        if (!promo || promo.status !== "ACTIVE") {
          // Promos from the API / sample server exist but are not fixture (wallet-payable) promos.
          const r = await real(`${base}/api/promotions/${m[1]}`, { cache: "no-store" }).catch(
            () => null,
          );
          return r && r.ok
            ? json(409, { error: "not_an_arc_promotion" })
            : json(404, { error: "promotion_not_found" });
        }
        const walletId = m[2] === "status" ? u.searchParams.get("walletId") : body.walletId;
        if (walletId !== w.id) return json(404, { error: "wallet_not_found" });
        const dto = await promoDto(promo, base);
        const price = BigInt(promo.offerAmount);
        const balance = BigInt(w.balance);
        const allowance = BigInt(w.allowance);
        const v1 = isV1();
        const refusal = !dto.live?.canBuy
          ? { error: "promo_not_buyable", pauseReason: dto.live?.pauseReason ?? null }
          : balance < price
            ? { error: "insufficient_usdc" }
            : null;
        if (m[2] === "status") {
          return json(200, {
            promoId: promo.id,
            price: promo.offerAmount,
            canBuy: dto.live?.canBuy ?? false,
            pauseReason: dto.live?.pauseReason ?? null,
            usdcBalance: w.balance,
            enoughBalance: balance >= price,
            checkout: v1 ? "approve-deposit" : "one-tap",
            needsApproval: v1 && allowance < price,
          });
        }
        if (m[2] === "sign") {
          if (v1) return json(409, { error: "one_tap_unavailable" });
          if (refusal) return json(409, refusal);
          const purchaseIdHex = hex(16);
          const key = purchaseKeyOf(
            promo.promoPda as Hex,
            w.address as Address,
            purchaseIdHex,
          ).toLowerCase();
          const validBefore = Math.min(nowS() + SIGNATURE_TTL_SECS, promo.depositDeadline);
          return done(200, {
            step: "sign",
            challengeId: challenge(s, "sign", w.id, [
              promo.id,
              key,
              dto.live?.liveAskMicroUsd ?? "",
              purchaseIdHex,
              String(validBefore),
            ]),
            purchaseIdHex,
            purchaseKey: key,
            validBefore,
            submit: `/api/checkout/${promo.id}/submit`,
          });
        }
        if (m[2] === "submit") {
          if (v1) return json(409, { error: "one_tap_unavailable" });
          const sig = typeof body.signature === "string" ? s.signatures[body.signature] : undefined;
          if (typeof body.purchaseIdHex !== "string" || !/^[0-9a-f]{32}$/.test(body.purchaseIdHex))
            return json(400, { error: "invalid_purchase_id" });
          if (typeof body.validBefore !== "number")
            return json(400, { error: "invalid_valid_before" });
          if (!sig) return json(400, { error: "invalid_signature" });
          if (body.validBefore <= nowS()) return json(409, { error: "signature_expired" });
          if (
            sig.walletId !== w.id ||
            sig.promotionId !== promo.id ||
            sig.purchaseIdHex !== body.purchaseIdHex ||
            sig.validBefore !== body.validBefore
          ) {
            return json(409, { error: "deposit_rejected", message: "Fixture: signature mismatch" });
          }
          const receiptPath = `/api/purchases/${sig.key}`;
          if (sig.used) {
            const prior = s.purchases.find((x) => x.key === sig.key);
            return json(200, {
              step: "submitted",
              purchaseKey: sig.key,
              receipt: receiptPath,
              txHash: prior?.depositTx ?? null,
              alreadyApplied: true,
            });
          }
          if (refusal) return json(409, refusal);
          sig.used = true;
          const txHash = recordDeposit(s, w, promo, sig.key, sig.ask);
          return done(200, {
            step: "submitted",
            purchaseKey: sig.key,
            receipt: receiptPath,
            txHash,
            alreadyApplied: false,
          });
        }
        if (m[2] === "approve") {
          if (allowance >= price) return json(409, { error: "already_approved" });
          return done(200, {
            step: "approve",
            challengeId: challenge(s, "approve", w.id, []),
            allowance: ALLOWANCE_CAP.toString(),
          });
        }
        if (refusal) return json(409, refusal);
        if (allowance < price) return json(409, { error: "approval_needed" });
        const purchaseIdHex = hex(16);
        const key = purchaseKeyOf(
          promo.promoPda as Hex,
          w.address as Address,
          purchaseIdHex,
        ).toLowerCase();
        return done(200, {
          step: "deposit",
          challengeId: challenge(s, "deposit", w.id, [
            promo.id,
            key,
            dto.live?.liveAskMicroUsd ?? "",
          ]),
          purchaseIdHex,
          purchaseKey: key,
          receipt: `/api/purchases/${key}`,
        });
      }
      const init2 = /^\/api\/promotions\/([^/]+)\/initialize$/.exec(path);
      if (init2) {
        const promo = s.promos.find((p) => p.id === decodeURIComponent(init2[1]!));
        if (!promo) return json(404, { error: "promotion_not_found" });
        if (promo.status !== "DRAFT") return json(409, { error: "already_published" });
        if (promo.depositDeadline <= nowS()) return json(409, { error: "deadline_passed" });
        if (body.walletId !== w.id) return json(404, { error: "wallet_not_found" });
        if (promo.merchant !== w.address) return json(403, { error: "not_this_shops_wallet" });
        return done(200, {
          challengeId: challenge(s, "initialize", w.id, [promo.id]),
          promoPda: promo.promoPda,
          confirm: `/api/promotions/${promo.id}/confirm`,
        });
      }
      if (path === "/api/purchases/claim-merchant") {
        if (body.walletId !== w.id) return json(404, { error: "wallet_not_found" });
        const raw = body.purchaseKeys;
        if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) {
          return json(400, { error: "invalid_purchase_keys" });
        }
        const keys = [...new Set(raw.map((k) => String(k).toLowerCase()))];
        for (const key of keys) {
          const p = s.purchases.find((x) => x.key === key);
          const promo = p && s.promos.find((x) => x.id === p.promotionId);
          if (!p || !promo) return json(404, { error: "purchase_not_found", purchaseKey: key });
          if (promo.merchant !== w.address) {
            return json(403, { error: "not_this_shops_purchase", purchaseKey: key });
          }
          if (chainState(p, promo) !== "Hedged" || promo.resolvedOutcome !== "NO") {
            return json(409, { error: "nothing_to_collect", purchaseKey: key });
          }
        }
        return done(200, {
          challenges: keys.map((k) => ({
            purchaseKey: k,
            challengeId: challenge(s, "claim-merchant", w.id, [k]),
          })),
        });
      }
      const pc = /^\/api\/purchases\/([^/]+)\/(claim-refund|cancel-expired)$/.exec(path);
      if (pc) {
        const key = decodeURIComponent(pc[1]!).toLowerCase();
        const p = s.purchases.find((x) => x.key === key);
        const promo = p && s.promos.find((x) => x.id === p.promotionId);
        if (!p || !promo) return json(404, { error: "purchase_not_found" });
        if (body.walletId !== w.id) return json(404, { error: "wallet_not_found" });
        if (p.customer !== w.address) return json(403, { error: "not_your_purchase" });
        const state = chainState(p, promo);
        if (pc[2] === "cancel-expired") {
          if (state !== "Deposited") {
            return json(409, { error: "not_cancellable", onChainState: state });
          }
          if (nowS() < p.depositedAt + CANCEL_TIMEOUT_SECS) {
            // The contract would revert (TimeoutNotElapsed); the API leaves that to the chain.
            return json(409, { error: "not_cancellable", onChainState: state });
          }
          return done(200, {
            challengeId: challenge(s, "cancel-expired", w.id, [key]),
            purchaseKey: key,
          });
        }
        const ok = state === "Cancelled" || (state === "Hedged" && promo.resolvedOutcome === "YES");
        if (!ok) return json(409, { error: "nothing_to_claim", onChainState: state });
        return done(200, {
          challengeId: challenge(s, "claim-refund", w.id, [key]),
          purchaseKey: key,
        });
      }
    }

    // --- promotions created in the fixture ---
    if (path === "/api/promotions" && method === "POST") {
      const input = body as unknown as CreatePromotionInput;
      const nonce = BigInt(`0x${hex(7)}`);
      const promo: FxPromo = {
        id: crypto.randomUUID(),
        status: "DRAFT",
        promoPda: promoIdOf(input.merchant as Address, nonce),
        promoNonce: nonce.toString(),
        merchant: input.merchant.toLowerCase(),
        shopName: input.shopName,
        location: input.location ?? "",
        itemName: input.itemName,
        offerAmount: input.offerAmount,
        outcomeLabel: input.outcomeLabel ?? "it happens",
        geminiMarketId: input.geminiMarketId,
        depositDeadline: input.depositDeadline,
        maxYesPriceMicroUsd: input.maxYesPriceMicroUsd,
        hedgeBudget: input.hedgeBudget,
        reservedPremium: "0",
        initialized: false,
        resolvedOutcome: null,
        resolvedAt: null,
      };
      s.promos.push(promo);
      return done(201, {
        promotion: await promoDto(promo, base),
        initializePromo: {
          promoNonce: promo.promoNonce,
          offerAmount: promo.offerAmount,
          depositDeadline: promo.depositDeadline,
          marketId: promo.geminiMarketId,
        },
      });
    }
    const conf = /^\/api\/promotions\/([^/]+)\/confirm$/.exec(path);
    if (conf) {
      const promo = s.promos.find((p) => p.id === decodeURIComponent(conf[1]!));
      if (!promo) return json(404, { error: "promotion_not_found" });
      if (!promo.initialized) return json(409, { error: "promo_not_found_on_chain_yet" });
      promo.status = "ACTIVE";
      return done(200, { promotion: await promoDto(promo, base) });
    }

    await settle(s, base);

    if (path === "/api/promotions" && method === "GET") {
      await seed(s, base);
      const mine = await Promise.all(
        s.promos.filter((p) => p.status === "ACTIVE").map((p) => promoDto(p, base)),
      );
      save(s);
      let realList: PromotionDto[] = [];
      try {
        const r = await real(url, init);
        if (r.ok) realList = ((await r.json()) as { promotions: PromotionDto[] }).promotions;
      } catch {
        // real API down: fixture promos only
      }
      const order = { LIVE: 0, PAUSED: 1, WAITING_FOR_RESULT: 2, RESULT_YES: 3, RESULT_NO: 4 };
      mine.sort((a, b) => order[a.live!.phase] - order[b.live!.phase]);
      return json(200, { promotions: [...mine, ...realList] });
    }
    const one = /^\/api\/promotions\/([^/]+)$/.exec(path);
    if (one) {
      const promo = s.promos.find((p) => p.id === decodeURIComponent(one[1]!));
      if (promo) return done(200, { promotion: await promoDto(promo, base) });
    }
    const list = /^\/api\/promotions\/([^/]+)\/purchases$/.exec(path);
    if (list) {
      const promo = s.promos.find((p) => p.id === decodeURIComponent(list[1]!));
      if (promo) {
        return done(200, {
          promotionId: promo.id,
          purchases: s.purchases
            .filter((p) => p.promotionId === promo.id)
            .sort((a, b) => b.depositedAt - a.depositedAt)
            .slice(0, 50)
            .map((p) => summary(p, promo)),
        });
      }
    }
    if (path === "/api/purchases" && method === "GET") {
      const customer = (u.searchParams.get("customer") ?? "").toLowerCase();
      const mine: CustomerPurchaseDto[] = [];
      for (const p of s.purchases.filter((x) => x.customer === customer)) {
        const promo = s.promos.find((x) => x.id === p.promotionId);
        if (!promo) continue;
        mine.push({
          ...summary(p, promo),
          promotion: {
            id: promo.id,
            shopName: promo.shopName,
            itemName: promo.itemName,
            outcomeLabel: promo.outcomeLabel,
            resolvedOutcome: promo.resolvedOutcome,
          },
        });
      }
      let theirs: CustomerPurchaseDto[] = [];
      try {
        const r = await real(url, init);
        if (r.ok) theirs = ((await r.json()) as { purchases: CustomerPurchaseDto[] }).purchases;
      } catch {
        // API down: fixture purchases only
      }
      const all = [...mine, ...theirs].sort((a, b) => b.depositedAt - a.depositedAt).slice(0, 50);
      return done(200, { customer, purchases: all });
    }
    const dash = /^\/api\/merchants\/([^/]+)\/dashboard$/.exec(path);
    if (dash) {
      const addr = decodeURIComponent(dash[1]!).toLowerCase();
      const owner = Object.values(s.wallets).find((w) => w.address === addr);
      if (owner) {
        await seed(s, base);
        const promos = s.promos.filter((p) => p.merchant === addr);
        if (promos.length === 0) return done(404, { error: "merchant_not_found" });
        return done(200, {
          merchant: {
            pubkey: addr,
            shopName: promos[0]!.shopName,
            location: promos[0]!.location,
            createdAt: "",
          },
          simulatedHedges: true,
          promotions: await Promise.all(
            promos.map(async (p) => ({ ...(await promoDto(p, base)), stats: stats(s, p) })),
          ),
        });
      }
    }
    const pur = /^\/api\/purchases\/(0x[0-9a-fA-F]{64})$/.exec(path);
    if (pur) {
      const p = s.purchases.find((x) => x.key === pur[1]!.toLowerCase());
      const promo = p && s.promos.find((x) => x.id === p.promotionId);
      if (p && promo) return done(200, receipt(p, promo));
    }

    save(s);
    return real(url, init);
  };
}

/* ---------- ports of the backend's pure rules (apps/api), for fixture promos only ---------- */

function liveState(promo: FxPromo, ask: string | null): LiveStateDto {
  const cap = BigInt(promo.maxYesPriceMicroUsd);
  const thresholdBps = Number((cap * 10_000n) / 1_000_000n);
  const budgetRemaining = BigInt(promo.hedgeBudget) - BigInt(promo.reservedPremium);
  const costPerSale =
    ask === null ? null : (BigInt(promo.offerAmount) * BigInt(ask) + 999_999n) / 1_000_000n;
  const base = {
    liveAskMicroUsd: ask,
    costPerSale: costPerSale?.toString() ?? null,
    thresholdBps,
    budgetRemaining: budgetRemaining.toString(),
  };
  if (promo.resolvedOutcome === "YES")
    return { ...base, phase: "RESULT_YES", pauseReason: null, canBuy: false };
  if (promo.resolvedOutcome === "NO")
    return { ...base, phase: "RESULT_NO", pauseReason: null, canBuy: false };
  if (nowS() >= promo.depositDeadline) {
    return { ...base, phase: "WAITING_FOR_RESULT", pauseReason: null, canBuy: false };
  }
  const pause = (pauseReason: PauseReason): LiveStateDto => ({
    ...base,
    phase: "PAUSED",
    pauseReason,
    canBuy: false,
  });
  if (ask === null || costPerSale === null) return pause("NO_LIVE_PRICE");
  if (BigInt(ask) > cap) return pause("PRICE_ABOVE_THRESHOLD");
  // Same 2-cent buy buffer as apps/api (a fifth of the cap when that is smaller).
  const buffer = cap / 5n < 20_000n ? cap / 5n : 20_000n;
  if (BigInt(ask) > cap - buffer) return pause("PRICE_NEAR_THRESHOLD");
  if (costPerSale > budgetRemaining) return pause("BUDGET_USED");
  return { ...base, phase: "LIVE", pauseReason: null, canBuy: true };
}

function receiptStep(
  status: PurchaseReceiptDto["status"],
  outcome: "YES" | "NO" | null,
  autoPayout: boolean,
): { step: ReceiptStep; canServe: boolean; message: string } {
  const resolved = (
    o: "YES" | "NO" | null,
  ): { step: ReceiptStep; canServe: boolean; message: string } =>
    o === "YES"
      ? {
          step: "YOU_WON",
          canServe: true,
          message: autoPayout
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
        message: autoPayout ? "Your refund is on its way." : "Your refund is ready to claim.",
      };
    case "REFUNDED":
      return { step: "REFUNDED", canServe: false, message: "Refunded." };
    case "RESOLVED":
      return resolved(outcome);
    case "CLAIMED":
      return { step: "DONE", canServe: true, message: "All settled." };
  }
}
