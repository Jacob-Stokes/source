// Reads per-service catalog.yml files from <SERVICES_ROOT>/<name>/catalog.yml
// SERVICES_ROOT can be a single path OR a colon-separated list of paths
// (Unix PATH style) to support multi-host setups — e.g.
//   SERVICES_ROOT=/services-resolution:/services-adventure
// Each scanned root contributes its services. The catalog.yml's `host:`
// field declares which physical host owns each service.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const SERVICES_ROOT = process.env.SERVICES_ROOT || "/services";

// Auth hint for agent callers. If present, agents reading the catalog know
// how to construct a working request against this service without hardcoding
// per-service recipes in their skill docs.
export interface AuthHint {
  // The auth shape this service expects.
  //   x-api-key  → header: X-API-Key: <secret>       (default header; override with `header`)
  //   bearer     → Authorization: Bearer <secret>
  //   jwt-login  → POST username+password to `login_path`, get JWT, then Authorization: Bearer <jwt>
  //   greader    → two-step: ClientLogin → SID → Authorization: GoogleLogin auth=<SID>
  //   none       → open, no auth needed
  type: "x-api-key" | "bearer" | "jwt-login" | "greader" | "none";
  // For x-api-key only — default is "X-API-Key". Override if the service uses a different header name.
  header?: string;
  // Infisical secret names. Fields used depend on `type`:
  //   x-api-key / bearer: `key`
  //   jwt-login:          `username`, `password`  (both are Infisical keys holding the cred values)
  //   greader:            `user` (a LITERAL login, not a secret ref) + `token` (Infisical key)
  secret?: {
    key?: string;         // Infisical key name holding the API key / bearer token
    username?: string;    // Infisical key name holding the login username (for jwt-login)
    password?: string;    // Infisical key name holding the login password (for jwt-login)
    user?: string;        // LITERAL user login (greader) — e.g. "jacob-admin"
    token?: string;       // Infisical key holding the greader API password
  };
  // For jwt-login: the path to POST credentials to.
  login_path?: string;
  // For jwt-login: JSON pointer into the response body where the token lives (default: "/accessToken").
  token_path?: string;
}

// URL overrides — by default we derive `internal` from container+port and
// `public` from hostnames. Set these to override (e.g. when a service is
// fronted by a sibling proxy like obsidian-landing).
export interface UrlsHint {
  internal?: string;       // container-local base, e.g. "http://obsidian-landing:3099"
  api_base_path?: string;  // appended to internal + public, e.g. "/api/v1"
  // `public` is always derived from hostnames[0], not overridable.
}

export interface ServiceCatalogFile {
  service: string;               // derived from directory name
  description?: string;
  category?: string;
  // Coarse kind of service — lets the UI filter "apps" vs "agents".
  // Defaults to "app" if unset. Use "agent" for AI bots + agent-runners.
  type?: "app" | "agent";
  docs_url?: string;
  tags?: string[];
  infisical_secrets?: string[];
  hostnames?: string[];          // only if you want to override the auto-derived mapping
  containers?: string[];         // hint for which container names belong to this service
  host?: string;                 // override if the service runs on a specific host (default: resolution)
  internal?: boolean;            // hide from default listing
  auth?: AuthHint;               // how agents should authenticate to this service
  urls?: UrlsHint;               // url derivation overrides
  // icon: defaults to service name (e.g. "grimmory" → icons.jacob.st/grimmory).
  // Override with a string for non-standard names (e.g. "obsidian-landing" → icon: obsidian).
  // Set to false to suppress (no icon_url in record).
  icon?: string | false;
  // populated post-read by the scanner — absolute compose-dir path
  _absDir?: string;
}

function scanRoot(root: string): ServiceCatalogFile[] {
  if (!fs.existsSync(root)) return [];
  const hints: ServiceCatalogFile[] = [];
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith(".")) continue; // skip .git, .DS_Store, etc.
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    // Must have a compose file to count as a service.
    const hasCompose = ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"]
      .some((f) => fs.existsSync(path.join(dir, f)));
    if (!hasCompose) continue;
    const file = path.join(dir, "catalog.yml");
    if (!fs.existsSync(file)) {
      hints.push({ service: name, _absDir: dir });
      continue;
    }
    try {
      const parsed = YAML.parse(fs.readFileSync(file, "utf-8")) || {};
      hints.push({ service: name, ...parsed, _absDir: dir });
    } catch (e) {
      console.error(`catalog.yml parse failed for ${name}:`, e);
      hints.push({ service: name, _absDir: dir });
    }
  }
  return hints;
}

export function readCatalogHints(): ServiceCatalogFile[] {
  const roots = SERVICES_ROOT.split(":").filter(Boolean);
  const all: ServiceCatalogFile[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const hint of scanRoot(root)) {
      // First occurrence wins — earlier roots take precedence for name collisions.
      if (seen.has(hint.service)) continue;
      seen.add(hint.service);
      all.push(hint);
    }
  }
  return all;
}
