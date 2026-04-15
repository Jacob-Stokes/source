// Parses /etc/cloudflared/config.yml to map hostnames to internal ports.
import fs from "node:fs";
import YAML from "yaml";

const CF_CONFIG_PATH = process.env.CF_CONFIG_PATH || "/cf/config.yml";

export interface TunnelRoute {
  hostname: string;
  port: number | null; // null if service is http_status or non-localhost
  service: string;     // raw service string for debugging
}

export function readTunnelRoutes(): TunnelRoute[] {
  if (!fs.existsSync(CF_CONFIG_PATH)) return [];
  const doc = YAML.parse(fs.readFileSync(CF_CONFIG_PATH, "utf-8"));
  const ingress = Array.isArray(doc?.ingress) ? doc.ingress : [];
  const routes: TunnelRoute[] = [];
  for (const entry of ingress) {
    if (!entry.hostname) continue;
    const svc: string = entry.service ?? "";
    const m = svc.match(/^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
    routes.push({
      hostname: entry.hostname,
      port: m ? parseInt(m[1], 10) : null,
      service: svc,
    });
  }
  return routes;
}
