"use client";

import { useRun } from "@/components/mission/run-context";
import { Eyebrow } from "@/components/ui";
import { CampaignTab } from "./index";

/** /runs/[runId]/campaign: the X campaign, driven by the shared run stream. */
export function CampaignScreen() {
  const { store } = useRun();
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-6 p-4 md:p-6">
      <header>
        <Eyebrow>Campaign</Eyebrow>
        <h1 className="mt-1.5 text-[28px] font-bold tracking-[-0.02em] text-strong md:text-[32px]">Where they talk on X</h1>
      </header>
      <CampaignTab store={store} />
    </main>
  );
}
