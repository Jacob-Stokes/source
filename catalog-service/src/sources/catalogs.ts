// Reads per-service catalog.yml files from /services/<name>/catalog.yml
// These provide human-curated metadata (description, secret names, docs links)
// that aren't derivable from docker/cloudflared/access.
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

export function readCatalogHints(): ServiceCatalogFile[] {
  if (!fs.existsSync(SERVICES_ROOT)) return [];
  const hints: ServiceCatalogFile[] = [];
  for (const name of fs.readdirSync(SERVICES_ROOT)) {
    if (name.startsWith(".")) continue; // skip .git, .DS_Store, etc.
    const dir = path.join(SERVICES_ROOT, name);
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
