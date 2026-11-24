"use client";

import * as React from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { useRunStream } from "@/lib/client/run-store";
import { CampaignTab } from "@/components/campaign";
import { ReviewQueue } from "./review-queue";

export { ReviewQueue } from "./review-queue";
export { DraftCard } from "./draft-card";

const tab =
  "h-8 rounded-control px-3 text-[13px] text-body transition-colors hover:text-strong data-[state=active]:bg-raised data-[state=active]:text-strong";

/** Review page body: HITL queue + campaign tab, driven by the run stream. */
export function ReviewScreen({ runId }: { runId: string }) {
  const { store } = useRunStream(runId);
  const pending = Object.values(store.drafts).filter((d) => d.status === "pending_review").length;
  const campaigns = Object.keys(store.campaigns).length;
  return (
    <Tabs.Root defaultValue="queue" className="flex flex-col gap-4">
      <Tabs.List aria-label="Review" className="flex items-center gap-1">
        <Tabs.Trigger value="queue" className={tab}>
          Queue {pending ? <span className="ml-1 font-mono text-lichen">{pending}</span> : null}
        </Tabs.Trigger>
        <Tabs.Trigger value="campaign" className={tab}>
          Campaign {campaigns ? <span className="ml-1 font-mono text-muted">{campaigns}</span> : null}
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="queue" forceMount className="outline-none data-[state=inactive]:hidden">
        <ReviewQueue runId={runId} store={store} />
      </Tabs.Content>
      <Tabs.Content value="campaign" className="outline-none">
        <CampaignTab store={store} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
