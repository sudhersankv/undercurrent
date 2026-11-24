"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { reviewQueueCount } from "@/lib/client/run-store";
import { cn } from "@/lib/utils";
import { useRun } from "./run-context";

const TABS = [
  { href: "", label: "Mission" },
  { href: "/market", label: "Market" },
  { href: "/leads", label: "Leads" },
  { href: "/review", label: "Review" },
  { href: "/chart", label: "Chart" },
] as const;

function Stat({ label, value, tone = "lichen", title }: { label: string; value: string; tone?: "lichen" | "muted" | "warn"; title?: string }) {
  return (
    <div className="flex flex-col items-end gap-0.5" title={title}>
      <span className="eyebrow text-[10px]">{label}</span>
      <span className={cn("font-mono text-[15px] font-medium tabular leading-none", tone === "lichen" && "text-lichen", tone === "muted" && "text-muted", tone === "warn" && "text-danger")}>
        {value}
      </span>
    </div>
  );
}

export function MissionHeader() {
  const { runId, store, status } = useRun();
  const pathname = usePathname();
  const base = `/runs/${runId}`;
  const queue = reviewQueueCount(store);
  const company = store.profile?.name ?? (store.events[0]?.payload as { companyName?: string } | undefined)?.companyName ?? null;
  const rel = store.reliability;
  const cal = store.calibration;

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-hairline px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="text-[14px] font-medium tracking-[-0.02em] text-strong hover:text-lichen">
            Undercurrent
          </Link>
          <span className="text-muted" aria-hidden>
            /
          </span>
          <span className="truncate text-[14px] font-medium text-strong">{company ?? "New run"}</span>
          <span className="hidden font-mono text-[11px] text-muted sm:inline">{store.state ?? "INTAKE"}</span>
          {status !== "live" ? (
            <span className="font-mono text-[11px] text-muted" role="status">
              {status === "connecting" ? "connecting" : "reconnecting"}
            </span>
          ) : null}
        </div>

        <nav aria-label="Run views" className="order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
          {TABS.map((t) => {
            const href = `${base}${t.href}`;
            const on = t.href === "" ? pathname === base : pathname.startsWith(href);
            return (
              <Link
                key={t.label}
                href={href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-3 text-[13px] transition-colors",
                  on ? "bg-raised text-strong" : "text-body hover:bg-raised hover:text-strong",
                )}
              >
                {t.label}
                {t.label === "Review" && queue > 0 ? (
                  <span className="rounded-full bg-lichen px-1.5 font-mono text-[10.5px] font-medium leading-4 text-recessed tabular" aria-label={`${queue} waiting`}>
                    {queue}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-6">
          <Stat
            label="Swarm reliability"
            value={rel ? rel.value.toFixed(2) : "--"}
            tone={!rel ? "muted" : rel.warning ? "warn" : "lichen"}
            title={rel ? `Control segments averaged ${rel.controlMean.toFixed(2)}` : undefined}
          />
          <Stat label="Calibration error" value={cal ? cal.globalError.toFixed(2) : "--"} tone={cal ? "lichen" : "muted"} />
        </div>
      </header>
      {rel?.warning ? (
        <div role="status" className="border-b border-hairline bg-raised px-4 py-2 text-[13px] text-danger">
          Swarm agrees with everything. Trust evidence only.
        </div>
      ) : null}
    </>
  );
}
