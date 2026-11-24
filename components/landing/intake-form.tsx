"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { LICHEN_INTAKE, type DisplayAlias, type IntakeInput } from "@/lib/contracts";
import { cn } from "@/lib/utils";

interface Fields {
  url: string;
  notes: string;
  targetUsers: string;
  pricingNotes: string;
  knownCustomers: string;
  avoid: string;
}

const EMPTY: Fields = { url: "", notes: "", targetUsers: "", pricingNotes: "", knownCustomers: "", avoid: "" };

function list(s: string): string[] | undefined {
  const out = s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
}

/** undefined = empty, null = invalid. */
function normalizeUrl(raw: string): string | null | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withScheme).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** POST /api/runs; falls back to the dev fake run while the orchestrator isn't merged. */
async function createRun(intake: IntakeInput): Promise<string> {
  try {
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intake),
    });
    if (res.ok) {
      const j = (await res.json()) as { runId?: string; id?: string };
      const id = j.runId ?? j.id;
      if (id) return id;
    } else if (res.status !== 404 && res.status !== 405) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `Run failed (${res.status})`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Run failed")) throw e;
  }
  const res = await fetch("/api/dev/fake-run?speed=1", { method: "POST" });
  if (!res.ok) throw new Error("Couldn't start a run");
  const j = (await res.json()) as { runId: string };
  return j.runId;
}

export function IntakeForm() {
  const router = useRouter();
  const id = useId();
  const [f, setF] = useState<Fields>(EMPTY);
  const [more, setMore] = useState(false);
  const [alias, setAlias] = useState<DisplayAlias | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF((p) => ({ ...p, [k]: e.target.value }));
    if (error) setError(null);
  };

  const fillLichen = () => {
    setF({ ...EMPTY, url: LICHEN_INTAKE.url ?? "", notes: LICHEN_INTAKE.notes ?? "" });
    setAlias(LICHEN_INTAKE.displayAlias);
    setMore(true);
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = normalizeUrl(f.url);
    if (url === null) return setError("That URL doesn't parse.");
    if (!url && !f.notes.trim()) return setError("Add a URL or a few notes.");
    const intake: IntakeInput = {
      url,
      notes: f.notes.trim() || undefined,
      targetUsers: f.targetUsers.trim() || undefined,
      pricingNotes: f.pricingNotes.trim() || undefined,
      knownCustomers: list(f.knownCustomers),
      avoid: list(f.avoid),
      displayAlias: alias,
    };
    setBusy(true);
    try {
      const runId = await createRun(intake);
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a run");
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-control border border-hairline-strong bg-recessed px-3 text-[14px] text-strong placeholder:text-muted transition-colors hover:border-[rgba(244,250,245,0.24)] focus-visible:border-lichen focus-visible:outline-none";

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-[520px] flex-col gap-3" aria-describedby={error ? `${id}-err` : undefined}>
      <label htmlFor={`${id}-url`} className="eyebrow">
        Company URL <span className="normal-case tracking-normal text-muted/70">optional</span>
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://yourtool.dev"
          value={f.url}
          onChange={set("url")}
          className={cn(field, "h-11 font-mono text-[13px]")}
        />
        <Button type="submit" variant="cta" size="lg" disabled={busy} className="h-11 shrink-0 sm:w-auto">
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          Send Sonar
          {busy ? null : <ArrowRight aria-hidden />}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          aria-controls={`${id}-more`}
          className="inline-flex h-7 items-center gap-1 rounded-control text-[13px] text-body transition-colors hover:text-strong"
        >
          Tell us more
          <ChevronDown className={cn("size-4 transition-transform duration-200", more && "rotate-180")} aria-hidden />
        </button>
        <button
          type="button"
          onClick={fillLichen}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-lichen/35 px-3 text-[12px] font-medium text-lichen transition-colors hover:border-lichen/70 hover:bg-lichen/10"
        >
          <span className="size-1.5 rounded-full bg-lichen" aria-hidden />
          Try with Lichen
        </button>
      </div>

      {more ? (
        <div id={`${id}-more`} className="mt-1 grid grid-cols-1 gap-3 rounded-card border border-hairline bg-raised/60 p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor={`${id}-notes`} className="eyebrow">
              What it does
            </label>
            <textarea id={`${id}-notes`} rows={4} value={f.notes} onChange={set("notes")} placeholder="Product, who buys today, how it's priced" className={cn(field, "resize-y py-2 leading-relaxed")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-users`} className="eyebrow">
              Target users
            </label>
            <input id={`${id}-users`} value={f.targetUsers} onChange={set("targetUsers")} placeholder="Voice-agent teams" className={cn(field, "h-9")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-pricing`} className="eyebrow">
              Pricing
            </label>
            <input id={`${id}-pricing`} value={f.pricingNotes} onChange={set("pricingNotes")} placeholder="Free tier + usage" className={cn(field, "h-9")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-customers`} className="eyebrow">
              Known customers
            </label>
            <input id={`${id}-customers`} value={f.knownCustomers} onChange={set("knownCustomers")} placeholder="Comma separated" className={cn(field, "h-9")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-avoid`} className="eyebrow">
              Avoid
            </label>
            <input id={`${id}-avoid`} value={f.avoid} onChange={set("avoid")} placeholder="Markets to skip" className={cn(field, "h-9")} />
          </div>
        </div>
      ) : null}

      <p id={`${id}-err`} role="alert" className={cn("min-h-5 text-[13px] text-danger", !error && "invisible")}>
        {error ?? " "}
      </p>
    </form>
  );
}
