// Minimal Infisical universal-auth client — fetches one secret by name, using
// the INFISICAL_* env vars we already inject into every bot container.
// Caches the access token for its natural ~5-minute lifetime.

interface TokenState {
  token: string;
  expiresAt: number;
}

let cache: TokenState | null = null;

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cache && cache.expiresAt > now + 5000) return cache.token;

  const domain = process.env.INFISICAL_DOMAIN;
  const clientId = process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID;
  const clientSecret = process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret) {
    throw new Error("infisical: missing INFISICAL_DOMAIN / CLIENT_ID / CLIENT_SECRET env vars");
  }

  const res = await fetch(`${domain}/api/v1/auth/universal-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) throw new Error(`infisical login failed: HTTP ${res.status}`);
  const body = (await res.json()) as { accessToken: string; expiresIn?: number };
  const ttlMs = (body.expiresIn ?? 600) * 1000;
  cache = { token: body.accessToken, expiresAt: now + ttlMs };
  return body.accessToken;
}

export async function fetchSecret(keyName: string): Promise<string> {
  const token = await getToken();
  const domain = process.env.INFISICAL_DOMAIN!;
  const workspaceId = process.env.INFISICAL_PROJECT_ID!;
  const url = `${domain}/api/v3/secrets/raw/${encodeURIComponent(keyName)}?environment=prod&workspaceId=${workspaceId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`infisical fetch ${keyName} failed: HTTP ${res.status}`);
  const body = (await res.json()) as { secret?: { secretValue?: string } };
  const val = body.secret?.secretValue;
  if (!val) throw new Error(`infisical: secret '${keyName}' has no value`);
  return val;
}
