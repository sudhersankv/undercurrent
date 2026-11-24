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

/** Six departments as one closed loop. */
export function LoopRow() {
  return (
    <ol className="grid grid-cols-2 border-t border-hairline sm:grid-cols-3 lg:grid-cols-6">
      {STEPS.map((s, i) => (
        <li key={s.dept} className="flex flex-col gap-3 border-b border-hairline px-5 py-6 lg:border-b-0 lg:border-l lg:first:border-l-0">
          <div className="flex items-center justify-between text-muted">
            <span className="font-mono text-[11px] tabular">0{i + 1}</span>
            <DeptGlyph dept={s.dept} className="text-body" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="eyebrow">{DEPT_LABELS[s.dept]}</span>
            <span className="text-[17px] font-medium tracking-[-0.02em] text-strong">{s.verb}</span>
          </div>
          <p className="text-[13px] leading-snug text-body">{s.line}</p>
        </li>
      ))}
    </ol>
  );
}
