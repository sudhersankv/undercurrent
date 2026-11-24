"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { TriangleAlert } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand/logo";
import { LiveRunChip, RunSwitcher } from "@/components/demo/run-switcher";
import { reviewQueueCount } from "@/lib/client/run-store";
import { cn } from "@/lib/utils";
import { HealthMeters } from "./health-meters";
import { LoopStepper } from "./loop-strip";
import { isRunOver, useRun } from "./run-context";
import { StatusPill } from "./status-pill";

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

function Count({ n, on, strong, label }: { n: number; on: boolean; strong?: boolean; label: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-pill px-1.5 text-[11px] font-semibold leading-none tabular transition-colors",
        strong ? (on ? "bg-forest text-lime" : "bg-forest text-paper") : on ? "bg-paper/70 text-forest" : "bg-paper text-forest",
      )}
      aria-label={label}
    >
      {n}
    </span>
  );
}

export function MissionHeader() {
  const { runId, store, status } = useRun();
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const base = `/runs/${runId}`;
  const queue = reviewQueueCount(store);
  const replies = store.replies.length;
  const company = store.profile?.name ?? (store.events[0]?.payload as { companyName?: string } | undefined)?.companyName ?? null;
  const over = isRunOver(store);
  const rel = store.reliability;

  return (
    <>
      <header className="relative z-30 border-b border-hairline bg-paper">
        {/* row 1: brand · run · status ........ live chip · health */}
        <div className="flex h-14 items-center gap-3 px-4 md:px-6">
          <Link href="/" aria-label="Undercurrent home" className="-ml-1 flex h-9 shrink-0 items-center rounded-pill px-1 transition-opacity hover:opacity-75">
            <Logo size={17} className="hidden md:inline-flex" />
            <LogoMark className="h-[18px] text-forest md:hidden" />
          </Link>
          <span className="h-5 w-px shrink-0 bg-hairline-strong" aria-hidden />
          <RunSwitcher runId={runId} companyName={company} state={store.state} over={over} />
          <StatusPill state={store.state} over={over} stream={status} reviewHref={`${base}/review`} />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <LiveRunChip runId={runId} />
            <HealthMeters reliability={rel} calibration={store.calibration} />
          </div>
        </div>

        {/* row 2: segmented nav ........ department stepper */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-2.5 md:px-6">
          <nav aria-label="Run views" className="-mx-1 max-w-full overflow-x-auto px-1 [scrollbar-width:none]">
            <div className="relative inline-flex gap-0.5 rounded-pill bg-raised p-1">
              {TABS.map((t) => {
                const href = `${base}${t.href}`;
                const on = t.href === "" ? pathname === base : pathname.startsWith(href);
                return (
                  <Link
                    key={t.label}
                    href={href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "relative inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 text-[13px] font-semibold transition-colors duration-150 min-[1400px]:px-3",
                      on ? "text-forest" : "text-charcoal hover:bg-paper/70 hover:text-strong",
                    )}
                  >
                    {on ? (
                      <motion.span
                        layoutId="run-nav-active"
                        aria-hidden
                        className="absolute inset-0 rounded-pill bg-lime"
                        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
                      />
                    ) : null}
                    <span className="relative">{t.label}</span>
                    {t.label === "Outreach" && queue > 0 ? <Count n={queue} on={on} strong label={`${queue} waiting`} /> : null}
                    {t.label === "Inbox" && replies > 0 ? <Count n={replies} on={on} label={`${replies} replies`} /> : null}
                  </Link>
                );
              })}
            </div>
          </nav>

          <LoopStepper className="ml-auto max-w-full overflow-x-auto [scrollbar-width:none] lg:overflow-visible" />
        </div>
      </header>
      {rel?.warning ? (
        <div role="status" className="flex items-center gap-2 border-b border-danger/20 bg-danger/5 px-4 py-2 text-[13px] font-medium text-danger md:px-6">
          <TriangleAlert className="size-4" aria-hidden />
          Swarm agrees with everything. Trust evidence only.
        </div>
      ) : null}
    </>
  );
}
