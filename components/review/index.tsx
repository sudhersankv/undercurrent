"use client";

import * as React from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useRun } from "@/components/mission/run-context";
import { CampaignTab } from "@/components/campaign";
import { Eyebrow } from "@/components/ui";
import { ReviewQueue } from "./review-queue";

export { ReviewQueue } from "./review-queue";
export { DraftCard } from "./draft-card";

const tab =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-pill px-3.5 text-sm font-semibold text-charcoal transition-colors hover:bg-paper data-[state=active]:bg-lime data-[state=active]:text-forest";

/** Review page body: header, HITL queue + campaign tab, driven by the run stream. */
export function ReviewScreen({ runId, title = "Nothing sends without you" }: { runId: string; title?: string }) {
  const { store } = useRun();
  const pending = Object.values(store.drafts).filter((d) => d.status === "pending_review").length;
  const campaigns = Object.keys(store.campaigns).length;
  return (
    <Tabs.Root defaultValue="queue" className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Outreach</Eyebrow>
          <h1 className="mt-1.5 text-[28px] font-bold tracking-[-0.02em] text-strong md:text-[32px]">{title}</h1>
        </div>
        <Tabs.List aria-label="Review" className="inline-flex items-center gap-1 rounded-pill bg-raised p-1">
          <Tabs.Trigger value="queue" className={tab}>
            Queue {pending ? <span className="tabular opacity-70">{pending}</span> : null}
          </Tabs.Trigger>
          <Tabs.Trigger value="campaign" className={tab}>
            Campaign {campaigns ? <span className="tabular opacity-70">{campaigns}</span> : null}
          </Tabs.Trigger>
        </Tabs.List>
      </header>
      <Tabs.Content value="queue" forceMount className="outline-none data-[state=inactive]:hidden">
        <ReviewQueue runId={runId} store={store} />
      </Tabs.Content>
      <Tabs.Content value="campaign" className="outline-none">
        <CampaignTab store={store} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
