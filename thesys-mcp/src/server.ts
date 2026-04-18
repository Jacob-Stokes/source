// thesys-mcp — MCP server exposing 5 typed tools over thesys's REST API.
// Runs as a sidecar next to thesys in the same compose stack. Listens on
// port 7001 (HTTP+SSE transport). Internal only (thesys-net) — no public
// route yet.
//
// Boot sequence:
//   1. Resolve THESYS_API_KEY (env var preferred, else Infisical fetch)
//   2. Build ThesysClient with that key
//   3. Register 5 MCP tools (tasks, events, habits, shopping, parse)
//   4. Validate MCP_BEARER_TOKEN is set (required for any client to connect)
//   5. Start HTTP+SSE server

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { fetchSecret } from "./infisical.js";
import { ThesysClient, ThesysError } from "./thesys-client.js";

import { TASKS_TOOL, TasksInput, handleTasks } from "./tools/tasks.js";
import { EVENTS_TOOL, EventsInput, handleEvents } from "./tools/events.js";
import { HABITS_TOOL, HabitsInput, handleHabits } from "./tools/habits.js";
import { SHOPPING_TOOL, ShoppingInput, handleShopping } from "./tools/shopping.js";
import { PARSE_TOOL, ParseInput, handleParse } from "./tools/parse.js";

// ─────────────── Config ───────────────

const PORT = parseInt(process.env.PORT || "7001", 10);
const THESYS_BASE_URL = process.env.THESYS_BASE_URL || "http://thesys:3000/api";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) {
  console.error("FATAL: MCP_BEARER_TOKEN env var required — any client must present this as Authorization: Bearer <token>");
  process.exit(1);
}

// ─────────────── Bootstrap ───────────────

async function resolveThesysApiKey(): Promise<string> {
  if (process.env.THESYS_API_KEY) {
    console.log("thesys api key: from env");
    return process.env.THESYS_API_KEY;
  }
  console.log("thesys api key: fetching from Infisical");
  return await fetchSecret("THESYS_API_KEY");
}

const apiKey = await resolveThesysApiKey();
const client = new ThesysClient(THESYS_BASE_URL, apiKey);

// Sanity check: can we actually reach thesys with this key?
try {
  await client.get("/tasks?status=todo");
  console.log(`thesys connectivity: ok (${THESYS_BASE_URL})`);
} catch (e: any) {
  console.error(`thesys connectivity FAILED at ${THESYS_BASE_URL}:`, e.message);
  process.exit(1);
}

// ─────────────── MCP server ───────────────

const TOOLS = [TASKS_TOOL, EVENTS_TOOL, HABITS_TOOL, SHOPPING_TOOL, PARSE_TOOL] as const;

// Wrap a handler to convert zod-parsed input + catch ThesysError into a clean
// MCP error that the agent can self-correct from.
type Handler = (input: any) => Promise<any>;

const HANDLERS: Record<string, { schema: z.ZodType; handler: Handler }> = {
  thesys_tasks:    { schema: TasksInput,    handler: (i) => handleTasks(client, i) },
  thesys_events:   { schema: EventsInput,   handler: (i) => handleEvents(client, i) },
  thesys_habits:   { schema: HabitsInput,   handler: (i) => handleHabits(client, i) },
  thesys_shopping: { schema: ShoppingInput, handler: (i) => handleShopping(client, i) },
  thesys_parse:    { schema: ParseInput,    handler: (i) => handleParse(client, i) },
};

function buildServer(): Server {
  const server = new Server(
    { name: "thesys-mcp", version: "0.1.0" },
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
      return {
        isError: true,
        content: [{ type: "text", text: `unknown tool: ${name}` }],
      };
    }
    const parsed = h.schema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: "text", text: `invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` },
        ],
      };
    }
    try {
      const result = await h.handler(parsed.data);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      if (e instanceof ThesysError) {
        return {
          isError: true,
          content: [
            { type: "text", text: `thesys API error: ${e.method} ${e.path} → HTTP ${e.status}: ${typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail)}` },
          ],
        };
      }
      return { isError: true, content: [{ type: "text", text: `error: ${e.message ?? String(e)}` }] };
    }
  });

  return server;
}

// Minimal zod → JSON Schema — good enough for the MCP clients we care about.
// Uses zod's built-in introspection. For discriminated unions we emit oneOf.
function zodToJsonSchema(schema: z.ZodType): any {
  // @ts-ignore — traversing the schema without importing the zod-to-json-schema pkg
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
    // Anthropic's tool input_schema format does NOT support oneOf/anyOf/allOf
    // at the top level. We flatten: collect discriminator values into an enum,
    // merge all other properties (marking them optional since they apply to
    // some actions but not others). Runtime zod validation via safeParse on
    // the original discriminated-union schema still enforces correct combos.
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
      description: `Which operation to perform. Other fields are required/optional depending on the value chosen — see tool description.`,
    };
    return {
      type: "object",
      properties: allProperties,
      required: [discriminator],
      additionalProperties: false,
    };
  }
  if (def.typeName === "ZodUnion") {
    // Plain (non-discriminated) unions — also not allowed at top level. Fall
    // back to the first option's shape. Rare in our tools so OK for now.
    return zodToJsonSchema(def.options[0]);
  }
  if (def.typeName === "ZodArray") {
    return { type: "array", items: zodToJsonSchema(def.type) };
  }
  if (def.typeName === "ZodEnum") {
    return { type: "string", enum: def.values };
  }
  if (def.typeName === "ZodLiteral") {
    return { const: def.value };
  }
  if (def.typeName === "ZodString") {
    const s: any = { type: "string" };
    if (def.description) s.description = def.description;
    return s;
  }
  if (def.typeName === "ZodNumber") return { type: "number" };
  if (def.typeName === "ZodBoolean") return { type: "boolean" };
  if (def.typeName === "ZodOptional") {
    return zodToJsonSchema(def.innerType);
  }
  if (def.typeName === "ZodNullable") {
    const inner = zodToJsonSchema(def.innerType);
    return { ...inner, nullable: true };
  }
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

// One Server instance per SSE connection so each client has independent state.
// (The SDK's SSE transport manages the streaming internals; we just plumb the
// /sse + /message endpoints.)

const transports = new Map<string, SSEServerTransport>();

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // Health endpoint — no auth, for docker healthcheck.
  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "thesys-mcp", tools: TOOLS.map((t) => t.name) }));
    return;
  }

  // Everything else requires bearer auth.
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
  console.log(`thesys-mcp listening on 0.0.0.0:${PORT}`);
  console.log(`  tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  console.log(`  health: GET /health (public)`);
  console.log(`  mcp:    GET /sse + POST /message (Bearer auth)`);
});

process.on("SIGINT", () => { httpServer.close(); process.exit(0); });
process.on("SIGTERM", () => { httpServer.close(); process.exit(0); });
