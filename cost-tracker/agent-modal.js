export function agentModalSnippet() {
  return `
<style>
  .modal-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    z-index: 100; align-items: center; justify-content: center;
    backdrop-filter: blur(4px);
  }
  .modal-overlay.open { display: flex; }
  .modal {
    background: #18181b; border: 1px solid #27272a; border-radius: 16px;
    width: 90%; max-width: 680px; max-height: 85vh; overflow-y: auto;
    padding: 28px 32px; position: relative;
  }
  .modal-close {
    position: absolute; top: 16px; right: 20px; background: none; border: none;
    color: #71717a; font-size: 20px; cursor: pointer; padding: 4px 8px;
  }
  .modal-close:hover { color: #fafafa; }
  .modal h2 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
  .modal .subtitle { color: #71717a; font-size: 13px; margin-bottom: 20px; }
  .modal-loading { color: #71717a; font-size: 14px; padding: 40px 0; text-align: center; }

  .stat-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px;
  }
  .stat-card {
    background: #09090b; border: 1px solid #27272a; border-radius: 10px; padding: 14px 16px;
  }
  .stat-card .label { font-size: 11px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; }
  .stat-card .value { font-size: 20px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
  .stat-card .sub { font-size: 11px; color: #52525b; margin-top: 2px; }

  .section-title { font-size: 13px; font-weight: 600; color: #a1a1aa; margin: 20px 0 10px; text-transform: uppercase; letter-spacing: 0.05em; }

  .trend-chart-container { height: 140px; margin-bottom: 8px; }

  .recent-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .recent-table th {
    text-align: left; padding: 6px 8px; color: #71717a; border-bottom: 1px solid #27272a;
    font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .recent-table td { padding: 6px 8px; border-bottom: 1px solid #1f1f23; font-variant-numeric: tabular-nums; }
  .recent-table tr:last-child td { border-bottom: none; }
  .recent-table .cost { color: #22c55e; }
  .recent-table .tokens { color: #a1a1aa; }

  .modal-pagination {
    display: flex; align-items: center; justify-content: center; gap: 12px;
    margin-top: 12px; font-size: 12px; color: #71717a;
  }
  .modal-pagination button {
    background: #27272a; border: none; color: #fafafa; padding: 4px 12px;
    border-radius: 6px; font-size: 12px; cursor: pointer;
  }
  .modal-pagination button:hover:not(:disabled) { background: #3f3f46; }
  .modal-pagination button:disabled { opacity: 0.3; cursor: default; }
</style>

<div class="modal-overlay" id="agentModal">
  <div class="modal">
    <button class="modal-close" onclick="closeAgentModal()">&times;</button>
    <div id="modalContent"><p class="modal-loading">Loading...</p></div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
var _modalState = { agentName: '', displayName: '', page: 0, perPage: 10, total: 0 };

function scriptPathToAgentName(scriptPath) {
  return scriptPath.split('/').pop().replace(/_agent$/, '');
}

function closeAgentModal() {
  document.getElementById('agentModal').classList.remove('open');
  if (window._modalChart) { window._modalChart.destroy(); window._modalChart = null; }
}

document.getElementById('agentModal').addEventListener('click', function(e) {
  if (e.target === this) closeAgentModal();
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeAgentModal();
});

function fmtCost(v) { return '$' + (v || 0).toFixed(4); }
function fmtInt(v) { return Math.round(v || 0).toLocaleString(); }
function fmtDur(ms) { return ((ms || 0) / 1000).toFixed(1) + 's'; }
function fmtDelta(v) { if (v == null) return '-'; var s = v >= 0 ? '+' : ''; return s + v.toFixed(1) + '%'; }
function fmtDate(ts) {
  if (!ts) return '-';
  var d = new Date(ts + 'Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function renderRunRows(runs) {
  return runs.map(function(r) {
    var d5 = (r.usage_5h_before != null && r.usage_5h_after != null) ? fmtDelta(r.usage_5h_after - r.usage_5h_before) : '-';
    var d7 = (r.usage_7d_before != null && r.usage_7d_after != null) ? fmtDelta(r.usage_7d_after - r.usage_7d_before) : '-';
    return '<tr><td>' + fmtDate(r.timestamp) + '</td><td>' + (r.model || '-') + '</td><td class="cost">' + fmtCost(r.cost_usd) + '</td><td class="tokens">' + fmtInt(r.input_tokens) + '</td><td class="tokens">' + fmtInt(r.output_tokens) + '</td><td>' + fmtDur(r.duration_ms) + '</td><td>' + d5 + '</td><td>' + d7 + '</td></tr>';
  }).join('');
}

async function loadModalPage(page) {
  _modalState.page = page;
  var offset = page * _modalState.perPage;
  var res = await fetch('/api/agent-stats/' + encodeURIComponent(_modalState.agentName) + '?limit=' + _modalState.perPage + '&offset=' + offset);
  var data = await res.json();
  _modalState.total = data.recentTotal;
  var totalPages = Math.ceil(_modalState.total / _modalState.perPage);

  var container = document.getElementById('modalRunsBody');
  container.innerHTML = renderRunRows(data.recent);

  var pag = document.getElementById('modalPagination');
  pag.innerHTML =
    '<button' + (page === 0 ? ' disabled' : '') + ' onclick="loadModalPage(' + (page - 1) + ')">&larr; Prev</button>' +
    '<span>Page ' + (page + 1) + ' of ' + totalPages + '</span>' +
    '<button' + (page >= totalPages - 1 ? ' disabled' : '') + ' onclick="loadModalPage(' + (page + 1) + ')">Next &rarr;</button>';
}

async function openAgentModal(scriptPath, displayName) {
  var modal = document.getElementById('agentModal');
  var content = document.getElementById('modalContent');
  modal.classList.add('open');
  content.innerHTML = '<p class="modal-loading">Loading...</p>';

  var agentName = scriptPathToAgentName(scriptPath);
  _modalState.agentName = agentName;
  _modalState.displayName = displayName || agentName;
  _modalState.page = 0;

  try {
    var res = await fetch('/api/agent-stats/' + encodeURIComponent(agentName) + '?limit=' + _modalState.perPage + '&offset=0');
    var data = await res.json();
    var s = data.summary;
    _modalState.total = data.recentTotal;
    var totalPages = Math.ceil(_modalState.total / _modalState.perPage);

    content.innerHTML =
      '<h2>' + _modalState.displayName + '</h2>' +
      '<p class="subtitle">' + s.total_runs + ' runs &middot; First: ' + fmtDate(s.first_run) + ' &middot; Last: ' + fmtDate(s.last_run) + '</p>' +

      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="label">Avg Cost</div><div class="value">' + fmtCost(s.avg_cost) + '</div><div class="sub">Total: ' + fmtCost(s.total_cost) + '</div></div>' +
        '<div class="stat-card"><div class="label">Avg Duration</div><div class="value">' + fmtDur(s.avg_duration_ms) + '</div></div>' +
        '<div class="stat-card"><div class="label">Avg Tokens</div><div class="value">' + fmtInt(s.avg_input_tokens + s.avg_output_tokens) + '</div><div class="sub">In: ' + fmtInt(s.avg_input_tokens) + ' Out: ' + fmtInt(s.avg_output_tokens) + '</div></div>' +
      '</div>' +

      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="label">Avg Cache Read</div><div class="value">' + fmtInt(s.avg_cache_read) + '</div></div>' +
        '<div class="stat-card"><div class="label">Avg Cache Write</div><div class="value">' + fmtInt(s.avg_cache_creation) + '</div></div>' +
        '<div class="stat-card"><div class="label">Total Tokens</div><div class="value">' + fmtInt(s.total_input_tokens + s.total_output_tokens) + '</div></div>' +
      '</div>' +

      '<div class="stat-grid">' +
        '<div class="stat-card"><div class="label">Avg 5h Usage Delta</div><div class="value">' + fmtDelta(s.avg_usage_5h_delta) + '</div><div class="sub">per run</div></div>' +
        '<div class="stat-card"><div class="label">Avg 7d Usage Delta</div><div class="value">' + fmtDelta(s.avg_usage_7d_delta) + '</div><div class="sub">per run</div></div>' +
        '<div class="stat-card"><div class="label">Runs</div><div class="value">' + s.total_runs + '</div></div>' +
      '</div>' +

      '<p class="section-title">Cost Trend (30d)</p>' +
      '<div class="trend-chart-container"><canvas id="trendChart"></canvas></div>' +

      '<p class="section-title">Recent Runs</p>' +
      '<table class="recent-table"><thead><tr><th>Time</th><th>Model</th><th>Cost</th><th>In</th><th>Out</th><th>Duration</th><th>5h \u0394</th><th>7d \u0394</th></tr></thead><tbody id="modalRunsBody">' +
      renderRunRows(data.recent) +
      '</tbody></table>' +
      '<div class="modal-pagination" id="modalPagination">' +
        '<button disabled>&larr; Prev</button>' +
        '<span>Page 1 of ' + totalPages + '</span>' +
        '<button' + (totalPages <= 1 ? ' disabled' : '') + ' onclick="loadModalPage(1)">Next &rarr;</button>' +
      '</div>';

    // Render trend chart
    if (data.trend.length > 1) {
      if (window._modalChart) window._modalChart.destroy();
      window._modalChart = new Chart(document.getElementById('trendChart'), {
        type: 'line',
        data: {
          labels: data.trend.map(function(d) { return d.date; }),
          datasets: [
            { label: 'Avg Cost', data: data.trend.map(function(d) { return d.avg_cost; }), borderColor: '#22c55e', backgroundColor: '#22c55e20', fill: true, tension: 0.3, pointRadius: 3, borderWidth: 1.5, yAxisID: 'y' },
            { label: 'Avg Tokens', data: data.trend.map(function(d) { return d.avg_input_tokens + d.avg_output_tokens; }), borderColor: '#3b82f6', backgroundColor: '#3b82f620', fill: false, tension: 0.3, pointRadius: 3, borderWidth: 1.5, yAxisID: 'y1' },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: '#71717a', font: { size: 11 } } } },
          scales: {
            x: { ticks: { color: '#52525b', font: { size: 10 } }, grid: { color: '#1f1f23' } },
            y: { position: 'left', ticks: { color: '#22c55e', font: { size: 10 }, callback: function(v) { return '$' + v.toFixed(2); } }, grid: { color: '#1f1f23' } },
            y1: { position: 'right', ticks: { color: '#3b82f6', font: { size: 10 }, callback: function(v) { return (v/1000).toFixed(0) + 'k'; } }, grid: { display: false } },
          }
        }
      });
    }
  } catch(e) {
    content.innerHTML = '<p class="modal-loading">Failed to load: ' + e.message + '</p>';
  }
}
</script>`;
}
