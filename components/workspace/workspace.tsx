"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useRun } from "@/components/mission/run-context";
import { buttonVariants, Eyebrow } from "@/components/ui";
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
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 p-4 md:p-6">
      <header>
        <Eyebrow>Workspace</Eyebrow>
        <h1 className="mt-1 text-[28px] font-bold tracking-[-0.02em] text-strong">{store.profile?.name ?? "Your"} go-to-market</h1>
      </header>

      {/* Pipeline */}
      <Card title="Pipeline" href={`${base}/pipeline`} link="Open pipeline">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {PIPELINE.map((p) => (
            <div key={p.stage} className="rounded-card bg-recessed px-3 py-2.5">
              <p className="truncate text-[12px] font-semibold text-muted">{p.label}</p>
              <p className={cn("mt-0.5 text-[24px] font-bold leading-tight tracking-[-0.02em] tabular", counts[p.stage] ? "text-strong" : "text-pebble")}>
                {counts[p.stage]}
              </p>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Top accounts" href={`${base}/leads?view=accounts`} link="All accounts">
          {accounts.length ? (
            <ul className="-mx-2 divide-y divide-hairline">
              {accounts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-2 py-2.5 text-[14px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-strong">{a.name}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {[a.sizeBand ? SIZE_LABEL[a.sizeBand] : null, a.industry, a.segmentName].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="text-[12px] text-muted tabular">{a.contacts.length} contacts</span>
                  <Score value={a.fitScore} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No accounts yet.</Empty>
          )}
        </Card>

        <Card title="Top people" href={`${base}/leads`} link="All people">
          {top.length ? (
            <ul className="-mx-2 divide-y divide-hairline">
              {top.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-2 py-2.5 text-[14px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-strong">{l.displayName}</span>
                    <span className="block truncate text-[12px] text-muted">{roleLine(l) ?? l.primaryRepo ?? store.segments[l.segmentId]?.name}</span>
                  </span>
                  <span className="inline-flex h-6 items-center rounded-pill bg-raised px-2.5 text-[12px] font-medium text-charcoal">{l.stage}</span>
                  <Score value={l.fitScore} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No people yet. Pilot fills this after Sounding.</Empty>
          )}
        </Card>

        <Card title="Drafts waiting" href={`${base}/review`} link="Review drafts">
          {waiting.length ? (
            <ul className="-mx-2 divide-y divide-hairline">
              {waiting.slice(0, 6).map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-2 py-2.5 text-[14px]">
                  <span className="w-20 shrink-0 truncate text-[12px] font-semibold capitalize text-muted">{d.channel.replace("_", " ")}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-strong">{store.leads[d.leadId]?.displayName ?? "Lead"}</span>
                  <span className="truncate text-[12px] text-muted">{d.subject ?? d.body.split("\n")[0]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing waiting. Approve a person to get drafts.</Empty>
          )}
        </Card>

        <Card title="Replies" href={`${base}/inbox`} link="Open inbox">
          {store.replies.length ? (
            <ul className="-mx-2 divide-y divide-hairline">
              {store.replies
                .slice(-6)
                .reverse()
                .map((r, i) => (
                  <li key={i} className="flex items-center gap-3 px-2 py-2.5 text-[14px]">
                    <span className="inline-flex h-6 w-24 shrink-0 items-center justify-center truncate rounded-pill bg-linen px-2 text-[12px] font-semibold text-forest">{r.intent}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-strong">{store.leads[r.leadId]?.displayName ?? "Lead"}</span>
                    <span className="truncate text-[12px] text-muted">{r.summary}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty>No replies yet.</Empty>
          )}
        </Card>
      </div>

      <Link href={`${base}/market`} className="group flex flex-col gap-4 rounded-large bg-forest p-6 sm:flex-row sm:items-center md:p-8">
        <span className="flex-1">
          <span className="text-[12px] font-semibold uppercase tracking-eyebrow text-paper/70">Discovery</span>
          <span className="mt-1 block text-[24px] font-bold tracking-[-0.02em] text-lime">
            {untapped.length} market{untapped.length === 1 ? "" : "s"} you&apos;re not selling to
          </span>
          <span className="mt-1 block text-[14px] text-paper/80">
            {segs.length} segments tested · {verified.length} verified or promising
            {untapped.length ? ` · ${untapped.slice(0, 3).map((s) => s.name).join(", ")}` : ""}
          </span>
        </span>
        <span className={cn(buttonVariants({ variant: "cta", size: "lg" }), "self-start sm:self-center")}>
          Market map <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </div>
  );
}

function Score({ value }: { value: number }) {
  return <span className="w-9 shrink-0 text-right font-mono text-[13px] font-semibold text-forest tabular">{value}</span>;
}

function Card({ title, href, link, children }: { title: string; href: string; link: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-hairline bg-paper p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-strong">{title}</h2>
        <Link href={href} className="link-underline inline-flex items-center gap-1 text-[13px] hover:decoration-2">
          {link}
        </Link>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-card bg-recessed px-4 py-6 text-center text-[14px] text-muted">{children}</p>;
}
