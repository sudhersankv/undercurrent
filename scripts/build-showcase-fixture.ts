/**
 * Build the showcase fixture (fixtures/showcase/lichen.json) from a captured live run.
 *
 *   pnpm tsx scripts/build-showcase-fixture.ts                  # base Recording from the capture, keeps existing extras
 *   pnpm tsx scripts/build-showcase-fixture.ts --with-drafts    # also generate Tide drafts + send + Wake reply, cache under `extras`
 *   pnpm tsx scripts/build-showcase-fixture.ts --src <run.json> # capture path ({ dur, snap, events })
 *
 * --with-drafts runs memory-only (DATABASE_URL unset) and without AgentMail (the send takes the fixture path),
 * but uses the LLM gateway / search keys from .env when present.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import type { EventInput, RunEvent } from "../lib/contracts";
import type { RunData } from "../lib/orchestrator/store";
import type { ShowcaseFixture } from "../lib/demo/showcase";

function loadEnv(): Record<string, string> {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, ".env");
    if (fs.existsSync(f)) {
      config({ path: f, override: true, quiet: true });
      return Object.fromEntries(
        fs
          .readFileSync(f, "utf8")
          .split(/\r?\n/)
          .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
          .filter((m): m is RegExpExecArray => !!m)
          .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
      );
    }
    dir = path.dirname(dir);
  }
  return {};
}

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const DEFAULT_SRC = path.join(process.cwd(), ".claude/worktrees/agent-ae1edfb64d1b22775/.live/run3.json");
const OUT = path.join(process.cwd(), "fixtures/showcase/lichen.json");

const RUN_DATA_KEYS: Array<keyof RunData> = [
  "intake",
  "companyName",
  "profile",
  "segments",
  "personas",
  "reactions",
  "evidence",
  "leads",
  "briefs",
  "drafts",
  "styleProfiles",
  "campaigns",
  "calibration",
  "swarmRounds",
];

const MAX_STR = 4_000;

/** Clip any very long string (raw page content); quotes, URLs and titles are far below this. */
function clipLong<T>(v: T, counter: { n: number }): T {
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") {
      if (x.length <= MAX_STR) return x;
      counter.n++;
      return `${x.slice(0, MAX_STR - 1)}…`;
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, val]) => [k, walk(val)]));
    return x;
  };
  return walk(v) as T;
}

function buildBase(src: string): ShowcaseFixture {
  const raw = JSON.parse(fs.readFileSync(src, "utf8")) as { dur: number; snap: Record<string, unknown>; events: RunEvent[] };
  const snap = raw.snap as unknown as RunData & { runId: string; state: ShowcaseFixture["finalState"]; createdAt: string };
  const sourceRunId = snap.runId;

  const data = Object.fromEntries(RUN_DATA_KEYS.map((k) => [k, (snap as unknown as Record<string, unknown>)[k]])) as unknown as RunData;
  // Pre-Tide capture: no drafts / campaigns yet. Normalize so the shape is exactly RunData.
  data.drafts ??= [];
  data.styleProfiles ??= [];
  data.campaigns ??= [];
  data.calibration ??= null;
  data.swarmRounds ??= [];

  const sorted = [...raw.events].sort((a, b) => a.seq - b.seq);
  const events: EventInput[] = sorted.map((e) => {
    const { id: _id, runId: _r, seq: _s, at: _a, ...rest } = e;
    return rest as EventInput;
  });
  // The capture started at seq 4: restore the run start + first state change so the timeline is whole.
  if (!events.some((e) => e.type === "run.created")) {
    const firstState = sorted.find((e) => e.type === "run.state_changed")?.payload as { from?: string } | undefined;
    const head: EventInput[] = [
      { dept: "helm", type: "run.created", level: "action", message: `Run started for ${data.companyName ?? data.intake.url ?? "your notes"}`, payload: { intake: data.intake, companyName: data.companyName } },
    ];
    if (firstState?.from && firstState.from !== "INTAKE") head.push({ dept: "helm", type: "run.state_changed", level: "action", message: `State: ${firstState.from}`, payload: { from: "INTAKE", to: firstState.from } });
    events.unshift(...head);
  }

  const counter = { n: 0 };
  const fixture: ShowcaseFixture = {
    version: 1,
    company: "lichen",
    recordedAt: snap.createdAt,
    sourceRunId,
    finalState: snap.state,
    events: clipLong(events, counter),
    data: clipLong(data, counter),
  };
  if (counter.n) console.log(`clipped ${counter.n} long strings`);
  return fixture;
}

// ---- email redaction (the repo is public: no real people's addresses in committed fixtures) ----

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const ENCODED_EMAIL_RE = /[A-Za-z0-9._+-]+%40[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/gi;

/** Our own stand-in / sender inboxes: SEND_ALLOWLIST + AGENTMAIL_INBOX_ID (plus the undercurrent-*@agentmail.to naming). */
function ownInboxes(): Set<string> {
  return new Set(
    [...(process.env.SEND_ALLOWLIST ?? "").split(","), process.env.AGENTMAIL_INBOX_ID ?? ""].map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
}
const isOwn = (addr: string, own: Set<string>) => own.has(addr.toLowerCase()) || /^undercurrent-[a-z0-9-]+@agentmail\.to$/i.test(addr);

/** `jane.doe@acme.dev` → `j•••@acme.dev`. Deterministic; the "•••" marks it as masked. */
function maskEmail(addr: string): string {
  const at = addr.lastIndexOf("@");
  return `${addr.slice(0, 1)}•••@${addr.slice(at + 1).toLowerCase()}`;
}

/** Mask every non-own email in every string; objects whose `address` got masked also get `masked: true`. */
function redactEmails<T>(value: T, own: Set<string>, seen: Map<string, number>): T {
  const fix = (s: string) =>
    s
      .replace(EMAIL_RE, (m) => {
        if (isOwn(m, own)) return m;
        seen.set(m, (seen.get(m) ?? 0) + 1);
        return maskEmail(m);
      })
      .replace(ENCODED_EMAIL_RE, (m) => {
        const plain = m.replace(/%40/i, "@");
        if (isOwn(plain, own)) return m;
        seen.set(plain, (seen.get(plain) ?? 0) + 1);
        return encodeURIComponent(maskEmail(plain));
      });
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") return fix(x);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)])) as Record<string, unknown>;
      const orig = (x as Record<string, unknown>).address;
      if (typeof orig === "string" && o.address !== orig) o.masked = true;
      return o;
    }
    return x;
  };
  return walk(value) as T;
}

/** Fail the build if any third-party email is left unmasked (plain or URL-encoded). */
function assertNoThirdPartyEmails(json: string, own: Set<string>) {
  const left = [...(json.match(EMAIL_RE) ?? []), ...(json.match(ENCODED_EMAIL_RE) ?? []).map((m) => m.replace(/%40/i, "@"))].filter((m) => !isOwn(m, own));
  if (left.length) throw new Error(`fixture contains unmasked third-party emails: ${[...new Set(left)].join(", ")}`);
}

/** Refuse to write anything that contains a value from .env (keys, tokens, DB URLs) or obvious secret shapes. */
function assertNoSecrets(json: string, env: Record<string, string>) {
  const allowed = new Set(["SEND_ALLOWLIST", "STANDIN_NAME", "AGENTMAIL_INBOX_ID", "MODEL_SMART", "MODEL_FAST", "APP_URL", "DEMO_SAFE_MODE", "REPLAY_MODE"]);
  const hits: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (allowed.has(k) || v.length < 12) continue;
    if (json.includes(v)) hits.push(k);
  }
  for (const re of [/postgres(ql)?:\/\/[^"\s]+:[^"\s]+@/i, /\bsk-[A-Za-z0-9]{20,}/, /\bnapi_[A-Za-z0-9]{20,}/, /Bearer [A-Za-z0-9._-]{20,}/]) if (re.test(json)) hits.push(re.source);
  if (hits.length) throw new Error(`fixture contains secrets: ${hits.join(", ")}`);
}

async function main() {
  const env = loadEnv();
  const own = ownInboxes(); // before --with-drafts drops AGENTMAIL_INBOX_ID
  // --with-drafts: never write test runs into the production DB; never send through AgentMail from here.
  if (flag("with-drafts")) for (const k of ["DATABASE_URL", "DATABASE_URL_DIRECT", "AGENTMAIL_API_KEY", "AGENTMAIL_INBOX_ID", "TELEGRAM_BOT_TOKEN"]) delete process.env[k];
  const src = arg("src") ?? DEFAULT_SRC;
  const masked = new Map<string, number>();
  const base = redactEmails(buildBase(src), own, masked);

  const prev: ShowcaseFixture | null = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")) as ShowcaseFixture) : null;
  const { slimExtrasData } = await import("../lib/demo/showcase");
  const kept = prev?.extras && prev.sourceRunId === base.sourceRunId ? redactEmails({ ...prev.extras, data: slimExtrasData(prev.extras.data) }, own, masked) : null;
  let fixture: ShowcaseFixture = { ...base, ...(kept ? { extras: kept } : {}) };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fixture), "utf8");

  if (flag("with-drafts")) {
    process.env.SHOWCASE_FIXTURE = OUT;
    const { generateShowcaseExtras } = await import("../lib/demo/showcase");
    const t0 = Date.now();
    const extras = await generateShowcaseExtras();
    console.log(`generated extras (${extras.generatedBy}) in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${extras.data.drafts.length} drafts, ${extras.data.campaigns.length} campaigns, ${extras.outcomes.length} replies, ${extras.events.length} events`);
    fixture = { ...base, extras: redactEmails(extras, own, masked) };
  }

  const json = JSON.stringify(fixture);
  assertNoSecrets(json, env);
  assertNoThirdPartyEmails(json, own);
  console.log(`masked ${masked.size} third-party email addresses (${[...masked.values()].reduce((a, b) => a + b, 0)} occurrences)`);
  fs.writeFileSync(OUT, json, "utf8");
  const d = fixture.data;
  console.log(
    `wrote ${path.relative(process.cwd(), OUT)} (${(json.length / 1024).toFixed(0)} KB): ${fixture.events.length} events, ${d.segments.length} segments, ${d.leads.length} leads, ${d.evidence.length} evidence${fixture.extras ? `, extras: ${fixture.extras.generatedBy}` : ""}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
