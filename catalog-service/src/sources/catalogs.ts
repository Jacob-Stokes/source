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

export interface ServiceCatalogFile {
  service: string;               // derived from directory name
  description?: string;
  category?: string;
  docs_url?: string;
  tags?: string[];
  infisical_secrets?: string[];
  hostnames?: string[];          // only if you want to override the auto-derived mapping
  containers?: string[];         // hint for which container names belong to this service
  host?: string;                 // override if the service runs on a specific host (default: resolution)
  internal?: boolean;            // hide from default listing
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
      hints.push({ service: name });
      continue;
    }
    try {
      const parsed = YAML.parse(fs.readFileSync(file, "utf-8")) || {};
      hints.push({ service: name, ...parsed });
    } catch (e) {
      console.error(`catalog.yml parse failed for ${name}:`, e);
      hints.push({ service: name });
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
