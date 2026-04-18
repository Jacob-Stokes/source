// obsidian-mcp — MCP server exposing 4 typed tools over Jacob's custom
// Obsidian HTTP API (via obsidian-landing proxy). Runs as sidecar in
// the obsidian compose stack. Internal port 7002.
//
// Talks to: http://obsidian-landing:3099/api (via OBSIDIAN_API_KEY,
// an ob_... key validated by landing against keys.json).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { fetchSecret } from "./infisical.js";
import { ObsidianClient, ObsidianError } from "./obsidian-client.js";

import { FILES_TOOL, FilesInput, handleFiles } from "./tools/files.js";
import { FOLDERS_TOOL, FoldersInput, handleFolders } from "./tools/folders.js";
import { SEARCH_TOOL, SearchInput, handleSearch } from "./tools/search.js";
import { DAILY_TOOL, DailyInput, handleDaily } from "./tools/daily.js";

// ─────────────── Config ───────────────

const PORT = parseInt(process.env.PORT || "7002", 10);
const OBSIDIAN_BASE_URL = process.env.OBSIDIAN_BASE_URL || "http://obsidian-landing:3099";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) {
  console.error("FATAL: MCP_BEARER_TOKEN env var required — any client must present this as Authorization: Bearer <token>");
  process.exit(1);
}

// ─────────────── Bootstrap ───────────────

async function resolveObsidianApiKey(): Promise<string> {
  if (process.env.OBSIDIAN_API_KEY) {
    console.log("obsidian api key: from env");
    return process.env.OBSIDIAN_API_KEY;
  }
  console.log("obsidian api key: fetching from Infisical");
  return await fetchSecret("OBSIDIAN_API_KEY");
}

const apiKey = await resolveObsidianApiKey();
const client = new ObsidianClient(OBSIDIAN_BASE_URL, apiKey);

// Sanity check: can we reach obsidian-landing with this key?
try {
  await client.get("/api/folders");
  console.log(`obsidian connectivity: ok (${OBSIDIAN_BASE_URL})`);
} catch (e: any) {
  console.error(`obsidian connectivity FAILED at ${OBSIDIAN_BASE_URL}:`, e.message);
  process.exit(1);
}

// ─────────────── MCP server ───────────────

const TOOLS = [FILES_TOOL, FOLDERS_TOOL, SEARCH_TOOL, DAILY_TOOL] as const;

type Handler = (input: any) => Promise<any>;

const HANDLERS: Record<string, { schema: z.ZodType; handler: Handler }> = {
  obsidian_files:   { schema: FilesInput,   handler: (i) => handleFiles(client, i) },
  obsidian_folders: { schema: FoldersInput, handler: (i) => handleFolders(client, i) },
  obsidian_search:  { schema: SearchInput,  handler: (i) => handleSearch(client, i) },
  obsidian_daily:   { schema: DailyInput,   handler: (i) => handleDaily(client, i) },
};

function buildServer(): Server {
  const server = new Server(
    { name: "obsidian-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const h = HANDLERS[name];
    if (!h) {
      return { isError: true, content: [{ type: "text", text: `unknown tool: ${name}` }] };
    }
    const parsed = h.schema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: `invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` }],
      };
    }
    try {
      const result = await h.handler(parsed.data);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      if (e instanceof ObsidianError) {
        return {
          isError: true,
          content: [{ type: "text", text: `obsidian API error: ${e.method} ${e.path} → HTTP ${e.status}: ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}` }],
        };
      }
      return { isError: true, content: [{ type: "text", text: `error: ${e.message ?? String(e)}` }] };
    }
  });

  return server;
}

// Minimal zod → JSON Schema. Flattens discriminated unions (Anthropic's
// tool input_schema format rejects oneOf/anyOf/allOf at the top level).
function zodToJsonSchema(schema: z.ZodType): any {
  const def: any = (schema as any)._def;
  if (def.typeName === "ZodObject") {
    const shape = def.shape();
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToJsonSchema(v as z.ZodType);
      if (!(v as any).isOptional?.() && !isDefaulted(v as z.ZodType)) required.push(k);
    }
    return { type: "object", properties, required, additionalProperties: false };
  }
  if (def.typeName === "ZodDiscriminatedUnion") {
    const discriminator: string = def.discriminator;
    const discriminatorValues: string[] = [];
    const allProperties: Record<string, any> = {};
    for (const opt of def.options as z.ZodObject<any>[]) {
      const shape = ((opt as any)._def.shape)();
      for (const [k, v] of Object.entries(shape)) {
        if (k === discriminator) {
          const litDef = (v as any)._def;
          if (litDef?.typeName === "ZodLiteral") discriminatorValues.push(litDef.value);
          continue;
        }
        if (!(k in allProperties)) {
          allProperties[k] = zodToJsonSchema(v as z.ZodType);
        }
      }
    }
    allProperties[discriminator] = {
      type: "string",
      enum: discriminatorValues,
      description: "Which operation to perform. Other fields are required/optional depending on the value chosen — see tool description.",
    };
    return {
      type: "object",
      properties: allProperties,
      required: [discriminator],
      additionalProperties: false,
    };
  }
  if (def.typeName === "ZodUnion") return zodToJsonSchema(def.options[0]);
  if (def.typeName === "ZodArray") return { type: "array", items: zodToJsonSchema(def.type) };
  if (def.typeName === "ZodEnum") return { type: "string", enum: def.values };
  if (def.typeName === "ZodLiteral") return { const: def.value };
  if (def.typeName === "ZodString") {
    const s: any = { type: "string" };
    if (def.description) s.description = def.description;
    return s;
  }
  if (def.typeName === "ZodNumber") return { type: "number" };
  if (def.typeName === "ZodBoolean") return { type: "boolean" };
  if (def.typeName === "ZodOptional") return zodToJsonSchema(def.innerType);
  if (def.typeName === "ZodNullable") return { ...zodToJsonSchema(def.innerType), nullable: true };
  if (def.typeName === "ZodDefault") {
    const inner = zodToJsonSchema(def.innerType);
    inner.default = def.defaultValue();
    return inner;
  }
  return {};
}
function isDefaulted(v: z.ZodType): boolean {
  return (v as any)._def?.typeName === "ZodDefault" || (v as any)._def?.typeName === "ZodOptional";
}

// ─────────────── HTTP + SSE transport ───────────────

const transports = new Map<string, SSEServerTransport>();

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "obsidian-mcp", tools: TOOLS.map((t) => t.name) }));
    return;
  }

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${MCP_BEARER_TOKEN}`) {
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

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`obsidian-mcp listening on 0.0.0.0:${PORT}`);
  console.log(`  tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  console.log(`  health: GET /health (public)`);
  console.log(`  mcp:    GET /sse + POST /message (Bearer auth)`);
});

process.on("SIGINT", () => { httpServer.close(); process.exit(0); });
process.on("SIGTERM", () => { httpServer.close(); process.exit(0); });
