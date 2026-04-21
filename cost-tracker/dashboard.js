import { agentModalSnippet } from './agent-modal.js';

export function renderDashboard() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cost Tracker</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #09090b; color: #fafafa; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 1280px; margin: 0 auto; padding: 24px 20px; }
  header { margin-bottom: 32px; display: flex; align-items: flex-start; justify-content: space-between; }
  .header-left { }
  header h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.025em; }
  header p { color: #71717a; font-size: 14px; margin-top: 4px; }

  .currency-selector select {
    background: #18181b; border: 1px solid #27272a; color: #fafafa;
    padding: 8px 12px; border-radius: 8px; font-size: 14px;
    cursor: pointer; outline: none; appearance: auto;
    transition: border-color 0.2s;
  }
  .currency-selector select:hover { border-color: #3f3f46; }
  .currency-selector select:focus { border-color: #22c55e; }
  .currency-selector label { color: #a1a1aa; font-size: 12px; margin-right: 8px; text-transform: uppercase; letter-spacing: 0.05em; }

  /* Claude Subscription Section */
  .claude-section {
    background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 24px;
    margin-bottom: 24px;
  }
  .claude-section h2 { font-size: 16px; font-weight: 600; margin-bottom: 4px; letter-spacing: -0.01em; }
  .claude-section .sub-type { font-size: 13px; color: #a1a1aa; margin-bottom: 16px; }
  .claude-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .claude-bar-group { }
  .claude-bar-label { font-size: 13px; font-weight: 500; color: #d4d4d8; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: baseline; }
  .claude-bar-label .pct { font-size: 14px; font-weight: 700; }
  .claude-bar-track {
    background: #27272a; border-radius: 8px; height: 22px; overflow: hidden; position: relative;
  }
  .claude-bar-fill {
    height: 100%; border-radius: 8px; transition: width 0.6s ease;
    min-width: 0;
  }
  .claude-bar-reset { font-size: 12px; color: #71717a; margin-top: 4px; }
  .claude-model-breakdown { font-size: 12px; color: #71717a; margin-top: 12px; }
  .claude-model-breakdown span { margin-right: 16px; }
  .claude-loading { color: #71717a; font-size: 14px; }
  .claude-error { color: #ef4444; font-size: 13px; }

  .usage-history-inner {
    margin-top: 20px; padding-top: 16px; border-top: 1px solid #27272a;
  }
  .usage-history-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 8px; flex-wrap: wrap; }
  .usage-history-title { font-size: 13px; font-weight: 500; color: #d4d4d8; }
  .usage-history-controls { display: flex; gap: 6px; flex-wrap: wrap; }
  .usage-history-controls button {
    background: #27272a; color: #d4d4d8; border: 1px solid #3f3f46; border-radius: 6px;
    padding: 3px 8px; font-size: 11px; cursor: pointer;
  }
  .usage-history-controls button.active { background: #3f3f46; color: #fafafa; border-color: #52525b; }
  .usage-history-inner svg { width: 100%; height: 160px; display: block; }
  .usage-history-legend { display: flex; gap: 12px; font-size: 11px; color: #a1a1aa; margin-top: 8px; flex-wrap: wrap; }
  .usage-history-legend .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .usage-chart-wrapper { position: relative; cursor: crosshair; }
  .usage-tooltip {
    position: absolute; pointer-events: none; display: none;
    background: #09090b; border: 1px solid #3f3f46; border-radius: 6px;
    padding: 8px 10px; font-size: 11px; color: #fafafa;
    z-index: 10; min-width: 140px; line-height: 1.5;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  }
  .usage-tooltip-time { font-size: 10px; color: #a1a1aa; margin-bottom: 4px; border-bottom: 1px solid #27272a; padding-bottom: 4px; }
  .usage-tooltip-row { display: flex; justify-content: space-between; gap: 12px; }
  .usage-tooltip-row .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .usage-tooltip-row .val { font-variant-numeric: tabular-nums; font-weight: 600; }
  .claude-bar-projection { font-size: 11px; margin-top: 2px; font-variant-numeric: tabular-nums; }

  @media (max-width: 600px) {
    .claude-bars { grid-template-columns: 1fr; }
  }

  .stats-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px;
  }
  .stat-card {
    background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 20px 24px;
    transition: border-color 0.2s;
  }
  .stat-card:hover { border-color: #3f3f46; }
  .stat-label { font-size: 13px; color: #a1a1aa; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-value { font-size: 28px; font-weight: 700; margin-top: 6px; letter-spacing: -0.025em; }
  .stat-value.cost { color: #22c55e; }

  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .card {
    background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 24px;
  }
  .card-full { grid-column: 1 / -1; }
  .card h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; letter-spacing: -0.01em; }

  .chart-container { position: relative; height: 280px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #a1a1aa; font-weight: 500; padding: 10px 12px; border-bottom: 1px solid #27272a; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 10px 12px; border-bottom: 1px solid #27272a1a; color: #d4d4d8; }
  tr:hover td { background: #ffffff06; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
  .cost-cell { color: #22c55e; font-weight: 600; font-variant-numeric: tabular-nums; }
  .token-cell { font-variant-numeric: tabular-nums; color: #a1a1aa; }
  .agent-badge {
    display: inline-block; background: #22c55e18; color: #22c55e; padding: 2px 10px;
    border-radius: 9999px; font-size: 12px; font-weight: 500;
  }
  .model-badge {
    display: inline-block; background: #3b82f618; color: #60a5fa; padding: 2px 10px;
    border-radius: 9999px; font-size: 12px; font-weight: 500;
  }
  .duration { color: #a1a1aa; }

  .loading { display: flex; align-items: center; justify-content: center; height: 200px; color: #71717a; }
  .empty-state { text-align: center; padding: 40px; color: #71717a; }

  .pagination {
    display: flex; align-items: center; justify-content: space-between; margin-top: 16px;
    padding: 0 4px; font-size: 13px; color: #a1a1aa;
  }
  .pagination button {
    background: #27272a; border: 1px solid #3f3f46; color: #fafafa; padding: 6px 14px;
    border-radius: 6px; font-size: 13px; cursor: pointer; transition: background 0.2s;
  }
  .pagination button:hover:not(:disabled) { background: #3f3f46; }
  .pagination button:disabled { opacity: 0.3; cursor: default; }
  .pagination .page-info { font-variant-numeric: tabular-nums; }

  .filters {
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 16px;
  }
  .filters select, .filters input {
    background: #18181b; border: 1px solid #3f3f46; color: #fafafa;
    padding: 6px 10px; border-radius: 6px; font-size: 13px; outline: none;
    transition: border-color 0.2s;
  }
  .filters select:focus, .filters input:focus { border-color: #22c55e; }
  .filters label { color: #a1a1aa; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .filter-group { display: flex; flex-direction: column; gap: 4px; }
  .filters .clear-btn {
    background: transparent; border: 1px solid #3f3f46; color: #a1a1aa;
    padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer;
    transition: all 0.2s; align-self: flex-end;
  }
  .filters .clear-btn:hover { border-color: #ef4444; color: #ef4444; }

  @media (max-width: 900px) {
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .grid-2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 900px) { .sub-grid { grid-template-columns: 1fr !important; } }
  @media (max-width: 500px) {
    .stats-grid { grid-template-columns: 1fr; }
    .container { padding: 16px 12px; }
    header { flex-direction: column; gap: 12px; }
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="header-left">
      <h1>Cost Tracker</h1>
      <p>Agent usage monitoring and cost analytics</p>
      <div style="margin-top:8px"><a href="/agents" style="color:#22c55e;text-decoration:none;font-size:13px">Agent Runner &rarr;</a> <a href="/schedule" style="color:#71717a;text-decoration:none;font-size:13px;margin-left:16px">Schedule &rarr;</a></div>
    </div>
    <div class="currency-selector">
      <label for="currency-select">Currency</label>
      <select id="currency-select">
        <option value="USD">USD ($)</option>
        <option value="GBP">GBP (&pound;)</option>
        <option value="EUR">EUR (&euro;)</option>
        <option value="JPY">JPY (&yen;)</option>
        <option value="CAD">CAD (CA$)</option>
        <option value="AUD">AUD (A$)</option>
      </select>
    </div>
  </header>

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
    <div class="claude-section" id="claude-section" style="margin-bottom: 0;">
      <h2>Claude Subscription</h2>
      <div class="sub-type" id="claude-sub-type"></div>
      <div id="claude-content"><div class="claude-loading">Loading usage data...</div></div>
      <div class="usage-history-inner">
        <div class="usage-history-header">
          <div class="usage-history-title">History</div>
          <div class="usage-history-controls">
            <button data-hours="1" class="active">1h</button>
            <button data-hours="3">3h</button>
            <button data-hours="12">12h</button>
            <button data-hours="24">24h</button>
            <button data-hours="72">72h</button>
            <button data-hours="168">7d</button>
          </div>
        </div>
        <div id="usage-history-content"><div class="claude-loading">Loading history...</div></div>
        <div class="usage-history-legend">
          <span><span class="dot" style="background:#60a5fa"></span>5h</span>
          <span><span class="dot" style="background:#a78bfa"></span>7d</span>
          <span><span class="dot" style="background:#f59e0b"></span>Opus</span>
          <span><span class="dot" style="background:#34d399"></span>Sonnet</span>
        </div>
      </div>
    </div>
    <div class="claude-section" id="codex-section" style="margin-bottom: 0;">
      <h2>Codex Subscription</h2>
      <div class="sub-type" id="codex-sub-type"></div>
      <div id="codex-content"><div class="claude-loading">Loading usage data...</div></div>
      <div class="usage-history-inner">
        <div class="usage-history-header">
          <div class="usage-history-title">History</div>
          <div class="usage-history-controls" id="codex-history-controls">
            <button data-hours="1" class="active">1h</button>
            <button data-hours="3">3h</button>
            <button data-hours="12">12h</button>
            <button data-hours="24">24h</button>
            <button data-hours="72">72h</button>
            <button data-hours="168">7d</button>
          </div>
        </div>
        <div id="codex-history-content"><div class="claude-loading">Loading history...</div></div>
        <div class="usage-history-legend">
          <span><span class="dot" style="background:#60a5fa"></span>Primary</span>
          <span><span class="dot" style="background:#a78bfa"></span>Secondary</span>
          <span><span class="dot" style="background:#f59e0b"></span>Code Review</span>
        </div>
      </div>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-card"><div class="stat-label">Today</div><div class="stat-value cost" id="s-today">--</div></div>
    <div class="stat-card"><div class="stat-label">This Week</div><div class="stat-value cost" id="s-week">--</div></div>
    <div class="stat-card"><div class="stat-label">This Month</div><div class="stat-value cost" id="s-month">--</div></div>
    <div class="stat-card"><div class="stat-label">Total Runs</div><div class="stat-value" id="s-runs">--</div></div>
  </div>

  <div class="grid-2">
    <div class="card">
      <h2>Cost by Agent</h2>
      <div class="chart-container"><canvas id="agentChart"></canvas></div>
    </div>
    <div class="card">
      <h2>Daily Cost Trend</h2>
      <div class="chart-container"><canvas id="costChart"></canvas></div>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <h2>Token Usage Over Time</h2>
      <div class="chart-container"><canvas id="tokenChart"></canvas></div>
    </div>
    <div class="card">
      <h2>Cost by Model</h2>
      <div id="modelTable"><div class="loading">Loading...</div></div>
    </div>
  </div>

  <div class="grid-2">
    <div class="card card-full">
      <h2>Recent Runs</h2>
      <div class="filters" id="runsFilters">
        <div class="filter-group">
          <label>Agent</label>
          <select id="filter-agent"><option value="">All</option></select>
        </div>
        <div class="filter-group">
          <label>Model</label>
          <select id="filter-model"><option value="">All</option></select>
        </div>
        <div class="filter-group">
          <label>From</label>
          <input type="date" id="filter-since" />
        </div>
        <div class="filter-group">
          <label>To</label>
          <input type="date" id="filter-until" />
        </div>
        <button class="clear-btn" id="filter-clear">Clear</button>
      </div>
      <div style="overflow-x:auto" id="runsTable"><div class="loading">Loading...</div></div>
    </div>
  </div>

  <div class="card card-full" style="margin-top:0">
    <h2>Settings</h2>
    <div style="display:flex;flex-direction:column;gap:20px">
      <div>
        <div style="color:#a1a1aa;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">API Key</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <code id="api-key-display" style="background:#09090b;border:1px solid #27272a;border-radius:6px;padding:8px 12px;font-size:13px;color:#fafafa;font-family:monospace;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Loading...</code>
          <button onclick="copyApiKey()" style="background:#27272a;border:none;color:#fafafa;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap" id="copy-key-btn">Copy</button>
          <button onclick="regenerateApiKey()" style="background:#7f1d1d;border:none;color:#fca5a5;padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;white-space:nowrap">Regenerate</button>
        </div>
        <div id="api-key-msg" style="font-size:12px;margin-top:6px;color:#71717a"></div>
      </div>
    </div>
  </div>
</div>

<script>
const CURRENCY_SYMBOLS = { USD: '$', GBP: '\\u00a3', EUR: '\\u20ac', JPY: '\\u00a5', CAD: 'CA$', AUD: 'A$' };

let currentCurrency = 'USD';
let exchangeRates = { USD: 1 };
let cachedStats = null;
let cachedTimeseries = null;
let cachedRuns = null;
let charts = {};

const RUNS_PER_PAGE = 15;
let runsPage = 0;
let runsTotal = 0;
let runsFilterAgent = '';
let runsFilterModel = '';
let runsFilterSince = '';
let runsFilterUntil = '';

function getRate() {
  return exchangeRates[currentCurrency] || 1;
}

function getSymbol() {
  return CURRENCY_SYMBOLS[currentCurrency] || '$';
}

function fmt(v) {
  if (v == null) return getSymbol() + '0.00';
  const converted = Number(v) * getRate();
  if (currentCurrency === 'JPY') return getSymbol() + Math.round(converted).toLocaleString();
  return getSymbol() + converted.toFixed(4);
}

function fmtShort(v) {
  const converted = Number(v) * getRate();
  if (currentCurrency === 'JPY') return getSymbol() + Math.round(converted).toLocaleString();
  return getSymbol() + converted.toFixed(2);
}

const fmtInt = v => v == null ? '0' : Number(v).toLocaleString();
const fmtDur = ms => ms == null ? '--' : (ms / 1000).toFixed(1) + 's';
function fmtUsage(before, after) {
  if (before == null && after == null) return '--';
  const b = before != null ? before + '%' : '?';
  const a = after != null ? after + '%' : '?';
  let delta = '';
  if (before != null && after != null) {
    const d = after - before;
    delta = ' (' + (d > 0 ? '+' : '') + d + ')';
  }
  return b + ' &rarr; ' + a + delta;
}

const MODEL_COLORS = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#a855f7','#ec4899','#14b8a6','#f97316'];

const chartDefaults = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#a1a1aa', font: { size: 11 } } } },
  scales: {
    x: { ticks: { color: '#71717a', font: { size: 10 } }, grid: { color: '#27272a40' } },
    y: { ticks: { color: '#71717a', font: { size: 10 } }, grid: { color: '#27272a40' } }
  }
};

function destroyCharts() {
  Object.values(charts).forEach(c => { if (c) c.destroy(); });
  charts = {};
}

function barColor(pct) {
  if (pct >= 80) return '#ef4444';
  if (pct >= 50) return '#f59e0b';
  return '#22c55e';
}

function formatResetTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatResetDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate();
}

// Fit a linear rate from recent snapshots, extrapolate to reset time.
// Returns null when there is not enough signal (fewer than 2 snapshots
// inside lookbackMs, or no time left to reset).
function computeProjection(rows, key, nowMs, resetMs, lookbackMs) {
  if (!Array.isArray(rows) || !resetMs || resetMs <= nowMs) return null;
  const lookbackStart = nowMs - lookbackMs;
  const slice = [];
  for (const r of rows) {
    const t = new Date(r.timestamp.replace(' ', 'T') + 'Z').getTime();
    if (t >= lookbackStart && r[key] != null) slice.push({ t, v: r[key] });
  }
  if (slice.length < 2) return null;
  const first = slice[0], last = slice[slice.length - 1];
  const deltaH = (last.t - first.t) / 3600000;
  if (deltaH <= 0) return null;
  const ratePerHour = (last.v - first.v) / deltaH;
  const hoursToReset = (resetMs - nowMs) / 3600000;
  const projected = last.v + ratePerHour * hoursToReset;
  return { ratePerHour, hoursToReset, projected, current: last.v, samples: slice.length };
}

function renderProjection(p, currentPct) {
  if (!p) return '';
  if (!isFinite(p.projected)) return '';
  const proj = Math.max(0, Math.round(p.projected));
  // Colour: green if well under, amber if approaching, red if will exceed
  let color = '#71717a';
  if (proj >= 100) color = '#ef4444';
  else if (proj >= 85) color = '#f59e0b';
  else if (p.ratePerHour > 0) color = '#22c55e';
  // Describe trajectory
  const rate = p.ratePerHour;
  const rateTxt = Math.abs(rate) < 0.05
    ? 'flat'
    : (rate > 0 ? '+' : '') + rate.toFixed(1) + '%/h';
  return '<div class="claude-bar-projection" style="color:' + color + '">At current rate: ' + proj + '% by reset (' + rateTxt + ')</div>';
}

async function loadClaudeUsage() {
  const container = document.getElementById('claude-content');
  const subType = document.getElementById('claude-sub-type');
  try {
    const [usageRes, snapRows] = await Promise.all([
      fetch('/api/claude-usage').then(r => r.json().then(d => ({ ok: r.ok, data: d }))),
      fetch('/api/claude-usage/snapshots?hours=24').then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
    const data = usageRes.data;
    if (!usageRes.ok) {
      container.innerHTML = '<div class="claude-error">' + (data.error || 'Could not load usage data') + '</div>';
      return;
    }

    if (data._error) {
      container.innerHTML = '<div class="claude-error">' + data._error + (data._detail ? ': ' + data._detail.slice(0, 200) : '') + '</div>';
      return;
    }

    // Show subscription type if available
    if (data.subscription_type || data.subscription_tier) {
      subType.textContent = data.subscription_type || data.subscription_tier;
    }

    const fiveHour = data.five_hour || null;
    const sevenDay = data.seven_day || null;
    const nowMs = Date.now();

    let html = '<div class="claude-bars">';

    // 5-Hour Window
    if (fiveHour) {
      const pct = Math.min(100, Math.round(fiveHour.utilization));
      const color = barColor(pct);
      const resetMs = fiveHour.resets_at ? new Date(fiveHour.resets_at).getTime() : null;
      const proj = computeProjection(snapRows, 'five_hour_util', nowMs, resetMs, 30 * 60 * 1000);
      html += '<div class="claude-bar-group">';
      html += '<div class="claude-bar-label"><span>5-Hour Window</span><span class="pct" style="color:' + color + '">' + pct + '%</span></div>';
      html += '<div class="claude-bar-track"><div class="claude-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
      html += '<div class="claude-bar-reset">Resets at ' + formatResetTime(fiveHour.resets_at) + '</div>';
      html += renderProjection(proj, pct);
      html += '</div>';
    } else {
      html += '<div class="claude-bar-group"><div class="claude-bar-label">5-Hour Window</div><div style="color:#71717a;font-size:13px">No data</div></div>';
    }

    // 7-Day Window
    if (sevenDay) {
      const pct = Math.min(100, Math.round(sevenDay.utilization));
      const color = barColor(pct);
      const resetMs = sevenDay.resets_at ? new Date(sevenDay.resets_at).getTime() : null;
      const proj = computeProjection(snapRows, 'seven_day_util', nowMs, resetMs, 6 * 3600 * 1000);
      html += '<div class="claude-bar-group">';
      html += '<div class="claude-bar-label"><span>7-Day Window</span><span class="pct" style="color:' + color + '">' + pct + '%</span></div>';
      html += '<div class="claude-bar-track"><div class="claude-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
      html += '<div class="claude-bar-reset">Resets on ' + formatResetDate(sevenDay.resets_at) + '</div>';
      html += renderProjection(proj, pct);
      html += '</div>';
    } else {
      html += '<div class="claude-bar-group"><div class="claude-bar-label">7-Day Window</div><div style="color:#71717a;font-size:13px">No data</div></div>';
    }

    html += '</div>';

    // Per-model breakdowns
    const opus = data.seven_day_opus || null;
    const sonnet = data.seven_day_sonnet || null;
    if (opus || sonnet) {
      html += '<div class="claude-model-breakdown">';
      if (opus) {
        html += '<span>Opus 7d: ' + Math.round(opus.utilization) + '%</span>';
      }
      if (sonnet) {
        html += '<span>Sonnet 7d: ' + Math.round(sonnet.utilization) + '%</span>';
      }
      html += '</div>';
    }

    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div class="claude-error">Failed to load: ' + e.message + '</div>';
  }
}

async function loadCodexUsage() {
  const container = document.getElementById('codex-content');
  const subType = document.getElementById('codex-sub-type');
  try {
    const [usageRes, snapRows] = await Promise.all([
      fetch('/api/codex-usage').then(r => r.json().then(d => ({ ok: r.ok, data: d }))),
      fetch('/api/codex-usage/snapshots?hours=24').then(r => r.ok ? r.json() : []).catch(() => []),
    ]);
    const data = usageRes.data;
    if (!usageRes.ok) {
      container.innerHTML = '<div class="claude-error">' + (data.error || 'Could not load usage data') + '</div>';
      return;
    }

    if (data._error) {
      container.innerHTML = '<div class="claude-error">' + data._error + (data._detail ? ': ' + data._detail.slice(0, 200) : '') + '</div>';
      return;
    }

    if (data.plan_type) {
      subType.textContent = data.plan_type.charAt(0).toUpperCase() + data.plan_type.slice(1);
    }

    const rl = data.rate_limit || {};
    const primary = rl.primary_window || null;
    const secondary = rl.secondary_window || null;
    const nowMs = Date.now();

    let html = '<div class="claude-bars">';

    if (primary) {
      const pct = Math.min(100, Math.round(primary.used_percent));
      const color = barColor(pct);
      const windowHrs = Math.round(primary.limit_window_seconds / 3600);
      const resetMins = Math.round(primary.reset_after_seconds / 60);
      const resetMs = nowMs + primary.reset_after_seconds * 1000;
      const proj = computeProjection(snapRows, 'primary_util', nowMs, resetMs, 30 * 60 * 1000);
      html += '<div class="claude-bar-group">';
      html += '<div class="claude-bar-label"><span>' + windowHrs + '-Hour Window</span><span class="pct" style="color:' + color + '">' + pct + '%</span></div>';
      html += '<div class="claude-bar-track"><div class="claude-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
      html += '<div class="claude-bar-reset">Resets in ' + resetMins + ' min</div>';
      html += renderProjection(proj, pct);
      html += '</div>';
    } else {
      html += '<div class="claude-bar-group"><div class="claude-bar-label">Primary Window</div><div style="color:#71717a;font-size:13px">No data</div></div>';
    }

    if (secondary) {
      const pct = Math.min(100, Math.round(secondary.used_percent));
      const color = barColor(pct);
      const windowDays = Math.round(secondary.limit_window_seconds / 86400);
      const resetHrs = Math.round(secondary.reset_after_seconds / 3600);
      const resetMs = nowMs + secondary.reset_after_seconds * 1000;
      const proj = computeProjection(snapRows, 'secondary_util', nowMs, resetMs, 6 * 3600 * 1000);
      html += '<div class="claude-bar-group">';
      html += '<div class="claude-bar-label"><span>' + windowDays + '-Day Window</span><span class="pct" style="color:' + color + '">' + pct + '%</span></div>';
      html += '<div class="claude-bar-track"><div class="claude-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
      html += '<div class="claude-bar-reset">Resets in ' + resetHrs + 'h</div>';
      html += renderProjection(proj, pct);
      html += '</div>';
    } else {
      html += '<div class="claude-bar-group"><div class="claude-bar-label">Secondary Window</div><div style="color:#71717a;font-size:13px">No data</div></div>';
    }

    html += '</div>';

    // Code review limits
    const cr = data.code_review_rate_limit || {};
    if (cr.primary_window) {
      const pct = Math.min(100, Math.round(cr.primary_window.used_percent));
      html += '<div style="margin-top:12px;font-size:12px;color:#a1a1aa;">Code Review: ' + pct + '% used</div>';
    }

    // Credits
    if (data.credits && data.credits.has_credits) {
      html += '<div style="margin-top:8px;font-size:12px;color:#a1a1aa;">Credits: ' + data.credits.balance + '</div>';
    }

    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div class="claude-error">Failed to load: ' + e.message + '</div>';
  }
}

let claudeHistoryHours = 1;
let codexHistoryHours = 1;

const CLAUDE_SERIES = [
  { key: 'five_hour_util', color: '#60a5fa', label: '5h' },
  { key: 'seven_day_util', color: '#a78bfa', label: '7d' },
  { key: 'seven_day_opus_util', color: '#f59e0b', label: 'Opus' },
  { key: 'seven_day_sonnet_util', color: '#34d399', label: 'Sonnet' },
];
const CODEX_SERIES = [
  { key: 'primary_util', color: '#60a5fa', label: 'Primary' },
  { key: 'secondary_util', color: '#a78bfa', label: 'Secondary' },
  { key: 'code_review_util', color: '#f59e0b', label: 'Code Review' },
];

async function loadClaudeHistory() {
  const container = document.getElementById('usage-history-content');
  if (!container) return;
  try {
    const rows = await fetch('/api/claude-usage/snapshots?hours=' + claudeHistoryHours).then(r => r.json());
    if (!Array.isArray(rows) || rows.length === 0) {
      container.innerHTML = '<div class="claude-loading">No snapshots yet — poller writes every 5 min.</div>';
      return;
    }
    renderInteractiveHistory(container, rows, CLAUDE_SERIES, claudeHistoryHours);
  } catch (e) {
    container.innerHTML = '<div class="claude-error">Failed to load: ' + e.message + '</div>';
  }
}

async function loadCodexHistory() {
  const container = document.getElementById('codex-history-content');
  if (!container) return;
  try {
    const rows = await fetch('/api/codex-usage/snapshots?hours=' + codexHistoryHours).then(r => r.json());
    if (!Array.isArray(rows) || rows.length === 0) {
      container.innerHTML = '<div class="claude-loading">No snapshots yet — poller writes every 5 min.</div>';
      return;
    }
    renderInteractiveHistory(container, rows, CODEX_SERIES, codexHistoryHours);
  } catch (e) {
    container.innerHTML = '<div class="claude-error">Failed to load: ' + e.message + '</div>';
  }
}

function renderInteractiveHistory(container, rows, series, hours) {
  const W = 800, H = 180, pad = { l: 32, r: 12, t: 12, b: 24 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const times = rows.map(r => new Date(r.timestamp.replace(' ', 'T') + 'Z').getTime());
  const tMax = Date.now();
  const tMin = tMax - hours * 3600 * 1000;
  const span = Math.max(1, tMax - tMin);

  container.innerHTML =
    '<div class="usage-chart-wrapper">' +
    renderUsageHistorySvg(rows, series, hours, { W, H, pad, plotW, plotH, tMin, tMax, span, times }) +
    '<div class="usage-tooltip"></div>' +
    '</div>';

  const wrapper = container.querySelector('.usage-chart-wrapper');
  const svgEl = wrapper.querySelector('svg');
  const hoverLine = svgEl.querySelector('.hover-line');
  const tooltip = wrapper.querySelector('.usage-tooltip');

  wrapper.addEventListener('mousemove', (e) => {
    const rect = svgEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    if (relX < 0 || relX > rect.width) return;
    const fracX = relX / rect.width;
    const svgX = fracX * W;
    if (svgX < pad.l || svgX > W - pad.r) {
      hoverLine.style.display = 'none';
      tooltip.style.display = 'none';
      return;
    }
    const t = tMin + ((svgX - pad.l) / plotW) * span;
    // Find nearest snapshot by time
    let nearestIdx = -1;
    let nearestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(times[i] - t);
      if (d < nearestDiff) { nearestDiff = d; nearestIdx = i; }
    }
    if (nearestIdx < 0) return;
    const row = rows[nearestIdx];
    hoverLine.setAttribute('x1', String(svgX));
    hoverLine.setAttribute('x2', String(svgX));
    hoverLine.style.display = '';
    // Tooltip content
    const tFmt = new Date(times[nearestIdx]).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    let html = '<div class="usage-tooltip-time">' + tFmt + '</div>';
    for (const s of series) {
      const v = row[s.key];
      const str = v == null ? '—' : Math.round(v) + '%';
      html += '<div class="usage-tooltip-row"><span><span class="dot" style="background:' + s.color + '"></span>' + s.label + '</span><span class="val">' + str + '</span></div>';
    }
    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    // Position tooltip: right of cursor if space, otherwise left
    const tooltipW = tooltip.offsetWidth;
    const leftPx = relX + 14 + tooltipW > rect.width ? relX - tooltipW - 14 : relX + 14;
    tooltip.style.left = Math.max(0, leftPx) + 'px';
    tooltip.style.top = '4px';
  });

  wrapper.addEventListener('mouseleave', () => {
    hoverLine.style.display = 'none';
    tooltip.style.display = 'none';
  });
}

function renderUsageHistorySvg(rows, series, hours, layout) {
  const { W, H, pad, plotW, plotH, tMin, tMax, span, times } = layout || (function() {
    const W = 800, H = 180, pad = { l: 32, r: 12, t: 12, b: 24 };
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const times = rows.map(r => new Date(r.timestamp.replace(' ', 'T') + 'Z').getTime());
    const tMax = Date.now();
    const tMin = tMax - hours * 3600 * 1000;
    const span = Math.max(1, tMax - tMin);
    return { W, H, pad, plotW, plotH, tMin, tMax, span, times };
  })();
  const x = t => pad.l + ((t - tMin) / span) * plotW;
  const y = v => pad.t + plotH - (Math.min(100, Math.max(0, v)) / 100) * plotH;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">';
  // Gridlines at 25/50/75/100
  for (const g of [0, 25, 50, 75, 100]) {
    const gy = y(g);
    svg += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + gy + '" y2="' + gy + '" stroke="#27272a" stroke-width="1" />';
    svg += '<text x="' + (pad.l - 6) + '" y="' + (gy + 3) + '" fill="#71717a" font-size="10" text-anchor="end">' + g + '%</text>';
  }
  // Time axis labels (first / middle / last) — spans the full selected window
  const fmtTime = ms => {
    const d = new Date(ms);
    if (hours >= 48) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  for (const frac of [0, 0.5, 1]) {
    const t = tMin + span * frac;
    const tx = x(t);
    svg += '<text x="' + tx + '" y="' + (H - 6) + '" fill="#71717a" font-size="10" text-anchor="middle">' + fmtTime(t) + '</text>';
  }

  // Monotone cubic Hermite interpolation -> cubic Bezier 'd' string.
  // Preserves monotonicity (no overshoot), looks smooth across the whole set.
  function smoothPath(pts) {
    const n = pts.length;
    if (n === 0) return '';
    if (n === 1) return '';
    if (n === 2) return 'M' + pts[0].x + ',' + pts[0].y + ' L' + pts[1].x + ',' + pts[1].y;

    const dx = new Array(n - 1), dy = new Array(n - 1), m = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1].x - pts[i].x;
      dy[i] = pts[i + 1].y - pts[i].y;
      m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
    }
    const tan = new Array(n);
    tan[0] = m[0];
    tan[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) tan[i] = 0;
      else tan[i] = (m[i - 1] + m[i]) / 2;
    }
    // Fritsch–Carlson monotonicity fix
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
      const a = tan[i] / m[i], b = tan[i + 1] / m[i];
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        tan[i] = t * a * m[i];
        tan[i + 1] = t * b * m[i];
      }
    }
    let d = 'M' + pts[0].x + ',' + pts[0].y;
    for (let i = 0; i < n - 1; i++) {
      const c1x = pts[i].x + dx[i] / 3;
      const c1y = pts[i].y + tan[i] * dx[i] / 3;
      const c2x = pts[i + 1].x - dx[i] / 3;
      const c2y = pts[i + 1].y - tan[i + 1] * dx[i] / 3;
      d += ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + pts[i + 1].x + ',' + pts[i + 1].y;
    }
    return d;
  }

  // Series — draw smooth curve + small points
  for (const s of series) {
    // Collect non-null points, splitting into contiguous segments on gaps
    const segments = [];
    let current = [];
    rows.forEach((r, i) => {
      const v = r[s.key];
      if (v == null) {
        if (current.length) { segments.push(current); current = []; }
        return;
      }
      current.push({ x: x(times[i]), y: y(v) });
    });
    if (current.length) segments.push(current);

    for (const seg of segments) {
      const d = smoothPath(seg);
      if (d) {
        svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />';
      }
    }
  }
  // Hover line — hidden until mousemove sets x1/x2 and display
  svg += '<line class="hover-line" x1="0" x2="0" y1="' + pad.t + '" y2="' + (pad.t + plotH) + '" stroke="#d4d4d8" stroke-width="1" stroke-dasharray="3,3" style="display:none" />';
  svg += '</svg>';
  return svg;
}

function renderData() {
  const stats = cachedStats;
  const ts = cachedTimeseries;
  const runs = cachedRuns;
  if (!stats) return;

  document.getElementById('s-today').textContent = fmt(stats.cost_today);
  document.getElementById('s-week').textContent = fmt(stats.cost_this_week);
  document.getElementById('s-month').textContent = fmt(stats.cost_this_month);
  document.getElementById('s-runs').textContent = fmtInt(stats.total_runs);

  destroyCharts();

  // Agent bar chart
  if (stats.by_agent && stats.by_agent.length) {
    charts.agent = new Chart(document.getElementById('agentChart'), {
      type: 'bar',
      data: {
        labels: stats.by_agent.map(a => a.agent),
        datasets: [{
          label: 'Cost (' + getSymbol() + ')', data: stats.by_agent.map(a => Number(a.cost) * getRate()),
          backgroundColor: stats.by_agent.map((_, i) => MODEL_COLORS[i % MODEL_COLORS.length] + '80'),
          borderColor: stats.by_agent.map((_, i) => MODEL_COLORS[i % MODEL_COLORS.length]),
          borderWidth: 1, borderRadius: 6, maxBarThickness: 48,
        }]
      },
      options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false } },
        scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, ticks: { ...chartDefaults.scales.y.ticks, callback: v => fmtShort(v / getRate()) } } }
      }
    });
  }

  // Daily cost trend
  if (ts && ts.length) {
    charts.cost = new Chart(document.getElementById('costChart'), {
      type: 'line',
      data: {
        labels: ts.map(d => d.date.slice(5)),
        datasets: [{
          label: 'Daily Cost (' + getSymbol() + ')', data: ts.map(d => Number(d.cost) * getRate()),
          borderColor: '#22c55e', backgroundColor: '#22c55e18',
          fill: true, tension: 0.3, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2,
        }]
      },
      options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false } },
        scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, ticks: { ...chartDefaults.scales.y.ticks, callback: v => fmtShort(v / getRate()) } } }
      }
    });
  }

  // Token usage stacked area
  if (ts && ts.length) {
    charts.token = new Chart(document.getElementById('tokenChart'), {
      type: 'line',
      data: {
        labels: ts.map(d => d.date.slice(5)),
        datasets: [
          { label: 'Input', data: ts.map(d => d.input_tokens), borderColor: '#3b82f6', backgroundColor: '#3b82f620', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
          { label: 'Output', data: ts.map(d => d.output_tokens), borderColor: '#22c55e', backgroundColor: '#22c55e20', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
          { label: 'Cache Read', data: ts.map(d => d.cache_read), borderColor: '#f59e0b', backgroundColor: '#f59e0b20', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
          { label: 'Cache Create', data: ts.map(d => d.cache_creation), borderColor: '#a855f7', backgroundColor: '#a855f720', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 1.5 },
        ]
      },
      options: { ...chartDefaults,
        scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, stacked: true, ticks: { ...chartDefaults.scales.y.ticks, callback: v => v >= 1000000 ? (v/1000000).toFixed(1)+'M' : v >= 1000 ? (v/1000).toFixed(0)+'K' : v } } }
      }
    });
  }

  // Model table
  const mt = document.getElementById('modelTable');
  if (stats.by_model && stats.by_model.length) {
    mt.innerHTML = '<table><thead><tr><th>Model</th><th>Runs</th><th>Cost</th></tr></thead><tbody>' +
      stats.by_model.map((m, i) => '<tr><td><span class="dot" style="background:' + MODEL_COLORS[i % MODEL_COLORS.length] + '"></span>' + (m.model || 'unknown') + '</td><td class="token-cell">' + fmtInt(m.runs) + '</td><td class="cost-cell">' + fmt(m.cost) + '</td></tr>').join('') +
      '</tbody></table>';
  } else {
    mt.innerHTML = '<div class="empty-state">No data yet</div>';
  }

  // Runs table
  renderRunsTable();
}

function renderRunsTable() {
  const rt = document.getElementById('runsTable');
  const runs = cachedRuns;
  if (runs && runs.length) {
    const totalPages = Math.ceil(runsTotal / RUNS_PER_PAGE);
    rt.innerHTML = '<table><thead><tr><th>Time</th><th>Agent</th><th>Model</th><th>Cost</th><th>In Tokens</th><th>Out Tokens</th><th>Cache R</th><th>Cache W</th><th>Duration</th><th>5h Usage</th><th>7d Usage</th></tr></thead><tbody>' +
      runs.map(r => '<tr><td style="white-space:nowrap;color:#71717a;font-size:12px">' + (r.timestamp || '') + '</td><td><span class="agent-badge" style="cursor:pointer" onclick="openAgentModal(&quot;' + (r.agent || '') + '_agent&quot;, &quot;' + (r.agent || '') + '&quot;)">' + (r.agent || '') + '</span></td><td><span class="model-badge">' + (r.model || '') + '</span></td><td class="cost-cell">' + fmt(r.cost_usd) + '</td><td class="token-cell">' + fmtInt(r.input_tokens) + '</td><td class="token-cell">' + fmtInt(r.output_tokens) + '</td><td class="token-cell">' + fmtInt(r.cache_read) + '</td><td class="token-cell">' + fmtInt(r.cache_creation) + '</td><td class="duration">' + fmtDur(r.duration_ms) + '</td><td class="token-cell" style="white-space:nowrap">' + fmtUsage(r.usage_5h_before, r.usage_5h_after) + '</td><td class="token-cell" style="white-space:nowrap">' + fmtUsage(r.usage_7d_before, r.usage_7d_after) + '</td></tr>').join('') +
      '</tbody></table>' +
      '<div class="pagination">' +
        '<button id="runs-prev"' + (runsPage === 0 ? ' disabled' : '') + '>&larr; Prev</button>' +
        '<span class="page-info">Page ' + (runsPage + 1) + ' of ' + totalPages + ' (' + runsTotal + ' runs)</span>' +
        '<button id="runs-next"' + (runsPage >= totalPages - 1 ? ' disabled' : '') + '>Next &rarr;</button>' +
      '</div>';
    document.getElementById('runs-prev').addEventListener('click', () => { if (runsPage > 0) { runsPage--; loadRuns(); } });
    document.getElementById('runs-next').addEventListener('click', () => { if (runsPage < totalPages - 1) { runsPage++; loadRuns(); } });
  } else {
    rt.innerHTML = '<div class="empty-state">No runs recorded yet</div>';
  }
}

function buildRunsQuery(extra) {
  const params = new URLSearchParams({ limit: RUNS_PER_PAGE, offset: runsPage * RUNS_PER_PAGE, ...extra });
  if (runsFilterAgent) params.set('agent', runsFilterAgent);
  if (runsFilterModel) params.set('model', runsFilterModel);
  if (runsFilterSince) params.set('since', runsFilterSince);
  if (runsFilterUntil) params.set('until', runsFilterUntil);
  return params.toString();
}

async function loadRuns() {
  const data = await fetch('/api/runs?' + buildRunsQuery()).then(r => r.json());
  cachedRuns = data.rows;
  runsTotal = data.total;
  renderRunsTable();
}

async function load() {
  // Fetch settings and exchange rates first
  try {
    const [settingsRes, ratesRes] = await Promise.all([
      fetch('/api/settings').then(r => r.json()).catch(() => ({})),
      fetch('/api/rates').then(r => r.json()).catch(() => ({ USD: 1 })),
    ]);
    if (settingsRes && settingsRes.currency) {
      currentCurrency = settingsRes.currency;
    }
    exchangeRates = ratesRes;
    document.getElementById('currency-select').value = currentCurrency;
  } catch (e) {
    console.warn('Failed to load settings/rates, using defaults', e);
  }

  // Fetch main data
  const [stats, ts, runsData] = await Promise.all([
    fetch('/api/stats').then(r => r.json()),
    fetch('/api/stats/timeseries?days=30').then(r => r.json()),
    fetch('/api/runs?limit=' + RUNS_PER_PAGE + '&offset=0').then(r => r.json()),
  ]);

  cachedStats = stats;
  cachedTimeseries = ts;
  cachedRuns = runsData.rows;
  runsTotal = runsData.total;

  renderData();
  loadClaudeUsage();
  loadCodexUsage();
  loadClaudeHistory();
  loadCodexHistory();

  function bindHistoryButtons(selector, setHours, reload) {
    const group = document.querySelector(selector);
    if (!group) return;
    group.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setHours(parseInt(btn.dataset.hours));
        reload();
      });
    });
  }
  bindHistoryButtons('#claude-section .usage-history-controls', h => { claudeHistoryHours = h; }, loadClaudeHistory);
  bindHistoryButtons('#codex-history-controls', h => { codexHistoryHours = h; }, loadCodexHistory);

  // Populate filter dropdowns
  try {
    const filters = await fetch('/api/filters').then(r => r.json());
    const agentSel = document.getElementById('filter-agent');
    const modelSel = document.getElementById('filter-model');
    filters.agents.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; agentSel.appendChild(o); });
    filters.models.forEach(m => { const o = document.createElement('option'); o.value = m; o.textContent = m; modelSel.appendChild(o); });
  } catch (e) { console.warn('Failed to load filter options', e); }

  // Filter event listeners
  function applyFilters() {
    runsFilterAgent = document.getElementById('filter-agent').value;
    runsFilterModel = document.getElementById('filter-model').value;
    runsFilterSince = document.getElementById('filter-since').value;
    runsFilterUntil = document.getElementById('filter-until').value;
    runsPage = 0;
    loadRuns();
  }
  document.getElementById('filter-agent').addEventListener('change', applyFilters);
  document.getElementById('filter-model').addEventListener('change', applyFilters);
  document.getElementById('filter-since').addEventListener('change', applyFilters);
  document.getElementById('filter-until').addEventListener('change', applyFilters);
  document.getElementById('filter-clear').addEventListener('click', () => {
    document.getElementById('filter-agent').value = '';
    document.getElementById('filter-model').value = '';
    document.getElementById('filter-since').value = '';
    document.getElementById('filter-until').value = '';
    applyFilters();
  });
}

// Currency change handler
document.getElementById('currency-select').addEventListener('change', async function(e) {
  currentCurrency = e.target.value;
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: currentCurrency }),
    });
  } catch (err) {
    console.warn('Failed to save currency setting', err);
  }
  renderData();
});

load();

async function refresh() {
  try {
    const [stats, ts] = await Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/stats/timeseries?days=30').then(r => r.json()),
    ]);
    cachedStats = stats;
    cachedTimeseries = ts;
    renderData();
    loadClaudeUsage();
    loadCodexUsage();
    loadClaudeHistory();
    loadCodexHistory();
  } catch (e) { console.warn('Refresh failed', e); }
}
setInterval(refresh, 30000);

// API Key settings
async function loadApiKey() {
  try {
    const res = await fetch('/api/settings/api-key');
    const data = await res.json();
    document.getElementById('api-key-display').textContent = data.key || '(not set)';
  } catch(e) {
    document.getElementById('api-key-display').textContent = '(error loading)';
  }
}

async function copyApiKey() {
  const key = document.getElementById('api-key-display').textContent;
  try {
    await navigator.clipboard.writeText(key);
    const btn = document.getElementById('copy-key-btn');
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  } catch(e) {
    alert('Copy failed — select and copy manually.');
  }
}

async function regenerateApiKey() {
  if (!confirm('Regenerate API key? The old key will stop working immediately and all agents will need updating.')) return;
  const msg = document.getElementById('api-key-msg');
  msg.style.color = '#71717a';
  msg.textContent = 'Generating...';
  try {
    const res = await fetch('/api/settings/api-key/generate', { method: 'POST' });
    const data = await res.json();
    if (data.key) {
      document.getElementById('api-key-display').textContent = data.key;
      msg.style.color = '#22c55e';
      msg.textContent = 'New key generated. Update your agents with the new key.';
    } else {
      msg.style.color = '#f87171';
      msg.textContent = 'Error: ' + (data.error || 'unknown error');
    }
  } catch(e) {
    msg.style.color = '#f87171';
    msg.textContent = 'Request failed: ' + e.message;
  }
}

loadApiKey();
</script>
${agentModalSnippet()}
</body>
</html>`;
}
