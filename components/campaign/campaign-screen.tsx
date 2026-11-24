"use client";

import { useRun } from "@/components/mission/run-context";
import { Eyebrow } from "@/components/ui";
import { CampaignTab } from "./index";

/** /runs/[runId]/campaign: the X campaign, driven by the shared run stream. */
export function CampaignScreen() {
  const { store } = useRun();
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-5 p-6">
      <header>
        <Eyebrow>Campaign</Eyebrow>
        <h1 className="mt-1 text-2xl">Where they talk on X</h1>
      </header>
      <CampaignTab store={store} />
    </main>
  );
}
