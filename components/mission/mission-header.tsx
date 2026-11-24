"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { reviewQueueCount } from "@/lib/client/run-store";
import { cn } from "@/lib/utils";
import { useRun } from "./run-context";

const TABS = [
  { href: "", label: "Workspace" },
  { href: "/leads", label: "Accounts & People" },
  { href: "/review", label: "Outreach" },
  { href: "/inbox", label: "Inbox" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/market", label: "Discovery" },
  { href: "/campaign", label: "Campaign" },
  { href: "/chart", label: "Chart" },
] as const;

function Stat({ label, value, tone = "lichen", title }: { label: string; value: string; tone?: "lichen" | "muted" | "warn"; title?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-pill border px-3 text-[13px]",
        tone === "warn" ? "border-danger/40 bg-danger/5" : "border-hairline-strong bg-paper",
      )}
      title={title}
    >
      <span className="font-medium text-muted">{label}</span>
      <span className={cn("font-semibold tabular", tone === "lichen" && "text-forest", tone === "muted" && "text-pebble", tone === "warn" && "text-danger")}>{value}</span>
    </span>
  );
}

export function MissionHeader() {
  const { runId, store, status } = useRun();
  const pathname = usePathname();
  const base = `/runs/${runId}`;
  const queue = reviewQueueCount(store);
  const replies = store.replies.length;
  const company = store.profile?.name ?? (store.events[0]?.payload as { companyName?: string } | undefined)?.companyName ?? null;
  const rel = store.reliability;
  const cal = store.calibration;

  return (
    <>
      <header className="border-b border-hairline bg-paper">
        <div className="flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-6 2xl:flex-nowrap 2xl:py-0">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="shrink-0 transition-opacity hover:opacity-80">
              <Logo size={19} />
            </Link>
            <span className="h-5 w-px shrink-0 bg-hairline-strong" aria-hidden />
            <span className="truncate text-[15px] font-semibold text-strong">{company ?? "New run"}</span>
            <span className="hidden h-6 shrink-0 items-center rounded-pill bg-raised px-2.5 font-mono text-[11px] font-medium text-charcoal sm:inline-flex">
              {store.state ?? "INTAKE"}
            </span>
            {status !== "live" ? (
              <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-pill border border-hairline-strong px-2.5 text-[12px] font-medium text-muted" role="status">
                <span className="size-1.5 animate-pulse rounded-full bg-pebble" aria-hidden />
                {status === "connecting" ? "Connecting" : "Reconnecting"}
              </span>
            ) : null}
          </div>

          <nav
            aria-label="Run views"
            className="order-3 -mx-1 w-full overflow-x-auto px-1 [scrollbar-width:none] 2xl:order-none 2xl:mx-0 2xl:w-auto 2xl:px-0"
          >
            <div className="inline-flex gap-0.5 rounded-pill bg-raised p-1">
              {TABS.map((t) => {
                const href = `${base}${t.href}`;
                const on = t.href === "" ? pathname === base : pathname.startsWith(href);
                return (
                  <Link
                    key={t.label}
                    href={href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-3 text-sm font-semibold transition-colors",
                      on ? "bg-lime text-forest" : "text-charcoal hover:bg-paper hover:text-strong",
                    )}
                  >
                    {t.label}
                    {t.label === "Outreach" && queue > 0 ? (
                      <span
                        className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-forest px-1.5 text-[11px] font-semibold leading-none text-paper tabular"
                        aria-label={`${queue} waiting`}
                      >
                        {queue}
                      </span>
                    ) : null}
                    {t.label === "Inbox" && replies > 0 ? (
                      <span
                        className={cn(
                          "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-pill px-1.5 text-[11px] font-semibold leading-none tabular",
                          on ? "bg-paper/70 text-forest" : "bg-linen text-forest",
                        )}
                        aria-label={`${replies} replies`}
                      >
                        {replies}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Stat
              label="Reliability"
              value={rel ? rel.value.toFixed(2) : "--"}
              tone={!rel ? "muted" : rel.warning ? "warn" : "lichen"}
              title={rel ? `Swarm reliability. Control segments averaged ${rel.controlMean.toFixed(2)}` : "Swarm reliability"}
            />
            <Stat label="Calibration" value={cal ? cal.globalError.toFixed(2) : "--"} tone={cal ? "lichen" : "muted"} title="Calibration error" />
          </div>
        </div>
      </header>
      {rel?.warning ? (
        <div role="status" className="border-b border-danger/20 bg-danger/5 px-4 py-2 text-[13px] font-medium text-danger md:px-6">
          Swarm agrees with everything. Trust evidence only.
        </div>
      ) : null}
    </>
  );
}
