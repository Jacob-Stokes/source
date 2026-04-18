// HTTP+SSE transport for MCP servers. Wraps the @modelcontextprotocol/sdk
// server with:
//   - Bearer-token auth for clients
//   - A public /health endpoint (for docker + catalog pings)
//   - Per-session transport management (one Server instance per SSE client)
//   - Graceful shutdown on SIGINT/SIGTERM
//
// Each MCP calls `startMcp(opts)` at the end of its own server.ts boot.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { zodToJsonSchema } from "./schema.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}

export interface ToolRegistration {
  /** Advertised metadata: name, description, inputSchema (zod). */
  def: ToolDefinition;
  /** Called after zod validates input successfully. Return a JSON-serializable result. */
  handler: (input: any) => Promise<any>;
}

export interface StartMcpOptions {
  /** Appears in MCP protocol handshake + /health response. */
  name: string;
  /** Semver-ish. Optional, defaults to 0.1.0. */
  version?: string;
  /** Port to listen on — 0.0.0.0 bind. */
  port: number;
  /** Required bearer token for all non-/health endpoints. */
  bearerToken: string;
  /** Tools advertised to clients + dispatched on callTool. */
  tools: ToolRegistration[];
  /**
   * Optional backend-error formatter. If your backend client throws a
   * typed error class (e.g. ThesysError, ObsidianError), pass a function
   * here that formats it into a clean isError response for the agent.
   * Return null to fall through to the default "error: <msg>" shape.
   */
  onBackendError?: (e: unknown) => string | null;
}

export async function startMcp(opts: StartMcpOptions): Promise<void> {
  const { name, version = "0.1.0", port, bearerToken, tools, onBackendError } = opts;

  if (!bearerToken) throw new Error(`startMcp: bearerToken required for '${name}'`);

  const toolsByName: Record<string, ToolRegistration> = {};
  for (const t of tools) toolsByName[t.def.name] = t;

  const transports = new Map<string, SSEServerTransport>();

  const buildServer = (): Server => {
    const server = new Server({ name, version }, { capabilities: { tools: {} } });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({
        name: t.def.name,
        description: t.def.description,
        inputSchema: zodToJsonSchema(t.def.inputSchema),
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const { name: toolName, arguments: args } = req.params;
      const reg = toolsByName[toolName];
      if (!reg) {
        return { isError: true, content: [{ type: "text", text: `unknown tool: ${toolName}` }] };
      }
      const parsed = reg.def.inputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `invalid input for ${toolName}: ${parsed.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; ")}`,
            },
          ],
        };
      }
      try {
        const result = await reg.handler(parsed.data);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        const custom = onBackendError?.(e);
        if (custom) return { isError: true, content: [{ type: "text", text: custom }] };
        return { isError: true, content: [{ type: "text", text: `error: ${e.message ?? String(e)}` }] };
      }
    });

    return server;
  };

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (url.pathname === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: name, tools: tools.map((t) => t.def.name) }));
      return;
    }

    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${bearerToken}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Authorization: Bearer <MCP_BEARER_TOKEN> required" }));
      return;
    }

    if (url.pathname === "/sse" && req.method === "GET") {
      const transport = new SSEServerTransport("/message", res);
      transports.set(transport.sessionId, transport);
      req.on("close", () => transports.delete(transport.sessionId));
      const server = buildServer();
      await server.connect(transport);
      return;
    }

    if (url.pathname === "/message" && req.method === "POST") {
      const sid = url.searchParams.get("sessionId");
      const transport = sid ? transports.get(sid) : undefined;
      if (!transport) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unknown sessionId" }));
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, "0.0.0.0", () => {
      console.log(`${name} listening on 0.0.0.0:${port}`);
      console.log(`  tools: ${tools.map((t) => t.def.name).join(", ")}`);
      console.log(`  health: GET /health (public)`);
      console.log(`  mcp:    GET /sse + POST /message (Bearer auth)`);
      resolve();
    });
  });

  const shutdown = () => {
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
