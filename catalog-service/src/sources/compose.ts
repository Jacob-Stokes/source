// Parses compose.yml files in each service dir to extract per-container static
// metadata (image, ports, volumes, healthcheck presence). Beszel doesn't expose
// these — the compose file is the source of truth.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface ContainerCompose {
  name: string;        // container_name or `<service>_<key>`
  service: string;     // compose service key (the YAML key under `services:`)
  image?: string;
  ports: string[];     // raw entries from `ports:` (e.g. "127.0.0.1:3350:3000")
  volumes: string[];   // raw entries from `volumes:`
  envFile?: string;    // first entry in `env_file:` if present
  hasHealthcheck: boolean;
  dependsOn: string[];
  restart?: string;
  networkMode?: string;
  networks: string[];  // network names this container is connected to
}

// Top-level network info for the whole compose project.
export interface ComposeNetwork {
  name: string;        // key in the top-level `networks:` block
  external: boolean;
  realName?: string;   // `name:` field if specified (e.g. beszel_default)
}

export interface ComposeProject {
  containers: ContainerCompose[];
  networks: ComposeNetwork[];
}

const COMPOSE_FILES = ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"];

function findComposeFile(dir: string): string | undefined {
  for (const f of COMPOSE_FILES) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  if (typeof v === "string") return [v];
  if (typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).map(([k, val]) => `${k}=${val}`);
  }
  return [];
}

function dependsOnArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>);
  return [];
}

function networksArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>);
  return [];
}

function parseTopLevelNetworks(doc: any): ComposeNetwork[] {
  const nets = doc?.networks;
  if (!nets || typeof nets !== "object") return [];
  return Object.entries(nets).map(([key, val]: [string, any]) => ({
    name: key,
    external: !!(val?.external),
    realName: typeof val?.name === "string" ? val.name : undefined,
  }));
}

export function readComposeForService(serviceDir: string): ComposeProject {
  const file = findComposeFile(serviceDir);
  if (!file) return { containers: [], networks: [] };
  let doc: any;
  try {
    doc = YAML.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return { containers: [], networks: [] };
  }
  const services = doc?.services ?? {};
  const topNetworks = parseTopLevelNetworks(doc);
  const containers: ContainerCompose[] = [];
  for (const [key, raw] of Object.entries(services)) {
    const svc = raw as any;
    const containerName: string = svc?.container_name ?? key;
    const envFile = Array.isArray(svc?.env_file) ? svc.env_file[0] : svc?.env_file;
    containers.push({
      name: containerName,
      service: key,
      image: typeof svc?.image === "string" ? svc.image : undefined,
      ports: asStringArray(svc?.ports),
      volumes: asStringArray(svc?.volumes),
      envFile: typeof envFile === "string" ? envFile : undefined,
      hasHealthcheck: !!svc?.healthcheck,
      dependsOn: dependsOnArray(svc?.depends_on),
      restart: typeof svc?.restart === "string" ? svc.restart : undefined,
      networkMode: typeof svc?.network_mode === "string" ? svc.network_mode : undefined,
      networks: networksArray(svc?.networks),
    });
  }
  return { containers, networks: topNetworks };
}
