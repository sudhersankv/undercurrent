"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useRun } from "@/components/mission/run-context";
import { Eyebrow } from "@/components/ui";
import { accountRows, people, PIPELINE, pipelineCounts, roleLine, SIZE_LABEL } from "@/lib/client/gtm";
import { cn } from "@/lib/utils";

/** GTM workspace (default run page): pipeline, top accounts and people, drafts waiting, replies, discovery. */
export function Workspace() {
  const { runId, store } = useRun();
  const base = `/runs/${runId}`;
  const counts = pipelineCounts(store);
  const accounts = accountRows(store).slice(0, 6);
  const top = people(store)
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 8);
  const drafts = Object.values(store.drafts);
  const waiting = drafts.filter((d) => d.status === "pending_review" || d.status === "approved");
  const segs = Object.values(store.segments).filter((s) => s.origin !== "control_negative");
  const verified = segs.filter((s) => s.verdict === "VERIFIED" || s.verdict === "PROMISING");
  // "Selling to" = some lead in that segment is approved or further along.
  const pursued = new Set(Object.values(store.leads).filter((l) => l.stage !== "discovered").map((l) => l.segmentId));
  const untapped = verified.filter((s) => !pursued.has(s.id));

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-4 md:p-6">
      <header>
        <Eyebrow>Workspace</Eyebrow>
        <h1 className="mt-1 text-[22px]">{store.profile?.name ?? "Your"} go-to-market</h1>
      </header>

      {/* Pipeline */}
      <Card title="Pipeline" href={`${base}/pipeline`} link="Open pipeline">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {PIPELINE.map((p) => (
            <div key={p.stage} className="rounded-control border border-hairline bg-recessed px-2.5 py-2">
              <p className="eyebrow text-[10px]">{p.label}</p>
              <p className={cn("mt-0.5 font-mono text-[20px] tabular", counts[p.stage] ? "text-strong" : "text-muted")}>{counts[p.stage]}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top accounts" href={`${base}/leads?view=accounts`} link="All accounts">
          {accounts.length ? (
            <ul className="divide-y divide-hairline">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-strong">{a.name}</span>
                    <span className="block truncate text-[11.5px] text-muted">
                      {[a.sizeBand ? SIZE_LABEL[a.sizeBand] : null, a.industry, a.segmentName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="font-mono text-[11px] text-muted">{a.contacts.length} contacts</span>
                  <span className="font-mono text-[12px] text-lichen">{a.fitScore}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No accounts yet.</Empty>
          )}
        </Card>

        <Card title="Top people" href={`${base}/leads`} link="All people">
          {top.length ? (
            <ul className="divide-y divide-hairline">
              {top.map((l) => (
                <li key={l.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-strong">{l.displayName}</span>
                    <span className="block truncate text-[11.5px] text-muted">{roleLine(l) ?? l.primaryRepo ?? store.segments[l.segmentId]?.name}</span>
                  </span>
                  <span className="font-mono text-[11px] text-muted">{l.stage}</span>
                  <span className="font-mono text-[12px] text-lichen">{l.fitScore}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No people yet. Pilot fills this after Sounding.</Empty>
          )}
        </Card>

        <Card title="Drafts waiting" href={`${base}/review`} link="Review drafts">
          {waiting.length ? (
            <ul className="divide-y divide-hairline">
              {waiting.slice(0, 6).map((d) => (
                <li key={d.id} className="flex items-center gap-3 py-2 text-[13px]">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted">{d.channel.replace("_", " ")}</span>
                  <span className="min-w-0 flex-1 truncate text-strong">{store.leads[d.leadId]?.displayName ?? "Lead"}</span>
                  <span className="truncate text-[11.5px] text-muted">{d.subject ?? d.body.split("\n")[0]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing waiting. Approve a person to get drafts.</Empty>
          )}
        </Card>

        <Card title="Replies" href={`${base}/inbox`} link="Open inbox">
          {store.replies.length ? (
            <ul className="divide-y divide-hairline">
              {store.replies
                .slice(-6)
                .reverse()
                .map((r, i) => (
                  <li key={i} className="flex items-center gap-3 py-2 text-[13px]">
                    <span className="w-20 shrink-0 font-mono text-[11px] text-lichen">{r.intent}</span>
                    <span className="min-w-0 flex-1 truncate text-strong">{store.leads[r.leadId]?.displayName ?? "Lead"}</span>
                    <span className="truncate text-[11.5px] text-muted">{r.summary}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty>No replies yet.</Empty>
          )}
        </Card>
      </div>

      <Link href={`${base}/market`} className="group flex items-center gap-4 rounded-card border border-hairline bg-raised p-4 hover:bg-raised-hover">
        <span className="flex-1">
          <Eyebrow>Discovery</Eyebrow>
          <span className="mt-1 block text-[15px] text-strong">
            {untapped.length} market{untapped.length === 1 ? "" : "s"} you&apos;re not selling to
          </span>
          <span className="block text-[12px] text-muted">
            {segs.length} segments tested · {verified.length} verified or promising
            {untapped.length ? ` · ${untapped.slice(0, 3).map((s) => s.name).join(", ")}` : ""}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-[13px] text-body group-hover:text-strong">
          Market map <ArrowRight className="size-3.5" />
        </span>
      </Link>
    </div>
  );
}

function Card({ title, href, link, children }: { title: string; href: string; link: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-hairline bg-raised p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="eyebrow">{title}</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-[12px] text-body hover:text-strong">
          {link} <ArrowRight className="size-3" />
        </Link>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-[13px] text-muted">{children}</p>;
}
