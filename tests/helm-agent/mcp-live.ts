/**
 * Live smoke check of the meta MCP server with the real SDK client (not part of `pnpm test`).
 *   pnpm dev -p 3400   # in another terminal
 *   pnpm tsx tests/helm-agent/mcp-live.ts [http://localhost:3400/api/mcp]
 * Uses the first token in MCP_TOKENS from .env. Lists tools, asks to start a Lichen run, then polls run_status.
 */
import { config } from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

config({ path: ".env", override: true, quiet: true });

const url = process.argv[2] ?? `${(process.env.APP_URL ?? "http://localhost:3400").replace(/\/$/, "")}/api/mcp`;
const first = (process.env.MCP_TOKENS ?? "").split(",")[0]?.trim() ?? "";
const token = first.includes(":") ? first.slice(first.indexOf(":") + 1) : first;
if (!token) throw new Error("Set MCP_TOKENS=name:token in .env");

const text = (r: unknown) => (((r as { content?: Array<{ type: string; text?: string }> }).content) ?? []).map((c) => c.text ?? "").join("\n");

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: "undercurrent-live-check", version: "0.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);

  const t0 = Date.now();
  const ask = await client.callTool({ name: "ask_undercurrent", arguments: { message: "start a run for lichen" } });
  const sc = ask.structuredContent as { runId: string | null; actions: Array<{ tool: string; ok: boolean }> };
  console.log(`\nask_undercurrent (${Date.now() - t0} ms) actions=${JSON.stringify(sc.actions.map((a) => `${a.tool}:${a.ok}`))} runId=${sc.runId}\n${text(ask)}`);
  if (!sc.runId) throw new Error("no runId");

  const polls = Number(process.env.LIVE_POLLS ?? 4);
  for (let i = 0; i < polls; i++) {
    const st = await client.callTool({ name: "run_status", arguments: { runId: sc.runId } });
    console.log(`\nrun_status #${i + 1}: ${text(st).split("\n").slice(0, 2).join(" | ")}`);
    if (i < polls - 1) await new Promise((r) => setTimeout(r, 15_000));
  }
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
