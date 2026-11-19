"use client";

import { useState } from "react";
import { ApiError, type PromotionDto } from "@/lib/api";
import { api } from "@/lib/client";
import { describe, type Problem } from "@/lib/errors";
import { conditionText, dateTime, usdExact } from "@/lib/format";
import { useNowSeconds } from "@/lib/hooks";
import { confirmWithRetry, removeDraft, saveDraft, type LocalDraft } from "@/lib/merchant";
import { price } from "@/lib/promo-view";
import { useWallet } from "@/lib/wallet/session";
import { Button, Note } from "../kit";
import { Seal } from "../voucher";

// A promo saved as a DRAFT on the promo server but not created on Arc yet. The shop's wallet can
// finish it from any browser: approve creating it in Circle's window (POST
// /api/promotions/:id/initialize), then the server confirms it on Arc and turns it on.
// LocalDraft only remembers that this browser already approved it.

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
          `Start the promo: ${draft.itemName}, ${usdExact(draft.offerAmount)}`,
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
    <article className="rounded-[24px] bg-paper-raised p-4 border border-dashed border-line-strong">
      <div className="flex items-center gap-3.5">
        <Seal seed={draft.id} size={48} label={price(draft.offerAmount)} />
        <div className="min-w-0 flex-1">
          <p className="font-title truncate text-[16px]">{draft.itemName}</p>
          <p className="truncate text-[12.5px] text-ink-soft">
            Free if {conditionText(draft.outcomeLabel, draft.geminiMarketId)}
          </p>
        </div>
        <span className="rounded-full bg-surface-3 px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
          Draft
        </span>
      </div>
      <p className="mt-3 text-[12px] text-ink-soft">
        {expired
          ? "Sales would already be closed, so this draft can't go live."
          : `Not live yet. Sales would close ${dateTime(draft.depositDeadline)}.`}
      </p>
      {canAct && !expired ? (
        <Button size="md" className="mt-3 w-full" busy={busy} onClick={finish}>
          Finish publishing
        </Button>
      ) : null}
      {problem ? (
        <div className="mt-3">
          <Note tone="error" title={problem.title}>
            {problem.detail}
          </Note>
        </div>
      ) : null}
    </article>
  );
}
