/**
 * Seed real, evidence-backed Lichen targets.
 *
 *   npx tsx scripts/seed-targets.ts                     # rebuild fixtures/lichen/seed/targets.json live
 *   npx tsx scripts/seed-targets.ts --segments voice,ext # only some segments (merged into the existing file)
 *   npx tsx scripts/seed-targets.ts --import <runId>    # insert targets.json into a run (Neon + in-process snapshot)
 *   npx tsx scripts/seed-targets.ts --stats             # print counts + spot-check 5 URLs
 *   (--runId <id> is accepted as an alias of --import)
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

// The user's shell has stale gateway vars: the repo .env wins. Worktrees: walk up to find it.
function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, ".env");
    if (fs.existsSync(f)) {
      config({ path: f, override: true, quiet: true });
      return f;
    }
    dir = path.dirname(dir);
  }
  return null;
}

(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const OUT = path.join(process.cwd(), "fixtures/lichen/seed/targets.json");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function stats(targets: import("../lib/seed/types").SeedTarget[]) {
  const { urlStatus } = await import("../lib/seed/sources");
  const by = (f: (t: (typeof targets)[number]) => string) =>
    targets.reduce<Record<string, number>>((m, t) => ((m[f(t)] = (m[f(t)] ?? 0) + 1), m), {});
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(targets.length, 1))}%`;
  const hasX = targets.filter((t) => t.lead.xProfile || t.lead.account?.contacts.some((c) => c.xProfile)).length;
  const hasLi = targets.filter((t) => t.lead.linkedinUrl || t.lead.account?.contacts.some((c) => c.linkedinUrl)).length;
  console.log(`\ntargets: ${targets.length}`);
  console.log("by kind:", by((t) => t.kind));
  console.log("by segment:", by((t) => t.segmentName));
  console.log("by size (accounts):", by((t) => (t.kind === "account" ? t.lead.account!.sizeBand : "person")));
  console.log(`with X handle: ${hasX} (${pct(hasX)}), with LinkedIn: ${hasLi} (${pct(hasLi)})`);
  console.log(`evidence items: ${targets.reduce((n, t) => n + t.evidence.length, 0)}`);
  const urls = [...new Set(targets.flatMap((t) => t.evidence.map((e) => e.url)))].filter((u) => !u.includes("linkedin.com"));
  const sample = urls.sort(() => Math.random() - 0.5).slice(0, 5);
  console.log("spot-check:");
  for (const u of sample) console.log(`  ${await urlStatus(u)} ${u}`);
}

async function main() {
  const envFile = loadEnv();
  console.log(`[seed] env: ${envFile ?? "none"}`);
  const importRun = arg("import") ?? arg("runId");

  if (importRun) {
    const targets = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const { importTargets } = await import("../lib/seed/import");
    const res = await importTargets(importRun, targets);
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (process.argv.includes("--resize")) {
    // Recompute account size bands in the existing file (LinkedIn company page → web headcount → GitHub org members).
    const targets = JSON.parse(fs.readFileSync(OUT, "utf8")) as import("../lib/seed/types").SeedTarget[];
    const { accountSize } = await import("../lib/seed/build");
    for (const t of targets) {
      const a = t.lead.account;
      if (!a) continue;
      const members = Number(a.sizeSource.match(/\((\d+) public members\)/)?.[1] ?? 0);
      const s = await accountSize(a.name, a.domain, t.lead.handles.github ?? a.name, members);
      console.log(`${a.name}: ${a.sizeBand} → ${s.band} (${s.source})`);
      a.sizeBand = s.band;
      a.sizeSource = s.source;
    }
    fs.writeFileSync(OUT, JSON.stringify(targets, null, 2) + "\n");
    await stats(targets);
    return;
  }

  if (process.argv.includes("--stats")) {
    await stats(JSON.parse(fs.readFileSync(OUT, "utf8")));
    return;
  }

  const { buildTargets } = await import("../lib/seed/build");
  const { SeedTarget } = await import("../lib/seed/types");
  const segments = arg("segments")?.split(",");
  const t0 = Date.now();
  const built = await buildTargets({ segments });
  const valid = built.filter((t) => {
    const r = SeedTarget.safeParse(t);
    if (!r.success) console.warn("[seed] invalid target dropped", t.lead.id, r.error.issues[0]);
    return r.success;
  });
  let out = valid;
  if (segments?.length && fs.existsSync(OUT)) {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8")) as typeof valid;
    out = [...prev.filter((t) => !segments.includes(t.segmentKey)), ...valid];
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`[seed] wrote ${out.length} targets → ${OUT} in ${Math.round((Date.now() - t0) / 1000)}s`);
  await stats(out);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
