import { timingSafeEqual } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { compactSnapshot, getRun } from "@/lib/orchestrator";
import { runs } from "@/lib/orchestrator/store";
import { handle } from "./agent";
import { mcpActor, runUrl } from "./session";
import { HELM_TOOLS, getTool, invokeTool } from "./tools";

/**
 * Meta MCP server (Streamable HTTP at /api/mcp). The user's own agents (Claude Code, Claude desktop, …)
 * connect as clients. `ask_undercurrent` talks to the Helm agent in natural language; the typed tools
 * are the same registry the Helm agent uses. Auth: `Authorization: Bearer <token>` from
 * MCP_TOKENS="name:token,name2:token2"; the token's name becomes the actor `agent:mcp:<name>`.
 */

export function mcpTokens(): Array<{ name: string; token: string }> {
  return (process.env.MCP_TOKENS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(":");
      return i > 0 ? { name: pair.slice(0, i).trim(), token: pair.slice(i + 1).trim() } : { name: "default", token: pair };
    })
    .filter((t) => t.token.length > 0);
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Bearer token → client name, or null. */
export function authenticate(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "");
  if (!m) return null;
  const token = m[1].trim();
  for (const t of mcpTokens()) if (safeEq(token, t.token)) return t.name;
  return null;
}

function result(text: string, data: unknown, isError = false): CallToolResult {
  const structured = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : { value: data };
  return { content: [{ type: "text", text }], structuredContent: structured, ...(isError ? { isError: true } : {}) };
}

const ASK_DESCRIPTION =
  "Talk to Undercurrent's Helm agent in plain language: start runs, check status, explore markets/accounts/people, draft, approve, send to the stand-in, read the inbox, or ask a department (@Sonar, @Swarm, @Sounding, @Pilot, @Tide, @Wake). It calls the typed tools for you. Real people are draft-only; email only reaches our stand-in inboxes; nothing is posted to X/LinkedIn.";

export function createMcpServer(client: string): McpServer {
  const actor = mcpActor(client);
  const server = new McpServer(
    { name: "undercurrent", version: "1.0.0" },
    { instructions: "Undercurrent is a GTM department for dev-tool companies. Start with ask_undercurrent, or start_run → run_status → list_markets → list_people → get_lead → draft_outreach. Ids appear in [brackets]. Sending is locked to our own stand-in inboxes." },
  );

  server.registerTool(
    "ask_undercurrent",
    {
      title: "Ask Undercurrent",
      description: ASK_DESCRIPTION,
      inputSchema: { message: z.string().min(1).describe("What you want, in plain language"), runId: z.string().optional().describe("Run to act on; omit for your current run") },
    },
    async (args) => {
      const { message, runId } = args as { message: string; runId?: string };
      const r = await handle({ message, runId, actor });
      const cites = r.citations.length ? `\n\nSources:\n${r.citations.map((c) => `- ${c.title}: ${c.url}`).join("\n")}` : "";
      return result(`${r.text}${cites}`, { runId: r.runId, text: r.text, citations: r.citations, actions: r.actions });
    },
  );

  for (const t of HELM_TOOLS) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.input, annotations: { readOnlyHint: Boolean(t.readOnly), destructiveHint: false, openWorldHint: t.name === "send_to_standin" || t.name === "start_run" } },
      async (args: unknown) => {
        const r = await invokeTool(t.name, args, { actor });
        if (!r.ok) return result(r.error, { error: r.error }, true);
        return result(r.text, { ...(r.data as Record<string, unknown>), ...(r.citations?.length ? { citations: r.citations } : {}) });
      },
    );
  }

  server.registerResource(
    "run",
    new ResourceTemplate("undercurrent://runs/{runId}", {
      list: async () => ({
        resources: [...runs.values()]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 20)
          .map((r) => ({ uri: `undercurrent://runs/${r.runId}`, name: `${r.data.profile?.name ?? r.data.companyName ?? "run"} · ${r.state}`, mimeType: "application/json" })),
      }),
    }),
    { title: "Run snapshot", description: "Compact JSON snapshot of a run: state, company, segments, leads, drafts, calibration.", mimeType: "application/json" },
    async (uri, vars) => {
      const runId = String(vars.runId);
      const rec = await getRun(runId);
      if (!rec) throw new Error(`Run ${runId} not found`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ ...compactSnapshot(rec), webUrl: runUrl(runId) }) }] };
    },
  );

  server.registerResource(
    "lead",
    new ResourceTemplate("undercurrent://runs/{runId}/leads/{leadId}", { list: undefined }),
    { title: "Lead profile", description: "One lead: profile, brief, reach-out channels and drafts.", mimeType: "application/json" },
    async (uri, vars) => {
      const r = await getTool("get_lead")!.run({ leadId: String(vars.leadId), runId: String(vars.runId) }, { actor });
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(r.data) }] };
    },
  );

  return server;
}
