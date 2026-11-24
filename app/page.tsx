import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { IntakeForm } from "@/components/landing/intake-form";
import { LandingNav } from "@/components/landing/landing-nav";
import { LoopRow } from "@/components/landing/loop-row";
import { OrbStage } from "@/components/landing/orb-stage";
import { Button, Card } from "@/components/ui";

const CONTAINER = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";

const RULES = ["Simulated results are always labeled.", "Only Sounding marks a market as real.", "Every email cites public evidence."];

const LEDGER = [
  { k: "Simulated", v: "Swarm's guesses about who needs your tool.", n: "01" },
  { k: "Evidence", v: "Sounding checks the public record.", n: "02" },
  { k: "People", v: "Pilot names who has the problem today.", n: "03" },
];

const FACTS = [
  { v: "~4 min", k: "from URL to people" },
  { v: "6", k: "agents in one loop" },
  { v: "0", k: "emails sent without you" },
];

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col bg-canvas">
      <LandingNav />

      {/* Hero */}
      <section className={`${CONTAINER} flex flex-col items-center overflow-x-clip pt-12 text-center sm:pt-16 lg:pt-20`}>
        <h1 className="display max-w-[14ch] text-[44px] sm:text-[72px] lg:text-[104px]">Find the markets you didn&apos;t know you had</h1>
        <p className="mt-6 max-w-[40ch] text-[17px] leading-relaxed text-body sm:mt-8 sm:text-[20px]">
          Simulated developers guess who needs your tool. Public evidence decides who&apos;s right. Then we find the people.
        </p>
        <div className="mt-8 flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
          <Button asChild variant="cta" size="lg">
            <a href="#start">
              Start a run
              <ArrowRight aria-hidden />
            </a>
          </Button>
          <Button asChild variant="link" className="h-auto px-0 text-base">
            <Link href="/runs/showcase">Explore a finished run</Link>
          </Button>
        </div>

        <OrbStage />
      </section>

      {/* Intake on a lime band */}
      <section id="start" className="mt-20 scroll-mt-[72px] bg-lime sm:mt-28">
        <div className={`${CONTAINER} grid grid-cols-1 items-center gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16`}>
          <div className="flex flex-col gap-6">
            <h2 className="text-[36px] font-bold leading-[1.05] tracking-[-0.03em] text-forest sm:text-[52px]">Point Sonar at your product</h2>
            <p className="max-w-[42ch] text-[17px] leading-relaxed text-forest sm:text-[18px]">
              Paste a URL or a few notes. <span className="font-semibold underline decoration-[1.5px] underline-offset-4">Six agents</span> take it from there, from
              first read to <span className="font-semibold underline decoration-[1.5px] underline-offset-4">drafted email</span>.
            </p>
            <ul className="flex flex-col gap-3">
              {RULES.map((r) => (
                <li key={r} className="flex items-center gap-3 text-[15px] font-medium text-forest">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-forest text-lime">
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-4">
            <Card radius="large" className="border-transparent p-6 sm:p-8">
              <div className="mb-5 flex items-baseline justify-between gap-4">
                <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-strong">Start a run</h3>
                <span className="text-[13px] text-muted">About 4 minutes</span>
              </div>
              <IntakeForm />
            </Card>
            <p className="px-2 text-[14px] text-forest">
              Short on time?{" "}
              <Link href="/runs/showcase" className="font-semibold underline decoration-[1.5px] underline-offset-4 hover:decoration-2">
                Explore a finished run
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* The loop on a fog band */}
      <section id="how" className="scroll-mt-[72px] bg-fog">
        <div className={`${CONTAINER} flex flex-col gap-10 py-16 sm:gap-14 sm:py-24`}>
          <div className="mx-auto flex max-w-[640px] flex-col items-center gap-4 text-center">
            <h2 className="text-[32px] font-bold leading-[1.1] tracking-[-0.03em] text-strong sm:text-[44px]">Six agents. One loop.</h2>
            <p className="text-[17px] leading-relaxed text-body sm:text-[18px]">
              Each department hands its work to the next. Replies feed back in, so every run is sharper than the last.
            </p>
          </div>
          <LoopRow />
        </div>
      </section>

      {/* Closing forest section */}
      <section className="bg-forest">
        <div className={`${CONTAINER} flex flex-col gap-14 pt-16 pb-10 sm:pt-24`}>
          <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="flex flex-col items-start gap-6">
              <h2 className="display max-w-[16ch] text-[40px] text-lime sm:text-[64px] lg:text-[80px]">Simulated first. Evidence decides.</h2>
              <p className="max-w-[52ch] text-[17px] leading-relaxed text-paper/80 sm:text-[18px]">
                Nothing gets called a market until the public record backs it up. You see which is which, every time.
              </p>
              <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-8">
                <Button asChild variant="cta" size="lg">
                  <a href="#start">
                    Start a run
                    <ArrowRight aria-hidden />
                  </a>
                </Button>
                <Button asChild variant="link" className="h-auto px-0 text-base text-paper">
                  <Link href="/runs/showcase">Explore a finished run</Link>
                </Button>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-3 lg:grid-cols-1">
              {FACTS.map((f) => (
                <div key={f.k} className="flex flex-col gap-1 rounded-[20px] bg-spruce px-5 py-4 lg:flex-row lg:items-baseline lg:gap-4">
                  <dt className="text-[28px] font-bold leading-none tracking-[-0.02em] text-lime tabular lg:w-28 lg:shrink-0">{f.v}</dt>
                  <dd className="text-[14px] text-paper/80">{f.k}</dd>
                </div>
              ))}
            </dl>
          </div>

          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-large border border-white/15 bg-white/15 sm:grid-cols-3">
            {LEDGER.map((l) => (
              <div key={l.k} className="flex flex-col gap-2 bg-forest p-6 sm:p-7">
                <span className="text-[12px] font-semibold text-paper/50 tabular">{l.n}</span>
                <dt className="text-[17px] font-semibold text-paper">{l.k}</dt>
                <dd className="text-[15px] leading-relaxed text-paper/80">{l.v}</dd>
              </div>
            ))}
          </dl>

          <footer className="flex flex-col gap-6 border-t border-white/15 pt-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              <Logo size={18} className="text-lime" />
              <span className="text-[13px] text-paper/60">An AI go-to-market team for dev tools.</span>
            </div>
            <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px] font-semibold text-paper/80">
              <a href="#how" className="transition-colors hover:text-lime">
                How it works
              </a>
              <Link href="/runs/showcase" className="transition-colors hover:text-lime">
                Showcase
              </Link>
              <a href="#start" className="transition-colors hover:text-lime">
                Start a run
              </a>
              <span className="text-[13px] font-medium text-paper/50">Retrieval by Moss</span>
            </nav>
          </footer>
        </div>
      </section>
    </main>
  );
}
