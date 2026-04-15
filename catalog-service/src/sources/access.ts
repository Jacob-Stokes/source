// Fetches Cloudflare Access apps + their policies to determine auth posture per hostname.
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "";
const CF_API_TOKEN = process.env.CF_API_TOKEN || "";

export interface AccessAppSummary {
  id: string;
  name: string;
  domain: string;    // e.g. "books.jacob.st" or "books.jacob.st/api/v1/opds"
  hostname: string;  // just the hostname portion
  path: string;      // path portion, or "" for root
  policies: Array<{
    name: string;
    decision: string; // allow | bypass | non_identity | deny
    identities: string[]; // simplified: "email:x", "service_token:<id>", "everyone"
  }>;
}

function splitDomain(domain: string): { hostname: string; path: string } {
  const idx = domain.indexOf("/");
  if (idx === -1) return { hostname: domain, path: "" };
  return { hostname: domain.slice(0, idx), path: domain.slice(idx) };
}

function simplifyInclude(include: any): string[] {
  if (!Array.isArray(include)) return [];
  return include.map((i) => {
    if (i.email?.email) return `email:${i.email.email}`;
    if (i.service_token?.token_id) return `service_token:${i.service_token.token_id}`;
    if (i.everyone) return "everyone";
    if (i.any_valid_service_token) return "any_service_token";
    if (i.group?.id) return `group:${i.group.id}`;
    return Object.keys(i)[0] ?? "unknown";
  });
}

export async function fetchAccessApps(): Promise<AccessAppSummary[]> {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) return [];
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps?per_page=100`,
    { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } },
  );
  if (!r.ok) throw new Error(`cf access ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as any;
  const apps = Array.isArray(body.result) ? body.result : [];
  return apps.map((app: any): AccessAppSummary => {
    const { hostname, path } = splitDomain(app.domain || "");
    return {
      id: app.id,
      name: app.name,
      domain: app.domain,
      hostname,
      path,
      policies: (app.policies || []).map((p: any) => ({
        name: p.name,
        decision: p.decision,
        identities: simplifyInclude(p.include),
      })),
    };
  });
}

// Find the most-specific matching app for a given hostname + path.
export function matchAccess(
  apps: AccessAppSummary[],
  hostname: string,
  path = "/",
): AccessAppSummary | undefined {
  const candidates = apps
    .filter((a) => a.hostname === hostname)
    .filter((a) => path.startsWith(a.path || "/") || a.path === "")
    .sort((a, b) => b.path.length - a.path.length);
  return candidates[0];
}
