import { serve } from "@hono/node-server";
import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";

import { fetchBeszelState } from "./sources/beszel.js";
import { readTunnelRoutes } from "./sources/tunnel.js";
import { fetchAccessApps } from "./sources/access.js";
import { readCatalogHints } from "./sources/catalogs.js";
import { readGlossary, readHosts } from "./sources/glossary.js";
import { buildCatalog, ServiceRecord } from "./join.js";
import { listKeys, createKey, revokeKey, validate } from "./keys.js";

const app = new Hono();

const PORT = parseInt(process.env.PORT || "3000", 10);
const PUBLIC_DIR = process.env.PUBLIC_DIR || "./public";
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS || "60000", 10);
// Email(s) trusted to manage keys via the dashboard. Comma-separated.
// Cloudflare Access stamps the header `Cf-Access-Authenticated-User-Email`
// on every authenticated request — we trust it because cloudflared is the
// only path into this container.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "hello@jacobstokes.com")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

interface CatalogCache {
  services: ServiceRecord[];
  infra: ReturnType<typeof buildCatalog>["infra"];
  builtAt: number;
  error?: string;
}
let cache: CatalogCache | undefined;

async function rebuild(): Promise<CatalogCache> {
  if (cache && Date.now() - cache.builtAt < CACHE_TTL_MS) return cache;
  try {
    const [beszel, accessApps] = await Promise.all([
      fetchBeszelState().catch((e) => {
        console.error("beszel failed:", e.message);
        return { systems: [], containers: [] };
      }),
      fetchAccessApps().catch((e) => {
        console.error("access failed:", e.message);
        return [];
      }),
    ]);
    const tunnel = readTunnelRoutes();
    const hints = readCatalogHints();
    const { services, infra } = buildCatalog(hints, beszel, tunnel, accessApps);
    cache = { services, infra, builtAt: Date.now() };
    return cache;
  } catch (e: any) {
    return (cache = {
      services: cache?.services ?? [],
      infra: cache?.infra ?? { cloudflared_routes: [], hosts: [], access_apps: [] },
      builtAt: Date.now(),
      error: e.message,
    });
  }
}

// ── Auth ──────────────────────────────────────────────────────────
// /api/health is open. Everything else under /api accepts EITHER
//   - a CF Access browser session (header stamped by Cloudflare Access), OR
//   - a valid X-API-Key (programmatic caller).
// /api/keys/* additionally requires CF Access (admin email) — a leaked
// X-API-Key can read but cannot mint or revoke keys.

function browserEmail(c: any): string | undefined {
  const email = (
    c.req.header("cf-access-authenticated-user-email") ||
    c.req.header("Cf-Access-Authenticated-User-Email") ||
    ""
  ).toLowerCase();
  return email || undefined;
}

function isAdminBrowser(c: any): boolean {
  const e = browserEmail(c);
  return !!e && ADMIN_EMAILS.includes(e);
}

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next();

  // Key management: admin browser only.
  if (c.req.path.startsWith("/api/keys")) {
    if (!isAdminBrowser(c)) {
      return c.json({ error: "key management requires admin browser session" }, 401);
    }
    return next();
  }

  // Other /api/*: admin browser OR valid X-API-Key.
  if (isAdminBrowser(c)) return next();
  const presented = c.req.header("x-api-key") || c.req.query("apiKey") || "";
  const result = validate(presented);
  if (!result.ok) return c.json({ error: "Invalid or missing API key" }, 401);
  await next();
});

// ── Read endpoints ─────────────────────────────────────────────────

app.get("/api/health", (c) => c.json({ status: "ok", service: "catalog" }));

app.get("/api/services", async (c) => {
  const { services, builtAt, error } = await rebuild();
  const host = c.req.query("host");
  const category = c.req.query("category");
  const includeInternal = c.req.query("internal") === "true";
  let list = services;
  if (!includeInternal) list = list.filter((s) => !s.internal);
  if (host) list = list.filter((s) => s.host === host);
  if (category) list = list.filter((s) => s.category === category);
  return c.json({
    count: list.length,
    builtAt: new Date(builtAt).toISOString(),
    error,
    services: list,
  });
});

app.get("/api/services/:name", async (c) => {
  const { services } = await rebuild();
  const s = services.find((x) => x.name === c.req.param("name"));
  if (!s) return c.json({ error: "not found" }, 404);
  return c.json(s);
});

app.get("/api/by-url/:hostname", async (c) => {
  const { services } = await rebuild();
  const hostname = c.req.param("hostname");
  const s = services.find((x) => x.hostnames.includes(hostname));
  if (!s) return c.json({ error: "no service at that hostname" }, 404);
  return c.json(s);
});

app.get("/api/infrastructure", async (c) => {
  const { infra, builtAt } = await rebuild();
  // Merge host descriptions from hosts.yml into each host record.
  const hostsHints = readHosts().hosts ?? {};
  const hosts = infra.hosts.map((h) => ({
    ...h,
    description: hostsHints[h.name]?.description,
  }));
  return c.json({ builtAt: new Date(builtAt).toISOString(), ...infra, hosts });
});

// Glossary: the "where does X live" routing map. Agents should hit this
// BEFORE picking a service to query for a user question.
app.get("/api/glossary", async (_c) => {
  const glossary = readGlossary();
  const hostsHints = readHosts().hosts ?? {};
  return _c.json({
    routing: glossary.routing ?? {},
    hosts: hostsHints,
  });
});

// ── Key management (admin browser only) ────────────────────────────

app.get("/api/keys", (c) => c.json({ keys: listKeys() }));

app.post("/api/keys", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = (body?.name ?? "").toString().trim();
  if (!name) return c.json({ error: "name is required" }, 400);
  const result = createKey(name);
  return c.json({
    id: result.id,
    name: result.name,
    key: result.key,
    note: "This is the only time the key is shown. Store it now.",
  }, 201);
});

app.delete("/api/keys/:id", (c) => {
  const ok = revokeKey(c.req.param("id"));
  if (!ok) return c.json({ error: "key not found" }, 404);
  return c.json({ revoked: true });
});

// ── Dashboard ──────────────────────────────────────────────────────

app.get("/", (c) => {
  const indexPath = path.join(PUBLIC_DIR, "index.html");
  if (!fs.existsSync(indexPath)) {
    return c.html("<h1>catalog</h1><p>public/index.html not found</p>");
  }
  return c.html(fs.readFileSync(indexPath, "utf-8"));
});

console.log(`catalog listening on :${PORT}, cache TTL ${CACHE_TTL_MS}ms, admin emails: ${ADMIN_EMAILS.join(", ")}`);
serve({ fetch: app.fetch, port: PORT });
