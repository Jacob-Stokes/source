import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { insertRun, getRuns, getStats, getTimeseries, getFilterOptions, getAgentStats, getDb, insertClaudeSnapshot, getClaudeSnapshots, getLatestClaudeRaw } from './db.js';
import { renderDashboard } from './dashboard.js';
import { renderAgentDashboard } from './agents-dashboard.js';
import { renderScheduleDashboard } from './schedule-dashboard.js';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3200;
const apiKeyFile = process.env.API_KEY_FILE || '/data/cost-api-key';
let API_KEY = '';
try { API_KEY = fs.readFileSync(apiKeyFile, 'utf8').trim(); } catch(e) { console.error('Warning: Could not read API key file'); }

const DASH_USER = process.env.DASH_USER || 'admin';
const DASH_PASS = process.env.DASH_PASS || API_KEY.slice(0, 16);

let exchangeRates = { USD: 1 };
let ratesLastFetched = 0;

async function fetchExchangeRates() {
  const now = Date.now();
  if (now - ratesLastFetched < 3600000) return;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    if (data.rates) {
      exchangeRates = data.rates;
      ratesLastFetched = now;
      console.log('Exchange rates updated');
    }
  } catch(e) {
    console.error('Failed to fetch exchange rates:', e.message);
  }
}
fetchExchangeRates();

// Claude usage cache
let claudeUsageCache = null;
let claudeUsageCacheTime = 0;

async function fetchClaudeUsage() {
  const now = Date.now();
  if (claudeUsageCache && now - claudeUsageCacheTime < 120000) return claudeUsageCache;
  try {
    const creds = JSON.parse(fs.readFileSync('/data/claude-credentials.json', 'utf8'));
    const token = creds.claudeAiOauth.accessToken;
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'anthropic-beta': 'oauth-2025-04-20',
      }
    });
    if (res.ok) {
      claudeUsageCache = await res.json();
      claudeUsageCacheTime = now;
    } else {
      const body = await res.text().catch(() => '');
      console.error(`Claude usage API returned ${res.status}: ${body}`);
      claudeUsageCache = { _error: `API returned ${res.status}`, _detail: body };
      claudeUsageCacheTime = now;
    }
  } catch(e) {
    console.error('Failed to fetch Claude usage:', e.message);
  }
  return claudeUsageCache;
}

// Codex usage cache
let codexUsageCache = null;
let codexUsageCacheTime = 0;
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_AUTH_FILE = '/data/codex-auth.json';

async function refreshCodexToken() {
  try {
    const auth = JSON.parse(fs.readFileSync(CODEX_AUTH_FILE, 'utf8'));
    const refreshToken = auth.tokens.refresh_token;
    const res = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CODEX_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'openid profile email',
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    auth.tokens.access_token = data.access_token;
    if (data.refresh_token) auth.tokens.refresh_token = data.refresh_token;
    fs.writeFileSync(CODEX_AUTH_FILE, JSON.stringify(auth, null, 2));
    return data.access_token;
  } catch(e) {
    console.error('Failed to refresh Codex token:', e.message);
    return null;
  }
}

async function fetchCodexUsage() {
  const now = Date.now();
  if (codexUsageCache && now - codexUsageCacheTime < 120000) return codexUsageCache;
  try {
    let auth = JSON.parse(fs.readFileSync(CODEX_AUTH_FILE, 'utf8'));
    let token = auth.tokens.access_token;
    const accountId = auth.tokens.account_id || '';
    const headers = {
      'Authorization': 'Bearer ' + token,
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
    };
    if (accountId) headers['ChatGPT-Account-Id'] = accountId;

    let res = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers });
    if (res.status === 401 || res.status === 403) {
      token = await refreshCodexToken();
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
        res = await fetch('https://chatgpt.com/backend-api/wham/usage', { headers });
      }
    }
    if (res.ok) {
      codexUsageCache = await res.json();
      codexUsageCacheTime = now;
    } else {
      const body = await res.text().catch(() => '');
      console.error(`Codex usage API returned ${res.status}: ${body}`);
      codexUsageCache = { _error: `API returned ${res.status}`, _detail: body };
      codexUsageCacheTime = now;
    }
  } catch(e) {
    console.error('Failed to fetch Codex usage:', e.message);
  }
  return codexUsageCache;
}

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
}

function requireApiKeyOrBasicAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === API_KEY) return next();
  return requireBasicAuth(req, res, next);
}

function requireBasicAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Cost Tracker"');
    return res.status(401).send('Authentication required');
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const [user, pass] = decoded.split(':');
  if (user === DASH_USER && pass === DASH_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="Cost Tracker"');
  res.status(401).send('Invalid credentials');
}

function initSettings() {
  const db = getDb();
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  const currency = db.prepare('SELECT value FROM settings WHERE key = ?').get('currency');
  if (!currency) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('currency', 'USD');
}
initSettings();

app.get('/', requireBasicAuth, (req, res) => res.send(renderDashboard()));
app.get('/api/stats', requireApiKeyOrBasicAuth, (req, res) => {
  res.json(getStats({ since: req.query.since, until: req.query.until, agent: req.query.agent, model: req.query.model }));
});
app.get('/api/stats/timeseries', requireApiKeyOrBasicAuth, (req, res) => {
  res.json(getTimeseries(parseInt(req.query.days) || 30));
});
app.get('/api/runs', requireApiKeyOrBasicAuth, (req, res) => {
  res.json(getRuns({
    agent: req.query.agent, model: req.query.model,
    since: req.query.since, until: req.query.until,
    limit: parseInt(req.query.limit) || 100, offset: parseInt(req.query.offset) || 0,
  }));
});
app.get('/api/filters', requireApiKeyOrBasicAuth, (req, res) => {
  res.json(getFilterOptions());
});
app.get('/api/settings', requireApiKeyOrBasicAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});
app.post('/api/settings', requireBasicAuth, (req, res) => {
  const db = getDb();
  for (const [key, value] of Object.entries(req.body)) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  }
  res.json({ ok: true });
});
app.get('/api/settings/api-key', requireBasicAuth, (req, res) => {
  res.json({ key: API_KEY });
});
app.post('/api/settings/api-key/generate', requireBasicAuth, (req, res) => {
  const newKey = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(apiKeyFile, newKey, { mode: 0o600 });
    API_KEY = newKey;
    res.json({ key: newKey });
  } catch(e) {
    res.status(500).json({ error: 'Failed to save API key: ' + e.message });
  }
});
app.get('/api/agent-stats/:agent', requireApiKeyOrBasicAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const offset = parseInt(req.query.offset) || 0;
  res.json(getAgentStats(req.params.agent, { limit, offset }));
});

app.get('/api/rates', requireApiKeyOrBasicAuth, async (req, res) => {
  await fetchExchangeRates();
  res.json(exchangeRates);
});
app.get('/api/claude-usage', requireApiKeyOrBasicAuth, async (req, res) => {
  // Serve from the latest snapshot (written by the background poller) so the
  // dashboard never directly hits Anthropic. force=true falls back to live fetch.
  if (req.query.force !== 'true') {
    const snap = getLatestClaudeRaw();
    if (snap) return res.json(snap);
  }
  if (req.query.force === 'true') {
    claudeUsageCache = null;
    claudeUsageCacheTime = 0;
  }
  const usage = await fetchClaudeUsage();
  if (usage) res.json(usage);
  else res.status(503).json({ error: 'Could not fetch Claude usage' });
});

app.get('/api/claude-usage/snapshots', requireApiKeyOrBasicAuth, (req, res) => {
  const hours = parseInt(req.query.hours) || 24;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  res.json(getClaudeSnapshots({ since, limit: 10000 }));
});

app.get('/api/codex-usage', requireApiKeyOrBasicAuth, async (req, res) => {
  if (req.query.force === 'true') {
    codexUsageCache = null;
    codexUsageCacheTime = 0;
  }
  const usage = await fetchCodexUsage();
  if (usage) res.json(usage);
  else res.status(503).json({ error: 'Could not fetch Codex usage' });
});

// Agent runner - proxy to Windmill
const WINDMILL_URL = process.env.WINDMILL_URL || 'http://windmill-windmill_server-1:8000';
const WINDMILL_TOKEN = process.env.WINDMILL_TOKEN || '';

app.get('/agents', requireBasicAuth, (req, res) => {
  res.send(renderAgentDashboard());
});

app.get('/schedule', requireBasicAuth, (req, res) => {
  res.send(renderScheduleDashboard());
});

app.get('/api/schedules', requireBasicAuth, async (req, res) => {
  try {
    const r = await fetch(`${WINDMILL_URL}/api/w/resolution/schedules/list`, {
      headers: { 'Authorization': 'Bearer ' + WINDMILL_TOKEN },
    });
    const data = await r.json();
    res.json(data.map(s => ({
      path: s.path,
      script_path: s.script_path,
      schedule: s.schedule,
      enabled: s.enabled,
      summary: s.summary || '',
    })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/scripts', requireBasicAuth, async (req, res) => {
  try {
    const r = await fetch(`${WINDMILL_URL}/api/w/resolution/scripts/list`, {
      headers: { 'Authorization': 'Bearer ' + WINDMILL_TOKEN },
    });
    const data = await r.json();
    res.json(data.map(s => ({
      path: s.path,
      summary: s.summary || s.path.split('/').pop(),
    })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agents/run', requireBasicAuth, async (req, res) => {
  const { script_path } = req.body;
  if (!script_path) return res.status(400).json({ error: 'script_path required' });
  try {
    const r = await fetch(`${WINDMILL_URL}/api/w/resolution/jobs/run/p/${script_path}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + WINDMILL_TOKEN, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const jobId = await r.text();
    res.json({ ok: true, job_id: jobId });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/agents/job/:id', requireBasicAuth, async (req, res) => {
  try {
    const r = await fetch(`${WINDMILL_URL}/api/w/resolution/jobs_u/get/${req.params.id}`, {
      headers: { 'Authorization': 'Bearer ' + WINDMILL_TOKEN },
    });
    const data = await r.json();
    res.json({ type: data.type, success: data.success, duration_ms: data.duration_ms, result: data.result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/log', requireApiKey, (req, res) => {
  try {
    const result = insertRun(req.body);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

const USAGE_POLL_MS = parseInt(process.env.USAGE_POLL_MS) || 300000;

let pollBackoffUntil = 0;

async function pollClaudeUsage() {
  if (Date.now() < pollBackoffUntil) return;
  try {
    const creds = JSON.parse(fs.readFileSync('/data/claude-credentials.json', 'utf8'));
    const token = creds.claudeAiOauth.accessToken;
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': 'Bearer ' + token,
        'anthropic-beta': 'oauth-2025-04-20',
      }
    });
    if (res.status === 429) {
      pollBackoffUntil = Date.now() + 30 * 60 * 1000; // 30 min cool-off
      console.warn('[usage-poll] Claude 429 rate-limited, backing off 30 min');
      return;
    }
    if (!res.ok) {
      console.error(`[usage-poll] Claude ${res.status}`);
      return;
    }
    const data = await res.json();
    insertClaudeSnapshot({
      five_hour_util: data.five_hour?.utilization ?? null,
      five_hour_resets_at: data.five_hour?.resets_at ?? null,
      seven_day_util: data.seven_day?.utilization ?? null,
      seven_day_resets_at: data.seven_day?.resets_at ?? null,
      seven_day_opus_util: data.seven_day_opus?.utilization ?? null,
      seven_day_sonnet_util: data.seven_day_sonnet?.utilization ?? null,
      subscription_type: data.subscription_type || data.subscription_tier || null,
      raw: JSON.stringify(data),
    });
  } catch(e) {
    console.error('[usage-poll] Claude error:', e.message);
  }
}

setInterval(pollClaudeUsage, USAGE_POLL_MS);
pollClaudeUsage();

app.listen(PORT, () => {
  console.log('Cost tracker running on port ' + PORT);
  console.log('Dashboard user: ' + DASH_USER);
  console.log(`Claude usage polling every ${USAGE_POLL_MS}ms`);
});
