// Joins data from Beszel + cloudflared + CF Access + catalog.yml hints +
// compose-file static metadata into a unified service record.

import { BeszelState, BeszelContainer, BeszelSystem } from "./sources/beszel.js";
import { TunnelRoute } from "./sources/tunnel.js";
import { AccessAppSummary, matchAccess } from "./sources/access.js";
import { ServiceCatalogFile } from "./sources/catalogs.js";
import { readComposeForService, ContainerCompose, ComposeNetwork } from "./sources/compose.js";

const ICONS_BASE = process.env.ICONS_BASE_URL || "https://icons.jacob.st";

export interface ContainerDetail {
  name: string;
  image?: string;
  ports?: string[];
  volumes?: string[];
  envFile?: string;
  hasHealthcheck?: boolean;
  dependsOn?: string[];
  restart?: string;
  networkMode?: string;
  networks?: string[];
  running: boolean;
}

export interface ServiceRecord {
  name: string;
  category?: string;
  description?: string;
  hostnames: string[];
  containers: string[];        // names Beszel actually sees (legacy / shorthand)
  missingContainers: string[];
  containerDetails: ContainerDetail[];
  host: string;
  status: "running" | "partial" | "stopped" | "unknown";
  ports: number[];
  access: Array<{
    hostname: string;
    policies: Array<{ name: string; decision: string; identities: string[] }>;
    gated: boolean;
  }>;
  infisical_secrets: string[];
  docs_url?: string;
  tags: string[];
  internal: boolean;
  paths: {
    docker_services: string;
  };
  links: {
    beszel?: string;
    obsidian?: string;
  };
  networks: string[];             // deduplicated list of docker networks this service connects to
  icon_url?: string;             // selfh.st/icons URL — undefined if explicitly suppressed
  updated_at: string;
}

export interface HostInfo {
  name: string;
  ip: string;
  status: string;
  agentVersion?: string;
  uptimeSeconds?: number;
  containerCount?: number;
}

export interface InfrastructureRecord {
  cloudflared_routes: Array<{ hostname: string; service: string; port: number | null }>;
  hosts: HostInfo[];
  access_apps: Array<{ name: string; domain: string; policies: string[] }>;
}

export function buildCatalog(
  hints: ServiceCatalogFile[],
  beszel: BeszelState,
  tunnel: TunnelRoute[],
  access: AccessAppSummary[],
): { services: ServiceRecord[]; infra: InfrastructureRecord } {
  const services: ServiceRecord[] = [];

  // Quick lookup of running containers by name
  const runningByName = new Map<string, BeszelContainer>(
    beszel.containers.map((c) => [c.name, c]),
  );

  for (const hint of hints) {
    const serviceName = hint.service;
    const absDir = hint._absDir;

    // Static container info from compose.yml
    const composeProject = absDir ? readComposeForService(absDir) : { containers: [], networks: [] };
    const composeContainers = composeProject.containers;

    // Infer hostnames if not declared
    const hostnames = hint.hostnames ?? inferHostnames(serviceName, tunnel);

    // Expected containers: hint > compose > prefix-match in Beszel
    const expectedContainers =
      hint.containers ??
      (composeContainers.length > 0
        ? composeContainers.map((c) => c.name)
        : inferContainers(serviceName, beszel.containers));

    const runningContainers = expectedContainers.filter((n) => runningByName.has(n));
    const missingContainers = expectedContainers.filter((n) => !runningByName.has(n));

    // Determine host
    const hostFromContainers = expectedContainers
      .map((n) => runningByName.get(n)?.systemName)
      .find(Boolean);
    const host = hint.host ?? hostFromContainers ?? "resolution";

    // Status
    let status: ServiceRecord["status"] = "unknown";
    if (expectedContainers.length === 0) {
      status = hostnames.length > 0 ? "unknown" : "stopped";
    } else if (runningContainers.length === expectedContainers.length) {
      status = "running";
    } else if (runningContainers.length > 0) {
      status = "partial";
    } else {
      status = "stopped";
    }

    // Build per-container detail by merging compose + runtime
    const composeByName = new Map(composeContainers.map((c) => [c.name, c]));
    const allContainerNames = Array.from(new Set([
      ...expectedContainers,
      ...composeContainers.map((c) => c.name),
    ]));
    const containerDetails: ContainerDetail[] = allContainerNames.map((name) => {
      const c = composeByName.get(name);
      const live = runningByName.get(name);
      return {
        name,
        image: c?.image,
        ports: c?.ports,
        volumes: c?.volumes,
        envFile: c?.envFile,
        hasHealthcheck: c?.hasHealthcheck,
        dependsOn: c?.dependsOn,
        restart: c?.restart,
        networkMode: c?.networkMode,
        networks: c?.networks,
        running: !!live,
      };
    });

    // Ports from tunnel routes (the only ports exposed publicly)
    const ports = hostnames
      .map((h) => tunnel.find((t) => t.hostname === h)?.port)
      .filter((p): p is number => typeof p === "number");

    // Access posture per hostname
    const accessInfo = hostnames.map((h) => {
      const app = matchAccess(access, h);
      const policies = app?.policies ?? [];
      const gated = policies.some((p) =>
        ["allow", "non_identity"].includes(p.decision),
      ) && !policies.some((p) => p.decision === "bypass" && p.identities.includes("everyone"));
      return { hostname: h, policies, gated };
    });

    services.push({
      name: serviceName,
      category: hint.category,
      description: hint.description,
      hostnames,
      containers: runningContainers,
      missingContainers,
      containerDetails,
      host,
      status,
      ports,
      access: accessInfo,
      infisical_secrets: hint.infisical_secrets ?? [],
      docs_url: hint.docs_url,
      tags: hint.tags ?? [],
      internal: hint.internal === true,
      networks: Array.from(new Set([
        // Per-container networks
        ...containerDetails.flatMap((c) => c.networks ?? []),
        // Top-level compose networks (include real names for external ones)
        ...composeProject.networks.map((n) => n.realName ?? n.name),
      ])).filter((n) => n !== "default"),
      paths: {
        docker_services: `/root/docker-services/${serviceName}`,
      },
      links: {
        beszel: `https://beszel.jacob.st/system/${encodeURIComponent(serviceName)}`,
        obsidian: `obsidian://open?vault=thesys-vault&file=${encodeURIComponent(
          `Homelab/Services/${serviceName}`,
        )}`,
      },
      icon_url: hint.icon === false
        ? undefined
        : `${ICONS_BASE}/${typeof hint.icon === "string" ? hint.icon : serviceName}.svg`,
      updated_at: new Date().toISOString(),
    });
  }

  services.sort((a, b) => a.name.localeCompare(b.name));

  const infra: InfrastructureRecord = {
    cloudflared_routes: tunnel.map((t) => ({
      hostname: t.hostname,
      service: t.service,
      port: t.port,
    })),
    hosts: beszel.systems.map((s: BeszelSystem): HostInfo => ({
      name: s.name,
      ip: s.host,
      status: s.status,
      agentVersion: s.agentVersion,
      uptimeSeconds: s.uptimeSeconds,
      containerCount: s.containerCount,
    })),
    access_apps: access.map((a) => ({
      name: a.name,
      domain: a.domain,
      policies: a.policies.map((p) => `${p.decision}:${p.identities.join(",")}`),
    })),
  };

  return { services, infra };
}

function inferHostnames(service: string, tunnel: TunnelRoute[]): string[] {
  return tunnel
    .filter((t) => t.hostname.split(".")[0] === service)
    .map((t) => t.hostname);
}

function inferContainers(service: string, containers: BeszelContainer[]): string[] {
  return containers
    .filter((c) => c.name === service || c.name.startsWith(`${service}-`))
    .map((c) => c.name);
}
