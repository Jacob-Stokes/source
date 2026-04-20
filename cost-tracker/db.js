import Database from 'better-sqlite3';

let db;

export function getDb() {
  if (!db) {
    const dbPath = process.env.DB_PATH || '/data/agent-usage.db';
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      agent TEXT NOT NULL,
      model TEXT,
      cost_usd REAL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read INTEGER,
      cache_creation INTEGER,
      duration_ms INTEGER
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON runs(timestamp)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent)');
    // Add usage snapshot columns if they don't exist
    try { db.exec('ALTER TABLE runs ADD COLUMN usage_5h_before REAL'); } catch(e) {}
    try { db.exec('ALTER TABLE runs ADD COLUMN usage_5h_after REAL'); } catch(e) {}
    try { db.exec('ALTER TABLE runs ADD COLUMN usage_7d_before REAL'); } catch(e) {}
    try { db.exec('ALTER TABLE runs ADD COLUMN usage_7d_after REAL'); } catch(e) {}
    // Drop old delta columns if they exist (replaced by before/after)
    try { db.exec('ALTER TABLE runs DROP COLUMN usage_delta_5h'); } catch(e) {}
    try { db.exec('ALTER TABLE runs DROP COLUMN usage_delta_7d'); } catch(e) {}

    db.exec(`CREATE TABLE IF NOT EXISTS claude_usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      five_hour_util REAL,
      five_hour_resets_at TEXT,
      seven_day_util REAL,
      seven_day_resets_at TEXT,
      seven_day_opus_util REAL,
      seven_day_sonnet_util REAL,
      subscription_type TEXT,
      raw TEXT
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_claude_snap_timestamp ON claude_usage_snapshots(timestamp)');
  }
  return db;
}

export function insertClaudeSnapshot(data) {
  const db = getDb();
  return db.prepare(`INSERT INTO claude_usage_snapshots
    (five_hour_util, five_hour_resets_at, seven_day_util, seven_day_resets_at, seven_day_opus_util, seven_day_sonnet_util, subscription_type, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    data.five_hour_util ?? null,
    data.five_hour_resets_at ?? null,
    data.seven_day_util ?? null,
    data.seven_day_resets_at ?? null,
    data.seven_day_opus_util ?? null,
    data.seven_day_sonnet_util ?? null,
    data.subscription_type ?? null,
    data.raw ?? null
  );
}

export function getClaudeSnapshots({ since, until, limit = 1440 } = {}) {
  const db = getDb();
  let where = '1=1';
  const params = [];
  if (since) { where += ' AND timestamp >= ?'; params.push(since); }
  if (until) { where += ' AND timestamp <= ?'; params.push(until); }
  return db.prepare(`SELECT timestamp, five_hour_util, five_hour_resets_at, seven_day_util, seven_day_resets_at, seven_day_opus_util, seven_day_sonnet_util, subscription_type
    FROM claude_usage_snapshots WHERE ${where} ORDER BY timestamp ASC LIMIT ?`).all(...params, limit);
}

export function getLatestClaudeSnapshot() {
  const db = getDb();
  return db.prepare(`SELECT * FROM claude_usage_snapshots ORDER BY id DESC LIMIT 1`).get();
}

export function insertRun(data) {
  const db = getDb();
  return db.prepare(`INSERT INTO runs (agent, model, cost_usd, input_tokens, output_tokens, cache_read, cache_creation, duration_ms, usage_5h_before, usage_5h_after, usage_7d_before, usage_7d_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    data.agent, data.model, data.cost_usd,
    data.input_tokens, data.output_tokens,
    data.cache_read, data.cache_creation,
    data.duration_ms,
    data.usage_5h_before ?? null, data.usage_5h_after ?? null,
    data.usage_7d_before ?? null, data.usage_7d_after ?? null
  );
}

export function getRuns({ agent, model, since, until, limit = 100, offset = 0 }) {
  const db = getDb();
  let where = '1=1';
  const params = [];
  if (agent) { where += ' AND agent = ?'; params.push(agent); }
  if (model) { where += ' AND model = ?'; params.push(model); }
  if (since) { where += ' AND timestamp >= ?'; params.push(since); }
  if (until) { where += ' AND timestamp <= ?'; params.push(until); }
  const total = db.prepare(`SELECT COUNT(*) as count FROM runs WHERE ${where}`).get(...params).count;
  const rows = db.prepare(`SELECT * FROM runs WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { rows, total };
}

export function getStats({ since, until, agent, model }) {
  const db = getDb();
  let where = '1=1';
  const params = [];
  if (agent) { where += ' AND agent = ?'; params.push(agent); }
  if (model) { where += ' AND model = ?'; params.push(model); }
  if (since) { where += ' AND timestamp >= ?'; params.push(since); }
  if (until) { where += ' AND timestamp <= ?'; params.push(until); }

  const total = db.prepare(`SELECT COUNT(*) as total_runs, COALESCE(SUM(cost_usd),0) as total_cost, COALESCE(SUM(input_tokens),0) as total_input_tokens, COALESCE(SUM(output_tokens),0) as total_output_tokens FROM runs WHERE ${where}`).get(...params);

  const today = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) as cost FROM runs WHERE date(timestamp) = date('now') AND ${where}`).get(...params);
  const week = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) as cost FROM runs WHERE timestamp >= datetime('now', '-7 days') AND ${where}`).get(...params);
  const month = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) as cost FROM runs WHERE timestamp >= datetime('now', '-30 days') AND ${where}`).get(...params);

  const byAgent = db.prepare(`SELECT agent, COUNT(*) as runs, COALESCE(SUM(cost_usd),0) as cost FROM runs WHERE ${where} GROUP BY agent ORDER BY cost DESC`).all(...params);
  const byModel = db.prepare(`SELECT model, COUNT(*) as runs, COALESCE(SUM(cost_usd),0) as cost FROM runs WHERE ${where} GROUP BY model ORDER BY cost DESC`).all(...params);

  return { ...total, cost_today: today.cost, cost_this_week: week.cost, cost_this_month: month.cost, by_agent: byAgent, by_model: byModel };
}

export function getFilterOptions() {
  const db = getDb();
  const agents = db.prepare('SELECT DISTINCT agent FROM runs ORDER BY agent').all().map(r => r.agent);
  const models = db.prepare('SELECT DISTINCT model FROM runs ORDER BY model').all().map(r => r.model);
  return { agents, models };
}

export function getAgentStats(agent, { limit = 10, offset = 0 } = {}) {
  const db = getDb();
  const summary = db.prepare(`
    SELECT COUNT(*) as total_runs,
      COALESCE(AVG(cost_usd), 0) as avg_cost,
      COALESCE(AVG(input_tokens), 0) as avg_input_tokens,
      COALESCE(AVG(output_tokens), 0) as avg_output_tokens,
      COALESCE(AVG(cache_read), 0) as avg_cache_read,
      COALESCE(AVG(cache_creation), 0) as avg_cache_creation,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms,
      COALESCE(SUM(cost_usd), 0) as total_cost,
      COALESCE(SUM(input_tokens), 0) as total_input_tokens,
      COALESCE(SUM(output_tokens), 0) as total_output_tokens,
      MIN(timestamp) as first_run,
      MAX(timestamp) as last_run,
      AVG(usage_5h_before) as avg_usage_5h_before,
      AVG(usage_5h_after) as avg_usage_5h_after,
      AVG(usage_7d_before) as avg_usage_7d_before,
      AVG(usage_7d_after) as avg_usage_7d_after,
      AVG(CASE WHEN usage_5h_after IS NOT NULL AND usage_5h_before IS NOT NULL THEN usage_5h_after - usage_5h_before END) as avg_usage_5h_delta,
      AVG(CASE WHEN usage_7d_after IS NOT NULL AND usage_7d_before IS NOT NULL THEN usage_7d_after - usage_7d_before END) as avg_usage_7d_delta
    FROM runs WHERE agent = ?
  `).get(agent);
  const recentTotal = db.prepare(`SELECT COUNT(*) as count FROM runs WHERE agent = ?`).get(agent).count;
  const recent = db.prepare(`
    SELECT timestamp, cost_usd, input_tokens, output_tokens, cache_read, cache_creation, duration_ms, model,
      usage_5h_before, usage_5h_after, usage_7d_before, usage_7d_after
    FROM runs WHERE agent = ? ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(agent, limit, offset);
  const trend = db.prepare(`
    SELECT date(timestamp) as date,
      COUNT(*) as runs,
      COALESCE(AVG(cost_usd), 0) as avg_cost,
      COALESCE(AVG(input_tokens), 0) as avg_input_tokens,
      COALESCE(AVG(output_tokens), 0) as avg_output_tokens,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM runs WHERE agent = ? AND timestamp >= datetime('now', '-30 days')
    GROUP BY date(timestamp) ORDER BY date
  `).all(agent);
  return { summary, recent, recentTotal, trend };
}

export function getTimeseries(days = 30) {
  const db = getDb();
  return db.prepare(`SELECT date(timestamp) as date, COUNT(*) as runs, COALESCE(SUM(cost_usd),0) as cost, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens, COALESCE(SUM(cache_read),0) as cache_read, COALESCE(SUM(cache_creation),0) as cache_creation FROM runs WHERE timestamp >= datetime('now', '-' || ? || ' days') GROUP BY date(timestamp) ORDER BY date`).all(days);
}
