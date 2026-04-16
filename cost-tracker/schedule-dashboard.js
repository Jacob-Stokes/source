import { agentModalSnippet } from './agent-modal.js';

export function renderScheduleDashboard() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Schedule</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: #09090b; color: #fafafa; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 1100px; margin: 0 auto; padding: 24px 20px; }
  header { margin-bottom: 32px; }
  header h1 { font-size: 24px; font-weight: 600; letter-spacing: -0.025em; }
  header p { color: #71717a; font-size: 14px; margin-top: 4px; }
  .nav { margin-bottom: 24px; }
  .nav a { color: #71717a; text-decoration: none; font-size: 13px; margin-right: 16px; }
  .nav a:hover { color: #fafafa; }
  .nav a.active { color: #fafafa; }

  .week-grid {
    display: grid;
    grid-template-columns: 60px repeat(7, 1fr);
    border: 1px solid #27272a;
    border-radius: 12px;
    overflow: hidden;
    background: #18181b;
  }
  .day-header {
    padding: 12px 8px;
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    color: #a1a1aa;
    border-bottom: 1px solid #27272a;
    background: #1c1c1f;
  }
  .time-header {
    padding: 12px 8px;
    text-align: center;
    font-size: 13px;
    font-weight: 600;
    color: #a1a1aa;
    border-bottom: 1px solid #27272a;
    background: #1c1c1f;
  }
  .time-label {
    padding: 0 8px;
    font-size: 11px;
    color: #52525b;
    text-align: right;
    border-right: 1px solid #27272a;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    padding-top: 2px;
  }
  .day-col {
    border-right: 1px solid #1f1f23;
    min-height: 32px;
    position: relative;
    border-bottom: 1px solid #1f1f23;
  }
  .day-col:last-child { border-right: none; }
  .event {
    margin: 2px 3px;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.3;
    cursor: default;
  }
  .event .time { font-size: 10px; opacity: 0.7; }
  .event.disabled { opacity: 0.4; }

  .legend { margin-top: 20px; display: flex; gap: 16px; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #a1a1aa; }
  .legend-dot { width: 10px; height: 10px; border-radius: 3px; }
  .loading { color: #71717a; font-size: 14px; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Weekly Schedule</h1>
    <p>Agent run schedule overview</p>
  </header>
  <div class="nav">
    <a href="/">Cost Dashboard</a>
    <a href="/agents">Agent Runner</a>
    <a href="/schedule" class="active">Schedule</a>
  </div>
  <div id="grid"><p class="loading">Loading schedules...</p></div>
  <div class="legend" id="legend"></div>
</div>
<script>
const COLORS = [
  { bg: '#1e3a5f', fg: '#60a5fa' },
  { bg: '#1f3a2f', fg: '#4ade80' },
  { bg: '#3b1f2b', fg: '#f472b6' },
  { bg: '#3b2f1f', fg: '#fbbf24' },
  { bg: '#2d1f3b', fg: '#a78bfa' },
  { bg: '#1f3b3b', fg: '#2dd4bf' },
  { bg: '#3b2525', fg: '#f87171' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function cronDayToCol(d) {
  // Windmill cron: 1=Mon...7=Sun -> grid: 0=Mon...6=Sun
  if (d === 0 || d === 7) return 6; // Sunday
  return d - 1;
}

function parseCron(cron) {
  // format: sec min hour dom month dow
  const parts = cron.split(/\\s+/);
  if (parts.length < 6) return null;
  const [, min, hour, , , dow] = parts;
  return { min, hour, dow };
}

function categorise(scriptPath) {
  if (scriptPath.includes('/infra/')) return 'infra';
  if (scriptPath.includes('/news/')) return 'news';
  return 'other';
}

async function loadSchedule() {
  const gridEl = document.getElementById('grid');
  try {
    const [schedRes, scriptsRes] = await Promise.all([
      fetch('/api/schedules'),
      fetch('/api/scripts'),
    ]);
    const schedules = await schedRes.json();
    const scripts = await scriptsRes.json();

    const scriptNames = {};
    scripts.forEach(s => { scriptNames[s.path] = s.summary; });

    // Assign colours by category
    const catColors = {};
    let colorIdx = 0;
    const catLabels = { news: 'News & Events', infra: 'Infrastructure', other: 'Other' };

    // Parse schedules into events
    const events = [];
    schedules.forEach(s => {
      const parsed = parseCron(s.schedule);
      if (!parsed) return;
      const name = scriptNames[s.script_path] || s.script_path.split('/').pop().replace(/_/g, ' ');
      const cat = categorise(s.script_path);
      if (!catColors[cat]) {
        catColors[cat] = COLORS[colorIdx % COLORS.length];
        colorIdx++;
      }

      // Determine which columns (days)
      const cols = [];
      if (parsed.dow === '*') {
        for (let c = 0; c < 7; c++) cols.push(c);
      } else {
        parsed.dow.split(',').forEach(d => cols.push(cronDayToCol(parseInt(d))));
      }

      // Determine which hours
      const hours = [];
      if (parsed.hour.startsWith('*/')) {
        const interval = parseInt(parsed.hour.slice(2));
        for (let h = 0; h <= 23; h += interval) hours.push(h);
      } else {
        hours.push(parseInt(parsed.hour));
      }

      const min = parseInt(parsed.min) || 0;

      cols.forEach(c => {
        hours.forEach(h => {
          events.push({ name, hour: h, min, col: c, cat, enabled: s.enabled, scriptPath: s.script_path });
        });
      });
    });

    // Find hour range
    let minHour = 24, maxHour = 0;
    events.forEach(e => {
      minHour = Math.min(minHour, e.hour);
      maxHour = Math.max(maxHour, e.hour);
    });
    minHour = Math.max(0, minHour - 1);
    maxHour = Math.min(23, maxHour + 1);

    // Build cells lookup
    const cells = {};
    events.forEach(e => {
      if (e.hour < minHour || e.hour > maxHour) return;
      const key = e.hour + '-' + e.col;
      if (!cells[key]) cells[key] = [];
      const timeStr = String(e.hour).padStart(2, '0') + ':' + String(e.min).padStart(2, '0');
      cells[key].push({ name: e.name, time: timeStr, cat: e.cat, enabled: e.enabled, scriptPath: e.scriptPath });
    });

    // Render grid
    let html = '<div class="week-grid">';
    html += '<div class="time-header"></div>';
    DAYS.forEach(d => { html += '<div class="day-header">' + d + '</div>'; });

    for (let h = minHour; h <= maxHour; h++) {
      html += '<div class="time-label">' + String(h).padStart(2, '0') + ':00</div>';
      for (let c = 0; c < 7; c++) {
        html += '<div class="day-col">';
        const key = h + '-' + c;
        if (cells[key]) {
          cells[key].forEach(ev => {
            const color = catColors[ev.cat] || COLORS[0];
            const disabledCls = ev.enabled ? '' : ' disabled';
            html += '<div class="event' + disabledCls + '" style="background:' + color.bg + ';color:' + color.fg + ';cursor:pointer" onclick="openAgentModal(\\'' + ev.scriptPath + '\\', \\'' + ev.name.replace(/'/g, "\\\\'") + '\\')"><span class="time">' + ev.time + '</span> ' + ev.name + '</div>';
          });
        }
        html += '</div>';
      }
    }
    html += '</div>';
    gridEl.innerHTML = html;

    // Legend
    const legend = document.getElementById('legend');
    legend.innerHTML = '';
    Object.entries(catColors).forEach(([cat, color]) => {
      const label = catLabels[cat] || cat;
      legend.innerHTML += '<div class="legend-item"><div class="legend-dot" style="background:' + color.bg + ';border:1px solid ' + color.fg + '"></div>' + label + '</div>';
    });

  } catch(e) {
    gridEl.innerHTML = '<p class="loading">Failed to load: ' + e.message + '</p>';
  }
}

loadSchedule();
</script>
${agentModalSnippet()}
</body>
</html>`;
}
