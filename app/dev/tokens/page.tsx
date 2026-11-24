import { Button, Card, CardHeader, CardTitle, DeptGlyph, DeptLabel, Eyebrow, Pill, StatCounter, VerdictChip } from "@/components/ui";
import type { EventDept, Verdict } from "@/lib/contracts";

export const metadata = { title: "Tokens · Undercurrent" };

const SWATCHES: Array<[string, string, string]> = [
  ["canvas", "#0C1F16", "bg-canvas"],
  ["recessed", "#08170F", "bg-recessed"],
  ["raised", "#143322", "bg-raised"],
  ["raised-hover", "#1C4430", "bg-raised-hover"],
  ["text-strong", "#F4FAF5", "bg-strong"],
  ["text-body", "#B3C4B8", "bg-body"],
  ["text-muted", "#6F7F74", "bg-muted"],
  ["lichen", "#D8F5A2", "bg-lichen"],
];
const VERDICTS: Verdict[] = ["VERIFIED", "PROMISING", "HYPE", "KILLED", "PENDING"];
const DEPTS: EventDept[] = ["sonar", "swarm", "sounding", "pilot", "tide", "wake", "helm"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-hairline pt-6">
      <Eyebrow as="h2">{title}</Eyebrow>
      {children}
    </section>
  );
}

export default function TokensPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>Undercurrent · design tokens</Eyebrow>
        <h1 className="text-5xl">Abyssal terminal, forest and lichen.</h1>
        <p className="max-w-xl text-body">No shadows. Depth from surface steps. Weight 500 headings, tracked eyebrows, Geist and Geist Mono.</p>
      </header>

      <Section title="Surfaces and text">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SWATCHES.map(([name, hex, cls]) => (
            <div key={name} className="flex flex-col gap-2">
              <div className={`h-16 rounded-card border border-hairline ${cls}`} />
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-strong">{name}</span>
                <span className="font-mono text-[11px] text-muted">{hex}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="h-10 rounded-card bg-cta" />
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-3">
          <h1 className="text-6xl">Find the markets</h1>
          <h2 className="text-3xl">Accidental markets</h2>
          <h3 className="text-lg">Local-first app & plugin builders</h3>
          <p className="text-[14px] text-body">Body 14px. Sounding found 6 supporting items across 3 sources.</p>
          <p className="text-[13px] text-muted">Muted 13px. Simulated personas, not real people.</p>
          <p className="font-mono text-[13px] text-body">github.com/Minitour/semlocal · fit 84 · 0.74</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="cta" size="lg">
            Send Sonar
          </Button>
          <Button variant="cta">Approve</Button>
          <Button>Full report</Button>
          <Button variant="outline">Find similar</Button>
          <Button variant="ghost">Show controls</Button>
          <Button size="sm">Dig deeper</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Raised card</CardTitle>
              <VerdictChip verdict="VERIFIED" />
            </CardHeader>
            <p className="text-[13px]">Sits one step above the canvas.</p>
          </Card>
          <Card surface="recessed">
            <CardHeader>
              <CardTitle>Recessed card</CardTitle>
              <Pill tone="muted">Simulated</Pill>
            </CardHeader>
            <p className="text-[13px]">Sinks below the canvas, for wells and inputs.</p>
          </Card>
          <Card surface="interactive">
            <CardTitle>Interactive card</CardTitle>
            <p className="mt-2 text-[13px]">Hover steps to raised-hover.</p>
          </Card>
        </div>
      </Section>

      <Section title="Stats">
        <div className="flex flex-wrap gap-10">
          <StatCounter label="Swarm reliability" value={0.86} decimals={2} size="lg" />
          <StatCounter label="Evidence" value={41} />
          <StatCounter label="Leads" value={12} accent={false} />
          <StatCounter label="Cost" value={0.42} decimals={2} prefix="$" size="sm" />
        </div>
      </Section>

      <Section title="Departments">
        <div className="flex flex-wrap gap-6">
          {DEPTS.map((d) => (
            <DeptLabel key={d} dept={d} />
          ))}
        </div>
        <div className="flex gap-4 text-lichen">
          {DEPTS.map((d) => (
            <DeptGlyph key={d} dept={d} size={28} />
          ))}
        </div>
      </Section>

      <Section title="Verdicts and pills">
        <div className="flex flex-wrap gap-2">
          {VERDICTS.map((v) => (
            <VerdictChip key={v} verdict={v} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill>Tier A</Pill>
          <Pill tone="lichen">AI · Wake</Pill>
          <Pill tone="solid">You</Pill>
          <Pill tone="muted" mono>
            fixture
          </Pill>
          <Pill tone="warning">small sample</Pill>
          <Pill tone="muted">Simulated credits</Pill>
        </div>
      </Section>
    </main>
  );
}
