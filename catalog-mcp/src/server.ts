// catalog-mcp — MCP server exposing 3 typed tools over the homelab catalog
// service's REST API. Runs as sidecar in the catalog compose stack. Internal
// port 7003 (thesys-mcp=7001, obsidian-mcp=7002).
//
// Talks to: http://catalog:3000/api (with X-API-Key: $CATALOG_API_KEY).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { fetchSecret } from "./infisical.js";
import { CatalogClient, CatalogError } from "./catalog-client.js";

import { SERVICES_TOOL, ServicesInput, handleServices } from "./tools/services.js";
import { GLOSSARY_TOOL, GlossaryInput, handleGlossary } from "./tools/glossary.js";
import { INFRASTRUCTURE_TOOL, InfrastructureInput, handleInfrastructure } from "./tools/infrastructure.js";

// ─────────────── Config ───────────────

const PORT = parseInt(process.env.PORT || "7003", 10);
const CATALOG_BASE_URL = process.env.CATALOG_BASE_URL || "http://catalog:3000";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) {
  console.error("FATAL: MCP_BEARER_TOKEN env var required");
  process.exit(1);
}

// ─────────────── Bootstrap ───────────────

async function resolveCatalogApiKey(): Promise<string> {
  if (process.env.CATALOG_API_KEY) {
    console.log("catalog api key: from env");
    return process.env.CATALOG_API_KEY;
  }
  console.log("catalog api key: fetching from Infisical");
  return await fetchSecret("CATALOG_API_KEY");
}

const apiKey = await resolveCatalogApiKey();
const client = new CatalogClient(CATALOG_BASE_URL, apiKey);

try {
  const health = await client.get("/api/health");
  console.log(`catalog connectivity: ok (${CATALOG_BASE_URL}) — service=${health?.service}`);
} catch (e: any) {
  console.error(`catalog connectivity FAILED at ${CATALOG_BASE_URL}:`, e.message);
  process.exit(1);
}

// ─────────────── MCP server ───────────────

const TOOLS = [SERVICES_TOOL, GLOSSARY_TOOL, INFRASTRUCTURE_TOOL] as const;

type Handler = (input: any) => Promise<any>;

const HANDLERS: Record<string, { schema: z.ZodType; handler: Handler }> = {
  catalog_services:       { schema: ServicesInput,       handler: (i) => handleServices(client, i) },
  catalog_glossary:       { schema: GlossaryInput,       handler: (i) => handleGlossary(client, i) },
  catalog_infrastructure: { schema: InfrastructureInput, handler: (i) => handleInfrastructure(client, i) },
};

function buildServer(): Server {
  const server = new Server(
    { name: "catalog-mcp", version: "0.1.0" },
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
      if (e instanceof CatalogError) {
        return {
          isError: true,
          content: [{ type: "text", text: `catalog API error: ${e.method} ${e.path} → HTTP ${e.status}: ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}` }],
        };
      }
      return { isError: true, content: [{ type: "text", text: `error: ${e.message ?? String(e)}` }] };
    }
  });

  return server;
}

// zod → JSON Schema. Flattens discriminated unions (Anthropic rejects
// oneOf/anyOf/allOf at the top level of tool input_schema).
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
    res.end(JSON.stringify({ ok: true, service: "catalog-mcp", tools: TOOLS.map((t) => t.name) }));
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
  console.log(`catalog-mcp listening on 0.0.0.0:${PORT}`);
  console.log(`  tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  console.log(`  health: GET /health (public)`);
  console.log(`  mcp:    GET /sse + POST /message (Bearer auth)`);
});

process.on("SIGINT", () => { httpServer.close(); process.exit(0); });
process.on("SIGTERM", () => { httpServer.close(); process.exit(0); });
