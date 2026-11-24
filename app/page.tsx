import { IntakeForm } from "@/components/landing/intake-form";
import { LoopRow } from "@/components/landing/loop-row";
import { ParticleOrb } from "@/components/landing/particle-orb";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-canvas">
      <header className="relative z-10 mx-auto flex w-full max-w-[1360px] items-center justify-between px-4 py-5 sm:px-8">
        <span className="text-[15px] font-medium tracking-[-0.02em] text-strong">Undercurrent</span>
        <span className="font-mono text-[11px] text-muted">six agents · one loop</span>
      </header>

      <section className="relative mx-auto grid w-full max-w-[1360px] flex-1 grid-cols-1 items-center gap-6 px-4 pb-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-0">
        <div className="relative z-10 order-2 flex flex-col gap-7 lg:order-1 lg:py-16">
          <p className="eyebrow">GTM for dev-tool companies</p>
          <h1 className="max-w-[13ch] text-[44px] leading-[1.02] tracking-[-0.045em] sm:text-[64px] lg:text-[76px]">
            Find the markets you didn&apos;t know you had.
          </h1>
          <p className="max-w-[46ch] text-[16px] leading-relaxed text-body">
            Simulated developers guess who needs your tool. Public evidence decides who&apos;s right. Then we find the people.
          </p>
          <IntakeForm />
        </div>

        <figure className="relative order-1 mx-auto aspect-square w-full max-w-[280px] sm:max-w-[480px] lg:order-2 lg:-mr-16 lg:max-w-none">
          {/* depth by surface step: a recessed well behind the orb, no glow */}
          <div className="absolute inset-[9%] rounded-full bg-recessed" aria-hidden />
          <ParticleOrb className="relative" />
          <figcaption className="absolute bottom-[6%] right-[8%] flex items-center gap-2 font-mono text-[11px] text-muted">
            <span className="size-1.5 bg-lichen" aria-hidden />
            each point is a simulated developer
          </figcaption>
        </figure>
      </section>

      <div className="relative z-10 mx-auto w-full max-w-[1360px] px-4 sm:px-8">
        <LoopRow />
      </div>
      <footer className="mx-auto flex w-full max-w-[1360px] items-center justify-between px-4 py-5 font-mono text-[11px] text-muted sm:px-8">
        <span>retrieval: Moss</span>
        <span>Simulated first. Evidence decides.</span>
      </footer>
    </main>
  );
}
