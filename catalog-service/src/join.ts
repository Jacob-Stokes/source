// Joins data from Beszel + cloudflared + CF Access + catalog.yml hints into
// a unified service record. One record per compose-project dir under /services.

import { BeszelState, BeszelContainer } from "./sources/beszel.js";
import { TunnelRoute } from "./sources/tunnel.js";
import { AccessAppSummary, matchAccess } from "./sources/access.js";
import { ServiceCatalogFile } from "./sources/catalogs.js";

export interface ServiceRecord {
  name: string;
  category?: string;
  description?: string;
  hostnames: string[];
  containers: string[];      // names Beszel actually sees
  missingContainers: string[]; // containers the hint mentioned but Beszel doesn't see
  host: string;              // which physical host
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
  updated_at: string;
}

export interface InfrastructureRecord {
  cloudflared_routes: Array<{ hostname: string; service: string; port: number | null }>;
  systems: Array<{ name: string; host: string; status: string }>;
  access_apps: Array<{ name: string; domain: string; policies: string[] }>;
}

export function buildCatalog(
  hints: ServiceCatalogFile[],
  beszel: BeszelState,
  tunnel: TunnelRoute[],
  access: AccessAppSummary[],
): { services: ServiceRecord[]; infra: InfrastructureRecord } {
  const services: ServiceRecord[] = [];

  for (const hint of hints) {
    const serviceName = hint.service;

    // Match hostnames: use hint if provided, else infer by matching tunnel routes
    // whose port maps to any container this service owns. Since we can't directly
    // tie containers to ports without docker socket, we fall back to name matching.
    const hostnames = hint.hostnames ?? inferHostnames(serviceName, tunnel);

    // Match containers: use hint if provided, else guess by prefix matching.
    const expectedContainers = hint.containers ?? inferContainers(serviceName, beszel.containers);
    const runningContainers = beszel.containers
      .filter((c) => expectedContainers.includes(c.name))
      .map((c) => c.name);
    const missingContainers = expectedContainers.filter(
      (n) => !runningContainers.includes(n),
    );

    // Determine host — prefer hint, else whichever host is running the containers.
    const hostFromContainers = beszel.containers.find((c) =>
      expectedContainers.includes(c.name),
    )?.systemName;
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

    // Ports derived from tunnel routes
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
      host,
      status,
      ports,
      access: accessInfo,
      infisical_secrets: hint.infisical_secrets ?? [],
      docs_url: hint.docs_url,
      tags: hint.tags ?? [],
      internal: hint.internal === true,
      paths: {
        docker_services: `/root/docker-services/${serviceName}`,
      },
      links: {
        beszel: `https://beszel.jacob.st/system/${encodeURIComponent(serviceName)}`,
        obsidian: `obsidian://open?vault=thesys-vault&file=${encodeURIComponent(
          `Homelab/Services/${serviceName}`,
        )}`,
      },
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
    systems: beszel.systems.map((s) => ({ name: s.name, host: s.host, status: s.status })),
    access_apps: access.map((a) => ({
      name: a.name,
      domain: a.domain,
      policies: a.policies.map((p) => `${p.decision}:${p.identities.join(",")}`),
    })),
  };

  return { services, infra };
}

function inferHostnames(service: string, tunnel: TunnelRoute[]): string[] {
  // Match any tunnel hostname whose leading label matches the service name
  // (e.g. service=grimmory → books.jacob.st wouldn't match, but service=obsidian → obsidian.jacob.st would).
  return tunnel
    .filter((t) => {
      const label = t.hostname.split(".")[0];
      return label === service;
    })
    .map((t) => t.hostname);
}

function inferContainers(service: string, containers: BeszelContainer[]): string[] {
  // Match containers named exactly the service or service-*  (e.g. grimmory, grimmory-db)
  return containers
    .filter((c) => c.name === service || c.name.startsWith(`${service}-`))
    .map((c) => c.name);
}
