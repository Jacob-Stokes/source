// Reads systems + current containers from Beszel (PocketBase-backed).
// Auth: superuser login → token → use for subsequent reads.

const BESZEL_URL = process.env.BESZEL_URL || "http://beszel:8090";
const BESZEL_EMAIL = process.env.BESZEL_CATALOG_EMAIL || "";
const BESZEL_PASSWORD = process.env.BESZEL_CATALOG_PASSWORD || "";

let cachedToken: string | undefined;
let tokenExpiresAt = 0;

async function login(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const r = await fetch(
    `${BESZEL_URL}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: BESZEL_EMAIL, password: BESZEL_PASSWORD }),
    },
  );
  if (!r.ok) throw new Error(`beszel login ${r.status}: ${await r.text()}`);
  const { token } = (await r.json()) as { token: string };
  cachedToken = token;
  tokenExpiresAt = Date.now() + 55 * 60_000; // refresh every 55m
  return token;
}

async function pb(path: string): Promise<any> {
  const token = await login();
  const r = await fetch(`${BESZEL_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) {
    cachedToken = undefined;
    return pb(path);
  }
  if (!r.ok) throw new Error(`beszel ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

export interface BeszelSystem {
  id: string;
  name: string;
  host: string;
  status: string;
}

export interface BeszelContainer {
  name: string;
  systemId: string;
  systemName: string;
  cpu: number;
  memMB: number;
}

export async function fetchSystems(): Promise<BeszelSystem[]> {
  const res = await pb(`/api/collections/systems/records?perPage=200`);
  return res.items.map((x: any) => ({
    id: x.id,
    name: x.name,
    host: x.host,
    status: x.status,
  }));
}

// Latest container_stats record per system has the current container list.
export async function fetchContainers(
  systems: BeszelSystem[],
): Promise<BeszelContainer[]> {
  const out: BeszelContainer[] = [];
  for (const sys of systems) {
    const res = await pb(
      `/api/collections/container_stats/records?filter=${encodeURIComponent(
        `system='${sys.id}'`,
      )}&sort=-created&perPage=1`,
    );
    const row = res.items[0];
    if (!row || !Array.isArray(row.stats)) continue;
    for (const c of row.stats) {
      out.push({
        name: c.n,
        systemId: sys.id,
        systemName: sys.name,
        cpu: c.c ?? 0,
        memMB: c.m ?? 0,
      });
    }
  }
  return out;
}

export interface BeszelState {
  systems: BeszelSystem[];
  containers: BeszelContainer[];
}

export async function fetchBeszelState(): Promise<BeszelState> {
  const systems = await fetchSystems();
  const containers = await fetchContainers(systems);
  return { systems, containers };
}
