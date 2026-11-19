"use client";

import type { Role } from "@/lib/role";
import { IconChevron, IconStore, IconTicket } from "./icons";
import { Wordmark } from "./kit";

/** First open: which side of the app is this? (Changeable later from the profile.) */
export function RolePick({ onPick }: { onPick: (r: Role) => void }) {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[480px] flex-col px-6 pb-10 pt-[16dvh]">
        <Wordmark size={30} className="self-start" />
        <h1 className="font-display mt-8 text-[50px] leading-[0.92]">
          Win and
          <br />
          it&apos;s free.
        </h1>
        <p className="mt-4 max-w-[19rem] text-[15px] leading-snug text-ink-soft">
          Buy your coffee now. If your team wins, the money comes back.
        </p>

        <div className="mt-auto space-y-3 pt-12">
          <ChoiceButton
            onClick={() => onPick("customer")}
            icon={<IconTicket size={24} />}
            title="I'm here to buy"
            sub="Find promos near you"
            primary
          />
          <ChoiceButton
            onClick={() => onPick("merchant")}
            icon={<IconStore size={24} />}
            title="I run a shop"
            sub="Start a promo for your customers"
          />
        </div>
      </div>
    </main>
  );
}

function ChoiceButton({
  onClick,
  icon,
  title,
  sub,
  primary,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-[22px] px-5 py-4 text-left transition-transform active:scale-[0.99] ${primary ? "bg-ink text-black" : "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-2"}`}
    >
      <span
        className={`grid h-12 w-12 place-items-center rounded-2xl ${primary ? "bg-black/10" : "bg-surface-3"}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-title block text-[17px]">{title}</span>
        <span className={`block text-[12.5px] ${primary ? "text-black/60" : "text-ink-3"}`}>
          {sub}
        </span>
      </span>
      <IconChevron size={20} className={primary ? "text-black/50" : "text-ink-3"} />
    </button>
  );
}
