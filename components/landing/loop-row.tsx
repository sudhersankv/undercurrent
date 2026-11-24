import { DeptGlyph, DEPT_LABELS } from "@/components/ui";
import type { DeptId } from "@/lib/contracts";

const STEPS: { dept: DeptId; verb: string; line: string }[] = [
  { dept: "sonar", verb: "Understand", line: "Reads your site, docs and rivals." },
  { dept: "swarm", verb: "Imagine", line: "Simulated developers react to your pitch." },
  { dept: "sounding", verb: "Prove", line: "Hunts public evidence that a market is real." },
  { dept: "pilot", verb: "Find", line: "Names the people with the problem." },
  { dept: "tide", verb: "Reach", line: "Drafts email that cites their code." },
  { dept: "wake", verb: "Learn", line: "Replies recalibrate the swarm." },
];

/** Six departments as one closed loop: white feature cards for a fog band. */
export function LoopRow() {
  return (
    <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {STEPS.map((s, i) => (
        <li key={s.dept} className="flex flex-col gap-5 rounded-large bg-paper p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <span className="flex size-12 items-center justify-center rounded-full bg-raised text-forest">
              <DeptGlyph dept={s.dept} size={20} />
            </span>
            <span className="text-[13px] font-semibold text-muted tabular" aria-hidden>
              0{i + 1}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="eyebrow">{DEPT_LABELS[s.dept]}</span>
            <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-strong">{s.verb}</h3>
            <p className="text-[15px] leading-relaxed text-body">{s.line}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
