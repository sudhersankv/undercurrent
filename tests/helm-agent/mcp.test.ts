import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { departments } from "@/lib/departments/shared";
import { setCallStructuredOverride } from "@/lib/llm";
import { stubDepartments } from "@/lib/orchestrator/test-stubs";
import { setHelmAgentModel, TOOL_NAMES, waitForRun } from "@/lib/helm-agent";
import { authenticate, mcpTokens } from "@/lib/helm-agent/mcp";
import { POST } from "@/app/api/mcp/route";

// The real MCP SDK client talks to the route handler in-process (fetch → POST()).
const realDepartments = { ...departments };
const prevTokens = process.env.MCP_TOKENS;
const prevReplay = process.env.REPLAY_MODE;
const URL_ = "http://localhost/api/mcp";

const inProcessFetch = (async (input: string | URL | Request, init?: RequestInit) => POST(new Request(input, init))) as typeof fetch;

function client(token?: string) {
  const transport = new StreamableHTTPClientTransport(new URL(URL_), {
    fetch: inProcessFetch,
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  const c = new Client({ name: "vitest", version: "0.0.0" });
  return { c, transport };
}

const rpc = (headers: Record<string, string>) =>
  POST(
    new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );

beforeAll(() => {
  process.env.MCP_TOKENS = "claude-code:tok-abc123, desktop:tok-xyz789";
  process.env.REPLAY_MODE = "off";
  Object.assign(departments, stubDepartments);
  setCallStructuredOverride(async () => {
    throw new Error("LLM offline (test)");
  });
  setHelmAgentModel("offline");
});

afterAll(() => {
  if (prevTokens === undefined) delete process.env.MCP_TOKENS;
  else process.env.MCP_TOKENS = prevTokens;
  if (prevReplay === undefined) delete process.env.REPLAY_MODE;
  else process.env.REPLAY_MODE = prevReplay;
  Object.assign(departments, realDepartments);
  setCallStructuredOverride(null);
  setHelmAgentModel(null);
});

describe("meta MCP server /api/mcp", () => {
  it("parses MCP_TOKENS and authenticates bearer tokens", () => {
    expect(mcpTokens().map((t) => t.name)).toEqual(["claude-code", "desktop"]);
    expect(authenticate("Bearer tok-abc123")).toBe("claude-code");
    expect(authenticate("bearer tok-xyz789")).toBe("desktop");
    expect(authenticate("Bearer nope")).toBeNull();
    expect(authenticate(null)).toBeNull();
    expect(authenticate("tok-abc123")).toBeNull();
  });

  it("rejects missing and bad tokens with 401", async () => {
    const missing = await rpc({});
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toMatch(/Bearer/);
    expect((await rpc({ Authorization: "Bearer wrong" })).status).toBe(401);
    expect((await rpc({ Authorization: "Basic dG9rLWFiYzEyMw==" })).status).toBe(401);

    const { c, transport } = client("wrong");
    await expect(c.connect(transport)).rejects.toThrow();
  });

  it("lists ask_undercurrent plus every typed tool, and the resource templates", async () => {
    const { c, transport } = client("tok-abc123");
    await c.connect(transport);
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("ask_undercurrent");
    for (const n of TOOL_NAMES) expect(names).toContain(n);
    const send = tools.find((t) => t.name === "send_to_standin")!;
    expect(send.description).toMatch(/stand-in/);
    expect(send.inputSchema.required).toContain("draftId");
    expect(tools.find((t) => t.name === "list_markets")?.annotations?.readOnlyHint).toBe(true);
    const { resourceTemplates } = await c.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.uriTemplate)).toEqual(expect.arrayContaining(["undercurrent://runs/{runId}", "undercurrent://runs/{runId}/leads/{leadId}"]));
    await c.close();
  });

  it("ask_undercurrent starts a run; run_status and resources return structured content", async () => {
    const { c, transport } = client("tok-abc123");
    await c.connect(transport);
    const started = await c.callTool({ name: "ask_undercurrent", arguments: { message: "start a run for lichen" } });
    const sc = started.structuredContent as { runId: string; actions: Array<{ tool: string }> };
    expect(sc.actions[0].tool).toBe("start_run");
    expect(sc.runId).toBeTruthy();
    await waitForRun(sc.runId);

    const status = await c.callTool({ name: "run_status", arguments: { runId: sc.runId } });
    expect(status.isError).toBeFalsy();
    expect((status.structuredContent as { state: string }).state).toBe("BRIEF_REVIEW");
    expect((status.content as Array<{ text: string }>)[0].text).toContain("BRIEF_REVIEW");

    const snap = await c.readResource({ uri: `undercurrent://runs/${sc.runId}` });
    expect(JSON.parse((snap.contents[0] as { text: string }).text).state).toBe("BRIEF_REVIEW");
    const lead = await c.readResource({ uri: `undercurrent://runs/${sc.runId}/leads/${sc.runId}-lead-semlocal` });
    expect(JSON.parse((lead.contents[0] as { text: string }).text).lead.displayName).toBeTruthy();

    const bad = await c.callTool({ name: "send_to_standin", arguments: { draftId: "missing" } });
    expect(bad.isError).toBe(true);
    await c.close();
  });
});
