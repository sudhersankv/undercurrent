import { ArrowRight, ArrowUp, Check } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, DeptChip, DeptGlyph, DeptLabel, DEPT_LABELS, Eyebrow, Pill, StatCounter, VERDICT_COLORS, VerdictChip } from "@/components/ui";
import { HealthMeters } from "@/components/mission/health-meters";
import { StatusPill } from "@/components/mission/status-pill";
import { Avatar, FitRing, Sparkline } from "@/components/workspace/bits";
import type { DeptId, EventDept, Verdict } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";

export const metadata = { title: "Style guide · Undercurrent" };

type Swatch = { name: string; hex: string; cls: string; use: string; dark?: boolean };

const BRAND: Swatch[] = [
  { name: "Forest", hex: "#163300", cls: "bg-forest", use: "Brand ink, dark sections", dark: true },
  { name: "Lime", hex: "#9fe870", cls: "bg-lime", use: "Primary fill, one active state" },
  { name: "Spruce", hex: "#054d28", cls: "bg-spruce", use: "Cards inside forest", dark: true },
  { name: "Linen", hex: "#e2f6d5", cls: "bg-linen", use: "Hover, selected, mentions" },
];
const SURFACES: Swatch[] = [
  { name: "canvas / paper", hex: "#ffffff", cls: "bg-canvas", use: "Page, cards on fog" },
  { name: "recessed", hex: "#f2f4f0", cls: "bg-recessed", use: "Quiet wells" },
  { name: "raised / fog", hex: "#e8ebe6", cls: "bg-raised", use: "Bands, chips, segments" },
  { name: "raised-hover / linen", hex: "#e2f6d5", cls: "bg-raised-hover", use: "Hover" },
];
const TEXT: Swatch[] = [
  { name: "strong", hex: "#0e0f0c", cls: "bg-strong", use: "Headings, key numbers", dark: true },
  { name: "body", hex: "#454745", cls: "bg-body", use: "Body copy", dark: true },
  { name: "muted", hex: "#6a6c6a", cls: "bg-muted", use: "Labels, metadata", dark: true },
  { name: "pebble", hex: "#868685", cls: "bg-pebble", use: "Placeholder, disabled", dark: true },
  { name: "danger", hex: "#cb272f", cls: "bg-danger", use: "Errors, destructive", dark: true },
];

const VERDICTS: Verdict[] = ["VERIFIED", "PROMISING", "HYPE", "KILLED", "PENDING"];
const DEPTS: EventDept[] = ["sonar", "swarm", "sounding", "pilot", "tide", "wake", "helm"];
const STEPS: Array<{ d: DeptId; state: "done" | "active" | "pending" }> = [
  { d: "sonar", state: "done" },
  { d: "swarm", state: "done" },
  { d: "sounding", state: "active" },
  { d: "pilot", state: "pending" },
  { d: "tide", state: "pending" },
  { d: "wake", state: "pending" },
];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-hairline pt-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h2>
        {note ? <p className="max-w-2xl text-[14px] text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Swatches({ items }: { items: Swatch[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((s) => (
        <div key={s.name} className="flex flex-col gap-2">
          <div className={cn("flex h-20 items-end rounded-card border border-hairline p-2.5", s.cls)}>
            <span className={cn("font-mono text-[11px]", s.dark ? "text-paper/80" : "text-forest/70")}>{s.cls}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-strong">{s.name}</span>
            <span className="font-mono text-[11px] text-muted">{s.hex}</span>
          </div>
          <span className="-mt-1.5 text-[12px] text-muted">{s.use}</span>
        </div>
      ))}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] font-semibold text-muted">{children}</p>;
}

export default function TokensPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <nav className="sticky top-0 z-10 border-b border-hairline bg-paper">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-6">
          <Logo size={19} />
          <div className="hidden gap-0.5 rounded-pill bg-raised p-1 md:inline-flex">
            {["Color", "Type", "Controls", "Surfaces", "Product"].map((l, i) => (
              <a
                key={l}
                href={`#${l.toLowerCase()}`}
                className={cn("inline-flex h-8 items-center rounded-pill px-3 text-sm font-semibold", i === 0 ? "bg-lime text-forest" : "text-charcoal hover:bg-paper")}
              >
                {l}
              </a>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden font-mono text-[12px] text-muted sm:inline">DESIGN.md</span>
            <Pill tone="muted">Dev only</Pill>
          </div>
        </div>
      </nav>

      <main className="mx-auto flex max-w-[1200px] flex-col gap-12 px-6 pb-24 pt-14">
        <header className="flex flex-col gap-5">
          <Eyebrow>Undercurrent · style guide</Eyebrow>
          <h1 className="display text-[56px] sm:text-[80px]">Deep moss, lime voltage</h1>
          <p className="max-w-2xl text-[17px] text-body">
            Light, flat and confident. Forest carries the weight, lime is the one accent per section, and everything you can press is a pill. Depth comes from surface steps and hairlines, never shadows.
          </p>
          <div className="flex items-center gap-5">
            <Button variant="cta" size="lg">
              Start a run
            </Button>
            <Button variant="link">Read the rules</Button>
          </div>
        </header>

        <Section title="Color" note="Tokens live in app/globals.css. Lime is a fill, never text on a light surface.">
          <div id="color" className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Label>Brand</Label>
              <Swatches items={BRAND} />
            </div>
            <div className="flex flex-col gap-3">
              <Label>Surfaces</Label>
              <Swatches items={SURFACES} />
            </div>
            <div className="flex flex-col gap-3">
              <Label>Text</Label>
              <Swatches items={TEXT} />
            </div>
            <div className="flex flex-col gap-3">
              <Label>Lines</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex h-14 items-center rounded-card border border-hairline px-4 text-[13px] text-body">
                  border-hairline · 12% obsidian
                </div>
                <div className="flex h-14 items-center rounded-card border border-hairline-strong px-4 text-[13px] text-body">
                  border-hairline-strong · 28% obsidian
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Verdict fills (VERDICT_COLORS, for SVG and canvas)</Label>
              <div className="flex flex-wrap gap-3">
                {VERDICTS.map((v) => (
                  <div key={v} className="flex items-center gap-2 rounded-pill border border-hairline py-1 pl-1 pr-3">
                    <span className="size-6 rounded-full" style={{ background: VERDICT_COLORS[v] }} />
                    <span className="font-mono text-[12px] text-body">{VERDICT_COLORS[v]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Type" note="Inter for everything in the app. The display face is for hero and big section openers only.">
          <div id="type" className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <Label>display · Archivo 900 expanded</Label>
              <p className="display text-[64px] text-strong">Find the markets</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Page title · 32px / 700</Label>
              <p className="text-[32px] font-bold tracking-[-0.02em] text-strong">Accidental markets</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Section · 20px / 600</Label>
              <p className="text-[20px] font-semibold text-strong">Local-first app and plugin builders</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Card title · 16px / 600</Label>
              <p className="text-base font-semibold text-strong">Top accounts</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Body · 15px / 400, charcoal</Label>
              <p className="max-w-xl text-[15px] text-body">Sounding found 6 supporting items across 3 sources. Simulated personas, not real people.</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Muted · 13px</Label>
              <p className="text-[13px] text-muted">Updated 4 minutes ago</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>eyebrow utility</Label>
              <Eyebrow>Workspace</Eyebrow>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Mono · IDs, URLs, timestamps, raw scores</Label>
              <p className="font-mono text-[13px] text-body">github.com/Minitour/semlocal · fit 84 · 0:42</p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>link-underline</Label>
              <a href="#type" className="link-underline w-fit text-[15px]">
                Open pipeline
              </a>
            </div>
          </div>
        </Section>

        <Section title="Controls" note="Everything interactive is a pill. Pair a cta with a link, never with a second filled button.">
          <div id="controls" className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Label>Button variants</Label>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="cta">Approve</Button>
                <Button variant="outline">Find similar</Button>
                <Button variant="raised">Full report</Button>
                <Button variant="ghost">Show controls</Button>
                <Button variant="link">Learn more</Button>
                <Button variant="cta" disabled>
                  Disabled
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Sizes · sm 32 · md 36 · lg 48 · icon</Label>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm">
                  Dig deeper
                </Button>
                <Button variant="outline">Dig deeper</Button>
                <Button variant="outline" size="lg">
                  Dig deeper
                </Button>
                <Button variant="cta" size="icon" aria-label="Send">
                  <ArrowUp aria-hidden />
                </Button>
                <Button variant="raised" size="icon" aria-label="Next">
                  <ArrowRight aria-hidden />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>forest on a lime band</Label>
              <div className="flex flex-wrap items-center gap-5 rounded-large bg-lime p-6">
                <Button variant="forest" size="lg">
                  Send Sonar
                </Button>
                <a href="#controls" className="link-underline">
                  How it works
                </a>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Segmented nav</Label>
              <div className="flex flex-wrap items-center gap-6">
                <div className="inline-flex gap-0.5 rounded-pill bg-raised p-1">
                  {["Workspace", "Outreach", "Inbox", "Discovery"].map((l, i) => (
                    <span
                      key={l}
                      className={cn("inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-sm font-semibold", i === 1 ? "bg-lime text-forest" : "text-charcoal")}
                    >
                      {l}
                      {l === "Outreach" ? <span className="rounded-pill bg-forest px-1.5 text-[11px] leading-[18px] text-paper tabular">4</span> : null}
                    </span>
                  ))}
                </div>
                <div className="inline-flex gap-0.5 rounded-pill bg-forest p-1">
                  {["People", "Accounts"].map((l, i) => (
                    <span key={l} className={cn("inline-flex h-8 items-center rounded-pill px-3 text-sm font-semibold", i === 0 ? "bg-lime text-forest" : "text-paper/75")}>
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Input</Label>
              <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-semibold text-strong">Company URL</span>
                  <input
                    placeholder="acme.com"
                    className="rounded-card border border-hairline-strong bg-paper px-4 py-3 text-[15px] text-strong focus:border-forest focus:outline-none"
                  />
                </label>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-semibold text-strong">Chat with Helm</span>
                  <div className="flex items-center gap-2 rounded-pill border border-hairline-strong bg-paper py-1 pl-4 pr-1">
                    <span className="inline-flex h-6 items-center rounded-pill bg-linen px-2 text-[12px] font-semibold text-forest">@Sounding</span>
                    <span className="flex-1 text-[15px] text-pebble">why is this Hype?</span>
                    <Button variant="cta" size="icon" aria-label="Send">
                      <ArrowUp aria-hidden />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Pills</Label>
              <div className="flex flex-wrap gap-2">
                <Pill>Tier A</Pill>
                <Pill tone="lichen">@Wake</Pill>
                <Pill tone="solid">You</Pill>
                <Pill tone="muted" mono>
                  fixture
                </Pill>
                <Pill tone="warning">Small sample</Pill>
                <Pill tone="muted">Simulated</Pill>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Verdicts</Label>
              <div className="flex flex-wrap gap-2">
                {VERDICTS.map((v) => (
                  <VerdictChip key={v} verdict={v} />
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Surfaces" note="Cards are flat: 10px radius and a hairline. Feature cards and dark CTA blocks use 28px.">
          <div id="surfaces" className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Raised</CardTitle>
                <VerdictChip verdict="VERIFIED" />
              </CardHeader>
              <p className="text-[14px]">White card with a hairline border.</p>
            </Card>
            <Card surface="recessed">
              <CardHeader>
                <CardTitle>Recessed</CardTitle>
                <Pill tone="muted">Simulated</Pill>
              </CardHeader>
              <p className="text-[14px]">Fog panel for quiet wells on the white canvas.</p>
            </Card>
            <Card surface="interactive">
              <CardTitle>Interactive</CardTitle>
              <p className="mt-2 text-[14px]">Hover steps to linen.</p>
            </Card>
            <Card surface="forest">
              <CardTitle className="text-paper">Forest</CardTitle>
              <p className="mt-2 text-[14px] text-paper/80">Inverted. Body in paper, emphasis in lime.</p>
            </Card>
          </div>
          <div className="flex flex-col gap-4 rounded-large bg-forest p-10">
            <h3 className="display text-[40px] text-lime sm:text-[56px]">Find who buys</h3>
            <p className="max-w-lg text-paper/80">Dark CTA block: rounded-large, lime headline, paper body, a lime cta.</p>
            <Button variant="cta" size="lg" className="w-fit">
              Start a run
            </Button>
          </div>
          <div className="relative flex h-32 items-center justify-center rounded-card bg-recessed">
            <div className="rounded-card border border-hairline bg-paper px-4 py-3 text-[14px] text-strong shadow-float">shadow-float · popovers, drawers, toasts only</div>
          </div>
        </Section>

        <Section title="Product" note="Patterns from the run shell.">
          <div id="product" className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <Label>Loop stepper · done forest + count, active expands to a lime pill, pending fog</Label>
              <ol className="flex w-fit items-center rounded-card border border-hairline p-3">
                {STEPS.map(({ d, state }, i) => (
                  <li key={d} className="flex items-center">
                    {i > 0 ? <span className={cn("mx-1 h-[2px] w-5 rounded-full", state !== "pending" ? "bg-forest/50" : "bg-hairline")} /> : null}
                    <span className={cn("flex h-8 items-center gap-1.5 rounded-pill", state === "active" ? "bg-lime pl-1 pr-3 text-forest" : state === "done" ? "pr-2" : "")}>
                      <span className={cn("flex size-6 items-center justify-center rounded-full", state === "pending" ? "bg-raised text-muted" : "bg-forest text-lime")}>
                        <DeptGlyph dept={d} size={12} />
                      </span>
                      {state === "active" ? (
                        <span className="text-[13px] font-semibold">
                          {DEPT_LABELS[d]} <span className="text-forest/70 tabular">12</span>
                        </span>
                      ) : state === "done" ? (
                        <span className="text-[12px] font-semibold text-strong tabular">{i === 0 ? 5 : 33}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Run status pill · working, waiting (links to the queue), done</Label>
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill state="SOUNDING_R1" over={false} stream="live" />
                <StatusPill state="OUTREACH_REVIEW" over={false} stream="live" reviewHref="#product" />
                <StatusPill state="DONE" over stream="live" />
                <StatusPill state={null} over={false} stream="connecting" />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Health meters · hover for the explanation card</Label>
              <div className="w-fit">
                <HealthMeters reliability={{ value: 0.7, controlMean: 0.11, warning: false }} calibration={{ globalError: 0.36, perSegment: { a: { n: 1 } } }} />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Handoff · the key moment in the activity timeline</Label>
              <div className="max-w-md rounded-card bg-linen px-3.5 py-3">
                <div className="flex items-center gap-1.5">
                  <DeptChip dept="sounding" />
                  <ArrowRight className="size-3.5 text-forest" aria-hidden />
                  <DeptChip dept="pilot" />
                  <span className="ml-auto text-[11px] font-medium text-muted">2m ago</span>
                </div>
                <p className="mt-2 text-[14px] leading-snug text-strong">Local-first app builders verified (6 evidence, 3 sources). Handing off.</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Fit ring · sparkline · avatar</Label>
              <div className="flex flex-wrap items-center gap-6">
                <FitRing value={84} />
                <FitRing value={61} />
                <FitRing value={38} />
                <span className="rounded-card bg-recessed p-3">
                  <Sparkline values={[0, 0, 1, 2, 2, 4, 5, 5, 7]} width={120} height={28} />
                </span>
                <Avatar name="Smart Connections" />
                <Avatar name="Priya (search infra)" />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Toast / nudge · pill with a round icon (Wise)</Label>
              <div className="flex w-fit items-center gap-3 rounded-pill border border-hairline bg-paper py-2 pl-2 pr-2 shadow-lift">
                <span className="flex size-11 items-center justify-center rounded-full bg-lime text-forest">
                  <DeptGlyph dept="pilot" size={18} />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[15px] font-semibold text-strong">Live run found 18 people</span>
                  <span className="text-[12px] text-muted">Acme · Briefs to review</span>
                </span>
                <Button variant="forest" size="md" className="ml-4">
                  View
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Icon chips · departments</Label>
              <div className="flex flex-wrap gap-3">
                {DEPTS.map((d) => (
                  <span key={d} className="flex size-10 items-center justify-center rounded-full bg-raised text-forest">
                    <DeptGlyph dept={d} size={18} />
                  </span>
                ))}
                <span className="flex size-10 items-center justify-center rounded-full bg-lime text-forest">
                  <Check className="size-[18px]" aria-hidden />
                </span>
              </div>
              <div className="flex flex-wrap gap-6">
                {DEPTS.map((d) => (
                  <DeptLabel key={d} dept={d} />
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>Stats · StatCounter</Label>
              <div className="flex flex-wrap gap-10">
                <StatCounter label="Swarm reliability" value={0.86} decimals={2} size="lg" />
                <StatCounter label="Evidence" value={41} />
                <StatCounter label="Leads" value={12} accent={false} />
                <StatCounter label="Cost" value={0.42} decimals={2} prefix="$" size="sm" />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Label>List rows · hairline dividers, linen hover, linen selected</Label>
              <div className="rounded-card border border-hairline">
                <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-hairline px-4 py-2 text-[12px] font-semibold text-muted">
                  <span>Account</span>
                  <span>Verdict</span>
                  <span className="w-10 text-right">Fit</span>
                </div>
                {[
                  { n: "Northwind Labs", v: "VERIFIED" as Verdict, f: 92, sel: false },
                  { n: "Blue Harbor", v: "PROMISING" as Verdict, f: 81, sel: true },
                  { n: "Oak & Iron", v: "HYPE" as Verdict, f: 54, sel: false },
                ].map((r) => (
                  <div
                    key={r.n}
                    className={cn("grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-hairline px-4 py-2.5 text-[14px] last:border-b-0", r.sel ? "bg-linen" : "hover:bg-linen/50")}
                  >
                    <span className="font-medium text-strong">{r.n}</span>
                    <VerdictChip verdict={r.v} />
                    <span className="w-10 text-right font-mono text-[13px] font-semibold text-forest tabular">{r.f}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
