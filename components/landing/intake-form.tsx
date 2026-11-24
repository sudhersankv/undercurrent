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

/** POST /api/runs. A bad intake (4xx) surfaces as an error; a server/network failure falls back to the scripted demo run. */
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
    } else if (res.status >= 400 && res.status < 500) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(`Run failed: ${j.error ?? res.status}`);
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
    "w-full rounded-card border border-hairline-strong bg-paper px-4 text-[15px] text-strong placeholder:text-pebble transition-colors hover:border-forest/60 focus:border-forest focus:outline-none focus-visible:outline-none";
  const label = "text-[13px] font-semibold text-strong";

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-4" aria-describedby={error ? `${id}-err` : undefined}>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-url`} className={label}>
          Company URL <span className="font-normal text-muted">(optional)</span>
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://yourtool.dev"
            value={f.url}
            onChange={set("url")}
            className={cn(field, "h-12 min-w-0 font-mono text-[14px]")}
          />
          <Button type="submit" variant="cta" size="lg" disabled={busy} className="w-full shrink-0 sm:w-auto">
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Send Sonar
            {busy ? null : <ArrowRight aria-hidden />}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          aria-controls={`${id}-more`}
          className="inline-flex h-8 items-center gap-1 rounded-pill text-[14px] font-semibold text-forest underline decoration-[1.5px] underline-offset-4 transition-colors hover:decoration-2"
        >
          Tell us more
          <ChevronDown className={cn("size-4 transition-transform duration-200", more && "rotate-180")} aria-hidden />
        </button>
        <button
          type="button"
          onClick={fillLichen}
          className="inline-flex h-8 items-center gap-2 rounded-pill bg-linen px-3.5 text-[13px] font-semibold text-forest transition-colors hover:bg-raised"
        >
          <span className="size-1.5 rounded-full bg-forest" aria-hidden />
          Try with Lichen
        </button>
      </div>

      {more ? (
        <div id={`${id}-more`} className="grid grid-cols-1 gap-4 border-t border-hairline pt-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <label htmlFor={`${id}-notes`} className={label}>
              What it does
            </label>
            <textarea id={`${id}-notes`} rows={4} value={f.notes} onChange={set("notes")} placeholder="Product, who buys today, how it's priced" className={cn(field, "resize-y py-3 leading-relaxed")} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-users`} className={label}>
              Target users
            </label>
            <input id={`${id}-users`} value={f.targetUsers} onChange={set("targetUsers")} placeholder="Voice-agent teams" className={cn(field, "h-12")} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-pricing`} className={label}>
              Pricing
            </label>
            <input id={`${id}-pricing`} value={f.pricingNotes} onChange={set("pricingNotes")} placeholder="Free tier + usage" className={cn(field, "h-12")} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-customers`} className={label}>
              Known customers
            </label>
            <input id={`${id}-customers`} value={f.knownCustomers} onChange={set("knownCustomers")} placeholder="Comma separated" className={cn(field, "h-12")} />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-avoid`} className={label}>
              Avoid
            </label>
            <input id={`${id}-avoid`} value={f.avoid} onChange={set("avoid")} placeholder="Markets to skip" className={cn(field, "h-12")} />
          </div>
        </div>
      ) : null}

      <p id={`${id}-err`} role="alert" className={cn("-mt-1 min-h-5 text-[13px] font-medium text-danger", !error && "invisible")}>
        {error ?? " "}
      </p>
    </form>
  );
}
