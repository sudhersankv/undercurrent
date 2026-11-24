import { DeptGlyph, VerdictChip } from "@/components/ui";
import type { DeptId } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { ParticleOrb } from "./particle-orb";

function Note({ dept, title, sub, extra, className }: { dept: DeptId; title: string; sub: string; extra?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "absolute hidden items-center gap-3 rounded-pill border border-hairline bg-paper py-2 pl-2 pr-5 text-left animate-in fade-in slide-in-from-bottom-2 fill-mode-both duration-700 md:flex",
        className,
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-forest text-lime">
        <DeptGlyph dept={dept} size={17} aria-hidden />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="text-[15px] font-semibold text-strong">{title}</span>
        <span className="text-[12px] text-muted">{sub}</span>
      </span>
      {extra}
    </div>
  );
}

/** The swarm orb inside sonar rings, with three pill notes showing what each stage produces. */
export function OrbStage() {
  return (
    <figure className="relative mt-16 flex w-full flex-col items-center sm:mt-24">
      <div className="relative aspect-square w-full max-w-[340px] sm:max-w-[500px] lg:max-w-[560px]">
        {/* sonar rings */}
        <span aria-hidden className="absolute inset-[3%] rounded-full border border-hairline" />
        <span aria-hidden className="absolute -inset-[8%] hidden rounded-full border border-dashed border-hairline sm:block" />
        <ParticleOrb />

        <Note dept="swarm" title="2,400 developers" sub="Simulated reactions to your pitch" className="-left-[30%] top-[14%] [animation-delay:300ms]" />
        <Note
          dept="sounding"
          title="Local-first apps"
          sub="6 sources · public evidence"
          extra={<VerdictChip verdict="VERIFIED" className="ml-1" />}
          className="-right-[34%] top-[46%] [animation-delay:600ms]"
        />
        <Note dept="pilot" title="18 people found" sub="Draft only until you approve" className="-left-[22%] bottom-[8%] [animation-delay:900ms]" />
      </div>
      <figcaption className="mt-8 inline-flex sm:mt-16 items-center gap-2 rounded-pill bg-raised px-3.5 py-1.5 text-[13px] font-medium text-charcoal">
        <span className="size-2 rounded-full bg-forest" aria-hidden />
        Each point is a simulated developer
      </figcaption>
    </figure>
  );
}
