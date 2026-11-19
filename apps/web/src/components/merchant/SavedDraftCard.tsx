"use client";

import { useState } from "react";
import { ApiError, type PromotionDto } from "@/lib/api";
import { api } from "@/lib/client";
import { describe, type Problem } from "@/lib/errors";
import { conditionText, dateTime, usdExact } from "@/lib/format";
import { useNowSeconds } from "@/lib/hooks";
import { confirmWithRetry, removeDraft, saveDraft, type LocalDraft } from "@/lib/merchant";
import { useWallet } from "@/lib/wallet/session";
import { DISPLAY, PILL_PURPLE } from "../layout/styles";
import { Button, Notice } from "../ui";

// A promotion saved as a DRAFT on the promo server but not created on Arc yet, in Zahin's
// saved-draft card. The shop's wallet can finish it from any browser: approve creating it in
// Circle's window (POST /api/promotions/:id/initialize), then the server confirms it on Arc and
// turns it on. LocalDraft only remembers that this browser already approved it.

export function SavedDraftCard({
  merchant,
  draft,
  local,
  canAct,
  onChange,
}: {
  merchant: string;
  draft: PromotionDto;
  local: LocalDraft | null;
  canAct: boolean;
  onChange: () => void;
}) {
  const w = useWallet();
  const now = useNowSeconds();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const expired = now !== null && draft.depositDeadline <= now + 90;

  async function finish() {
    if (!w.wallet) return;
    setBusy(true);
    setProblem(null);
    try {
      let promoId = local?.promoId;
      if (!promoId) {
        const ch = await api.initializePromo(draft.id, w.wallet.id);
        promoId = ch.promoPda;
        // Approved in another browser already? Then it is on Arc and only needs confirming.
        const onChain = await api.confirmPromotion(draft.id, promoId).then(
          () => true,
          (err) => {
            if (err instanceof ApiError && err.code === "promo_not_found_on_chain_yet")
              return false;
            throw err;
          },
        );
        if (onChain) {
          removeDraft(merchant, draft.id);
          onChange();
          return;
        }
        await w.execute(
          ch.challengeId,
          `Create the promo: ${draft.itemName}, ${usdExact(draft.offerAmount)} with money back`,
        );
        saveDraft(merchant, {
          promotionId: draft.id,
          init: local?.init ?? {
            promoNonce: "",
            offerAmount: draft.offerAmount,
            depositDeadline: draft.depositDeadline,
            marketId: draft.geminiMarketId,
          },
          promoId,
        });
      }
      await confirmWithRetry(draft.id, promoId);
      removeDraft(merchant, draft.id);
      onChange();
    } catch (err) {
      setProblem(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      aria-label="Draft promotion"
      className="border-b border-l-[3px] border-b-[#E6E1D8] border-l-[#6133A7] py-8 pl-5 sm:pl-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 max-w-xl">
          <span className={`inline-block ${PILL_PURPLE}`}>Draft</span>
          <h3
            className={`${DISPLAY} mt-3 break-words text-[1.7rem] font-semibold leading-tight tracking-[-0.025em] text-[#211D28]`}
          >
            {draft.itemName}
          </h3>
          <p className="mt-1 text-sm text-[#5A5463]">{draft.shop.name}</p>
        </div>
        <div className="shrink-0 sm:text-right">
          <p
            className={`${DISPLAY} text-4xl font-semibold leading-none tracking-[-0.04em] tabular-nums text-[#211D28]`}
          >
            {usdExact(draft.offerAmount)}
          </p>
          <p className="mt-1.5 text-xs text-[#5A5463]">test USDC</p>
        </div>
      </div>

      <dl className="mt-6 grid gap-x-8 gap-y-5 border-t border-[#E6E1D8] pt-5 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-[#5A5463]">Refund trigger</dt>
          <dd className="mt-1 break-words font-medium text-[#211D28]">
            {conditionText(draft.outcomeLabel, draft.geminiMarketId)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-[#5A5463]">Sales close</dt>
          <dd className="mt-1 font-medium text-[#211D28]">{dateTime(draft.depositDeadline)}</dd>
          {expired ? (
            <dd className="mt-0.5 text-xs font-semibold text-[#7A4208]">Deadline passed</dd>
          ) : null}
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-[#5A5463]">Gemini market ID</dt>
          <dd className="mt-1 break-all font-mono text-[13px] text-[#211D28]">
            {draft.geminiMarketId}
          </dd>
          <dd className="mt-0.5 text-xs font-semibold text-[#3F2A66]">
            Checked by the promo server
          </dd>
        </div>
      </dl>

      <div className="mt-6 border-l-[3px] border-[#F58C38] pl-4 text-sm leading-relaxed text-[#4E4858]">
        <p className="font-semibold text-[#211D28]">Saved as a draft, not live yet.</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>It is saved on the promo server but not created on Arc.</li>
          <li>It cannot take payments until you approve it and the server confirms it on Arc.</li>
          {canAct ? null : <li>Log in as this shop to publish it.</li>}
        </ul>
      </div>

      {canAct && !expired ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button size="md" busy={busy} onClick={finish}>
            {local?.promoId ? "Finish publishing" : "Approve and publish"}
          </Button>
        </div>
      ) : null}
      {problem ? (
        <div className="mt-4 max-w-xl">
          <Notice tone="error" title={problem.title}>
            {problem.detail}
          </Notice>
        </div>
      ) : null}
    </article>
  );
}
