import { agentModalSnippet } from './agent-modal.js';

export function renderAgentDashboard() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agent Runner</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #09090b; color: #fafafa; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 800px; margin: 0 auto; padding: 24px 20px; }
  header { margin-bottom: 32px; }
  header h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.025em; }
  header p { color: #71717a; font-size: 14px; margin-top: 4px; }
  .nav { margin-bottom: 24px; }
  .nav a { color: #71717a; text-decoration: none; font-size: 13px; margin-right: 16px; }
  .nav a:hover { color: #fafafa; }
  .agents { display: grid; gap: 12px; }
  .agent-card {
    background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 20px 24px;
    display: flex; align-items: center; justify-content: space-between;
    transition: border-color 0.2s;
  }
  .agent-card:hover { border-color: #3f3f46; }
  .agent-info h3 { font-size: 15px; font-weight: 600; }
  .agent-info p { font-size: 12px; color: #71717a; margin-top: 2px; }
  .agent-info .disabled-tag { color: #ef4444; font-size: 11px; margin-left: 8px; }
  .agent-actions { display: flex; align-items: center; gap: 12px; }
  .run-btn {
    background: #22c55e; border: none; color: #000; padding: 8px 20px;
    border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: opacity 0.2s;
  }
  .run-btn:hover:not(:disabled) { opacity: 0.85; }
  .run-btn:disabled { opacity: 0.4; cursor: default; }
  .status {
    font-size: 12px; color: #71717a; min-width: 120px; text-align: right;
  }
  .status.running { color: #f59e0b; }
  .status.success { color: #22c55e; }
  .status.failed { color: #ef4444; }
  .loading { color: #71717a; font-size: 14px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Agent Runner</h1>
    <p>Manually trigger agent runs</p>
  </header>
  <div class="nav">
    <a href="/">Cost Dashboard</a>
    <a href="/agents">Agent Runner</a>
    <a href="/schedule">Schedule</a>
  </div>
  <div class="agents" id="agents"><p class="loading">Loading schedules...</p></div>
</div>
<script>
// Windmill cron: 1=Mon...7=Sun
const DAYS = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun', 0: 'Sun' };

function describeCron(cron) {
  // cron format: sec min hour dom month dow
  const parts = cron.split(/\\s+/);
  if (parts.length < 6) return cron;
  const [, min, hour, , , dow] = parts;

  if (hour.startsWith('*/')) {
    return 'Every ' + hour.slice(2) + 'h';
  }
  const timeStr = hour.padStart(2, '0') + ':' + min.padStart(2, '0');
  if (dow === '*') return 'Daily ' + timeStr;
  const dayList = dow.split(',').map(d => DAYS[parseInt(d)] || d);
  if (dayList.length === 6) return 'Mon\u2013Sat ' + timeStr;
  return dayList.join(', ') + ' ' + timeStr;
}

async function loadAgents() {
  const container = document.getElementById('agents');
  try {
    const [schedRes, scriptsRes] = await Promise.all([
      fetch('/api/schedules'),
      fetch('/api/scripts'),
    ]);
    const schedules = await schedRes.json();
    const scripts = await scriptsRes.json();

    // Build name lookup from scripts
    const scriptNames = {};
    scripts.forEach(s => { scriptNames[s.path] = s.summary; });

    // Also get scripts that have no schedule
    const scheduledPaths = new Set(schedules.map(s => s.script_path));

    container.innerHTML = '';

    // Show scheduled agents first
    schedules.forEach(s => {
      const name = scriptNames[s.script_path] || s.script_path.split('/').pop().replace(/_/g, ' ');
      const scheduleDesc = describeCron(s.schedule);
      const disabledTag = s.enabled ? '' : '<span class="disabled-tag">(disabled)</span>';
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.innerHTML =
        '<div class="agent-info" style="cursor:pointer" onclick="openAgentModal(\\'' + s.script_path + '\\', \\'' + name.replace(/'/g, "\\\\'") + '\\')">' +
          '<h3>' + name + disabledTag + '</h3>' +
          '<p>Schedule: ' + scheduleDesc + '</p>' +
        '</div>' +
        '<div class="agent-actions">' +
          '<span class="status" id="status-' + s.script_path + '"></span>' +
          '<button class="run-btn" id="btn-' + s.script_path + '" onclick="runAgent(\\'' + s.script_path + '\\')">Run Now</button>' +
        '</div>';
      container.appendChild(card);
    });

    // Show unscheduled scripts
    scripts.forEach(s => {
      if (scheduledPaths.has(s.path)) return;
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.innerHTML =
        '<div class="agent-info" style="cursor:pointer" onclick="openAgentModal(\\'' + s.path + '\\', \\'' + s.summary.replace(/'/g, "\\\\'") + '\\')">' +
          '<h3>' + s.summary + '</h3>' +
          '<p>No schedule</p>' +
        '</div>' +
        '<div class="agent-actions">' +
          '<span class="status" id="status-' + s.path + '"></span>' +
          '<button class="run-btn" id="btn-' + s.path + '" onclick="runAgent(\\'' + s.path + '\\')">Run Now</button>' +
        '</div>';
      container.appendChild(card);
    });

  } catch(e) {
    container.innerHTML = '<p class="loading">Failed to load: ' + e.message + '</p>';
  }
}

async function runAgent(path) {
  const btn = document.getElementById('btn-' + path);
  const status = document.getElementById('status-' + path);
  btn.disabled = true;
  btn.textContent = 'Running...';
  status.className = 'status running';
  status.textContent = 'Starting...';

  try {
    const res = await fetch('/api/agents/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script_path: path }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    const jobId = data.job_id.replace(/"/g, '');
    status.textContent = 'Running...';

    const poll = setInterval(async () => {
      try {
        const jr = await fetch('/api/agents/job/' + jobId);
        const job = await jr.json();
        if (job.type === 'CompletedJob') {
          clearInterval(poll);
          btn.disabled = false;
          btn.textContent = 'Run Now';
          if (job.success) {
            status.className = 'status success';
            const dur = job.duration_ms ? (job.duration_ms / 1000).toFixed(1) + 's' : '';
            status.textContent = 'Done ' + dur;
          } else {
            status.className = 'status failed';
            status.textContent = 'Failed';
          }
        }
      } catch(e) {}
    }, 5000);
  } catch(e) {
    btn.disabled = false;
    btn.textContent = 'Run Now';
    status.className = 'status failed';
    status.textContent = 'Error: ' + e.message;
  }
}

loadAgents();
</script>
${agentModalSnippet()}
</body>
</html>`;
}
