// Reads the glossary (routing map) + per-host descriptions from files
// inside the catalog service's own directory. Both are optional — if absent
// the glossary endpoint just returns empty/unannotated data.
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// The catalog service mounts its own service directory at this path.
// /services-resolution/catalog/ contains its compose.yml + glossary.yml + hosts.yml.
const SERVICES_ROOT = (process.env.SERVICES_ROOT || "/services").split(":")[0];
const GLOSSARY_PATH = path.join(SERVICES_ROOT, "catalog", "glossary.yml");
const HOSTS_PATH = path.join(SERVICES_ROOT, "catalog", "hosts.yml");

export interface RoutingEntry {
  primary: string;
  note?: string;
}

export interface GlossaryFile {
  routing?: Record<string, RoutingEntry>;
}

export interface HostsFile {
  hosts?: Record<string, { description?: string }>;
}

export function readGlossary(): GlossaryFile {
  if (!fs.existsSync(GLOSSARY_PATH)) return {};
  try {
    return YAML.parse(fs.readFileSync(GLOSSARY_PATH, "utf-8")) || {};
  } catch (e) {
    console.error(`glossary.yml parse failed:`, e);
    return {};
  }
}

export function readHosts(): HostsFile {
  if (!fs.existsSync(HOSTS_PATH)) return {};
  try {
    return YAML.parse(fs.readFileSync(HOSTS_PATH, "utf-8")) || {};
  } catch (e) {
    console.error(`hosts.yml parse failed:`, e);
    return {};
  }
}
