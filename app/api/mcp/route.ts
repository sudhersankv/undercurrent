import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, createMcpServer } from "@/lib/helm-agent/mcp";
import { ensureTelegramPolling } from "@/lib/helm-agent/telegram/poll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Meta MCP server, Streamable HTTP (stateless: one server + transport per request, JSON responses).
 *   claude mcp add --transport http undercurrent https://<app>/api/mcp --header "Authorization: Bearer <token>"
 * See docs/AGENTS-AND-MCP.md.
 */
function unauthorized(): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: send Authorization: Bearer <token> (MCP_TOKENS)" }, id: null },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="undercurrent"' } },
  );
}

async function serve(req: Request): Promise<Response> {
  ensureTelegramPolling();
  const client = authenticate(req.headers.get("authorization"));
  if (!client) return unauthorized();
  const server = createMcpServer(client);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON mode: the response is complete once handleRequest resolves.
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
