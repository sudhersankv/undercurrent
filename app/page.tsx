import { ArrowRight, Check } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { IntakeForm } from "@/components/landing/intake-form";
import { LoopRow } from "@/components/landing/loop-row";
import { ParticleOrb } from "@/components/landing/particle-orb";
import { Button, Card } from "@/components/ui";

const CONTAINER = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";

const RULES = ["Simulated results are always labeled.", "Only Sounding marks a market as real.", "Every email cites public evidence."];

const LEDGER = [
  { k: "Simulated", v: "Swarm's guesses about who needs your tool." },
  { k: "Evidence", v: "Sounding checks the public record." },
  { k: "People", v: "Pilot names who has the problem today." },
];

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col bg-canvas">
      <header className={`${CONTAINER} flex h-[72px] items-center justify-between gap-4`}>
        <Logo size={22} />
        <nav className="flex items-center gap-5">
          <a href="#how" className="hidden text-[15px] font-semibold text-forest hover:underline hover:underline-offset-4 sm:inline">
            How it works
          </a>
          <Button asChild variant="cta" size="sm">
            <a href="#start">Start a run</a>
          </Button>
        </nav>
      </header>

      {/* Hero */}
      <section className={`${CONTAINER} flex flex-col items-center pt-14 text-center sm:pt-20 lg:pt-24`}>
        <h1 className="display max-w-[14ch] text-[44px] sm:text-[72px] lg:text-[104px]">Find the markets you didn&apos;t know you had</h1>
        <p className="mt-6 max-w-[40ch] text-[17px] leading-relaxed text-body sm:mt-8 sm:text-[20px]">
          Simulated developers guess who needs your tool. Public evidence decides who&apos;s right. Then we find the people.
        </p>
        <div className="mt-8 flex flex-col items-center gap-5 sm:flex-row sm:gap-8">
          <Button asChild variant="cta" size="lg">
            <a href="#start">Start a run</a>
          </Button>
          <Button asChild variant="link" className="h-auto px-0 text-base">
            <a href="#how">See the loop</a>
          </Button>
        </div>

        <figure className="relative mt-10 flex w-full flex-col items-center sm:mt-14">
          <div className="aspect-square w-full max-w-[340px] sm:max-w-[520px] lg:max-w-[600px]">
            <ParticleOrb />
          </div>
          <figcaption className="mt-2 inline-flex items-center gap-2 rounded-pill bg-raised px-3.5 py-1.5 text-[13px] font-medium text-charcoal">
            <span className="size-2 rounded-full bg-forest" aria-hidden />
            Each point is a simulated developer
          </figcaption>
        </figure>
      </section>

      {/* Intake on a lime band */}
      <section id="start" className="mt-16 scroll-mt-4 bg-lime sm:mt-24">
        <div className={`${CONTAINER} grid grid-cols-1 items-center gap-10 py-16 sm:py-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16`}>
          <div className="flex flex-col gap-6">
            <h2 className="text-[36px] font-bold leading-[1.05] tracking-[-0.03em] text-forest sm:text-[52px]">Point Sonar at your product</h2>
            <p className="max-w-[42ch] text-[17px] leading-relaxed text-forest sm:text-[18px]">
              Paste a URL or a few notes. <span className="font-semibold underline decoration-[1.5px] underline-offset-4">Six agents</span> take it from there, from
              first read to <span className="font-semibold underline decoration-[1.5px] underline-offset-4">sent email</span>.
            </p>
            <ul className="flex flex-col gap-3">
              {RULES.map((r) => (
                <li key={r} className="flex items-center gap-3 text-[15px] font-medium text-forest">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-forest text-linen">
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          </div>

          <Card radius="large" className="border-transparent p-6 sm:p-8">
            <h3 className="mb-5 text-[20px] font-semibold tracking-[-0.02em] text-strong">Start a run</h3>
            <IntakeForm />
          </Card>
        </div>
      </section>

      {/* The loop on a fog band */}
      <section id="how" className="scroll-mt-4 bg-fog">
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
        <div className={`${CONTAINER} flex flex-col gap-12 pt-16 pb-10 sm:pt-24`}>
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
                <a href="#how">See the loop</a>
              </Button>
            </div>
          </div>

          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-large border border-white/15 bg-white/15 sm:grid-cols-3">
            {LEDGER.map((l) => (
              <div key={l.k} className="flex flex-col gap-2 bg-forest p-6">
                <dt className="text-[17px] font-semibold text-paper">{l.k}</dt>
                <dd className="text-[15px] leading-relaxed text-paper/80">{l.v}</dd>
              </div>
            ))}
          </dl>

          <footer className="flex flex-col gap-2 border-t border-white/15 pt-6 text-[13px] text-paper/60 sm:flex-row sm:items-center sm:justify-between">
            <Logo size={16} className="text-lime" />
            <span className="font-mono">retrieval: Moss</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
