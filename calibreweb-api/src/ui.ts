export function renderUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Books API</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f1117;
      color: #e2e8f0;
      min-height: 100vh;
      padding: 2rem;
      max-width: 1100px;
      margin: 0 auto;
    }

    header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 2.5rem;
    }

    header h1 { font-size: 1.5rem; font-weight: 600; color: #f8fafc; }
    header span {
      font-size: 0.75rem;
      background: #1e293b;
      color: #94a3b8;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      border: 1px solid #334155;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1rem;
      margin-bottom: 2.5rem;
    }

    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.75rem;
      padding: 1.25rem 1.5rem;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
    }

    .card-title {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
    }

    .badge { font-size: 0.7rem; padding: 0.15rem 0.5rem; border-radius: 999px; font-weight: 600; }
    .badge-green { background: #064e3b; color: #34d399; border: 1px solid #065f46; }
    .badge-red   { background: #450a0a; color: #f87171; border: 1px solid #7f1d1d; }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.4rem 0;
      border-bottom: 1px solid #33415522;
      font-size: 0.875rem;
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: #94a3b8; }
    .stat-value { font-weight: 600; color: #f1f5f9; }

    .formats { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.75rem; }
    .format-tag {
      font-size: 0.7rem;
      background: #0f2244;
      color: #7dd3fc;
      border: 1px solid #1e4080;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
    }

    h2 { font-size: 1rem; font-weight: 600; color: #f1f5f9; margin-bottom: 1rem; }

    /* Explorer */
    .explorer {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin-bottom: 2.5rem;
    }

    .explorer-controls {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }

    select, input[type=text] {
      background: #0f1117;
      border: 1px solid #334155;
      color: #e2e8f0;
      padding: 0.45rem 0.75rem;
      border-radius: 0.375rem;
      font-size: 0.875rem;
    }

    input[type=text] { flex: 1; min-width: 180px; }

    button.send {
      background: #1d4ed8;
      color: white;
      border: none;
      padding: 0.45rem 1.1rem;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 600;
    }
    button.send:hover { background: #2563eb; }

    /* Snippet tabs */
    .snippet-tabs {
      display: flex;
      gap: 0;
      margin-bottom: 0;
      border-bottom: 1px solid #334155;
    }

    .tab-btn {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.4rem 1rem;
      background: transparent;
      border: none;
      color: #64748b;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
    }
    .tab-btn.active { color: #7dd3fc; border-bottom-color: #7dd3fc; }

    .snippet-area {
      position: relative;
      background: #0f1117;
      border: 1px solid #334155;
      border-top: none;
      border-radius: 0 0 0.5rem 0.5rem;
      margin-bottom: 1rem;
    }

    .snippet-area pre {
      padding: 1rem;
      font-family: monospace;
      font-size: 0.8rem;
      color: #94a3b8;
      overflow-x: auto;
      white-space: pre;
      margin: 0;
      border: none;
      background: transparent;
      max-height: 120px;
    }

    .copy-btn {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      font-size: 0.7rem;
      padding: 0.2rem 0.6rem;
      background: #1e293b;
      border: 1px solid #475569;
      color: #94a3b8;
      border-radius: 0.25rem;
      cursor: pointer;
    }
    .copy-btn:hover { color: #f1f5f9; }

    /* Response */
    .response-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .response-meta { font-size: 0.75rem; color: #64748b; }
    .status-ok  { color: #34d399; font-weight: 600; }
    .status-err { color: #f87171; font-weight: 600; }

    pre.response {
      background: #0f1117;
      border: 1px solid #334155;
      border-radius: 0.5rem;
      padding: 1rem;
      overflow: auto;
      font-size: 0.8rem;
      color: #7dd3fc;
      max-height: 380px;
    }

    /* Endpoint list */
    .endpoint-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 2.5rem; }

    .endpoint {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.5rem;
      padding: 0.65rem 1rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .endpoint:hover { border-color: #475569; }

    .method {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      background: #064e3b;
      color: #34d399;
      border: 1px solid #065f46;
      flex-shrink: 0;
    }

    .ep-path { font-family: monospace; font-size: 0.85rem; color: #e2e8f0; flex: 1; }
    .ep-desc { color: #64748b; font-size: 0.8rem; }

    .loading { color: #94a3b8; font-size: 0.875rem; }
    .error-msg { color: #f87171; font-size: 0.875rem; }

    /* Key management */
    .key-section {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 0.75rem;
      padding: 1.5rem;
      margin-bottom: 2.5rem;
    }

    .key-create {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }

    .key-create input {
      flex: 1;
    }

    button.create-key {
      background: #065f46;
      color: #34d399;
      border: 1px solid #064e3b;
      padding: 0.45rem 1rem;
      border-radius: 0.375rem;
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 600;
      white-space: nowrap;
    }
    button.create-key:hover { background: #047857; }

    .key-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .key-table th {
      text-align: left;
      color: #64748b;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 0 0 0.5rem 0;
      border-bottom: 1px solid #334155;
    }
    .key-table td {
      padding: 0.6rem 0;
      border-bottom: 1px solid #33415533;
      vertical-align: middle;
    }
    .key-table tr:last-child td { border-bottom: none; }

    .key-value {
      font-family: monospace;
      font-size: 0.78rem;
      color: #7dd3fc;
      background: #0f1117;
      padding: 0.2rem 0.5rem;
      border-radius: 0.25rem;
      border: 1px solid #1e3a5f;
      cursor: pointer;
      user-select: all;
    }

    .key-value.revealed { color: #34d399; }

    button.revoke {
      font-size: 0.7rem;
      padding: 0.2rem 0.6rem;
      background: transparent;
      border: 1px solid #7f1d1d;
      color: #f87171;
      border-radius: 0.25rem;
      cursor: pointer;
    }
    button.revoke:hover { background: #450a0a; }

    .new-key-banner {
      background: #064e3b;
      border: 1px solid #065f46;
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      margin-bottom: 1rem;
      font-size: 0.85rem;
      color: #a7f3d0;
    }
    .new-key-banner strong { display: block; margin-bottom: 0.25rem; color: #34d399; }
    .new-key-banner code {
      font-family: monospace;
      background: #0f1117;
      padding: 0.2rem 0.5rem;
      border-radius: 0.25rem;
      color: #7dd3fc;
      cursor: pointer;
      user-select: all;
    }
  </style>
</head>
<body>
  <header>
    <h1>📚 Books API</h1>
    <span>books-api.jacob.st/api</span>
  </header>

  <div id="libraries-grid" class="grid"></div>

  <h2>API Keys</h2>
  <div class="key-section">
    <div class="key-create">
      <input type="text" id="key-name" placeholder="Key name, e.g. home-app" />
      <button class="create-key" onclick="createKey()">Generate Key</button>
    </div>
    <div id="new-key-banner" style="display:none"></div>
    <table class="key-table">
      <thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last Used</th><th></th></tr></thead>
      <tbody id="key-table-body"><tr><td colspan="5" class="loading">Loading...</td></tr></tbody>
    </table>
  </div>

  <h2>API Explorer</h2>
  <div class="explorer">
    <div class="explorer-controls">
      <select id="library-select"><option value="">Library...</option></select>
      <select id="endpoint-select"></select>
      <input type="text" id="param-input" placeholder="params, e.g. ?q=moby or :id=2" />
      <button class="send" onclick="sendRequest()">Send</button>
    </div>

    <!-- Snippet tabs -->
    <div class="snippet-tabs">
      <button class="tab-btn active" onclick="switchTab('url')">URL</button>
      <button class="tab-btn" onclick="switchTab('curl')">curl</button>
      <button class="tab-btn" onclick="switchTab('fetch')">fetch()</button>
    </div>
    <div class="snippet-area">
      <pre id="snippet-content">—</pre>
      <button class="copy-btn" onclick="copySnippet()">Copy</button>
    </div>

    <!-- Response -->
    <div id="response-area"></div>
  </div>

  <h2>All Endpoints</h2>
  <div class="endpoint-list" id="endpoint-list"></div>

  <script>
    const BASE = '/api';
    const ORIGIN = window.location.origin;

    // Key management
    async function loadKeys() {
      const tbody = document.getElementById('key-table-body');
      try {
        const res = await fetch(BASE + '/keys');
        const keys = await res.json();
        if (!keys.length) {
          tbody.innerHTML = '<tr><td colspan="5" style="color:#64748b;padding:0.5rem 0">No keys yet</td></tr>';
          return;
        }
        tbody.innerHTML = keys.map(k => \`
          <tr>
            <td>\${k.name}</td>
            <td><span class="key-value" title="Click to copy" onclick="copyKey(this, '\${k.key}')">••••••••\${k.key.slice(-6)}</span></td>
            <td style="color:#64748b">\${k.created_at.slice(0,10)}</td>
            <td style="color:#64748b">\${k.last_used_at ? k.last_used_at.slice(0,10) : 'Never'}</td>
            <td><button class="revoke" onclick="revokeKey(\${k.id}, this)">Revoke</button></td>
          </tr>
        \`).join('');
      } catch {
        tbody.innerHTML = '<tr><td colspan="5" class="error-msg">Failed to load keys</td></tr>';
      }
    }

    function copyKey(el, key) {
      navigator.clipboard.writeText(key);
      el.textContent = 'Copied!';
      setTimeout(() => { el.textContent = '••••••••' + key.slice(-6); }, 1500);
    }

    async function createKey() {
      const nameInput = document.getElementById('key-name');
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }

      const res = await fetch(BASE + '/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();

      const banner = document.getElementById('new-key-banner');
      banner.style.display = 'block';
      banner.innerHTML = \`
        <strong>Key created — copy it now, it won't be shown again in full</strong>
        <code onclick="navigator.clipboard.writeText('\${data.key}')" title="Click to copy">\${data.key}</code>
      \`;

      nameInput.value = '';
      await loadKeys();
    }

    async function revokeKey(id, btn) {
      if (!confirm('Revoke this key? It will stop working immediately.')) return;
      btn.disabled = true;
      await fetch(BASE + '/keys/' + id, { method: 'DELETE' });
      await loadKeys();
    }

    const ENDPOINTS = [
      { path: '/books',             desc: 'List all books',       hint: '?sort=title&order=asc&limit=50&offset=0' },
      { path: '/books/search',      desc: 'Search by title/author', hint: '?q=moby' },
      { path: '/books/recent',      desc: 'Recently added',       hint: '?limit=10' },
      { path: '/books/:id',         desc: 'Get book by ID',       hint: ':id=2' },
      { path: '/authors',           desc: 'All authors',          hint: '' },
      { path: '/authors/:id/books', desc: 'Books by author',      hint: ':id=1' },
      { path: '/series',            desc: 'All series',           hint: '' },
      { path: '/series/:id/books',  desc: 'Books in series',      hint: ':id=1' },
      { path: '/tags',              desc: 'All tags',             hint: '' },
      { path: '/stats',             desc: 'Library stats',        hint: '' },
    ];

    let libraries = [];    // array of names
    let libraryMeta = {}; // name -> { url }
    let activeTab = 'url';

    async function init() {
      try {
        const res = await fetch(BASE + '/health');
        const data = await res.json();
        libraryMeta = data.libraries || {};
        libraries = Object.keys(libraryMeta);
      } catch {
        libraries = [];
        libraryMeta = {};
      }

      const libSel = document.getElementById('library-select');
      libraries.forEach(lib => {
        const o = document.createElement('option');
        o.value = lib;
        o.textContent = lib.charAt(0).toUpperCase() + lib.slice(1);
        libSel.appendChild(o);
      });
      if (libraries.length) libSel.value = libraries[0];

      const epSel = document.getElementById('endpoint-select');
      ENDPOINTS.forEach((ep, i) => {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = ep.desc;
        epSel.appendChild(o);
      });

      // Set hint on endpoint change
      epSel.addEventListener('change', () => {
        const ep = ENDPOINTS[epSel.value];
        document.getElementById('param-input').placeholder = ep.hint ? 'e.g. ' + ep.hint : 'no params needed';
        updateSnippet();
      });
      libSel.addEventListener('change', updateSnippet);
      document.getElementById('param-input').addEventListener('input', updateSnippet);
      updateSnippet();

      await Promise.all([loadKeys(), loadLibraryCards()]);
      renderEndpointList();
    }

    function buildUrl() {
      const lib = document.getElementById('library-select').value;
      const epIdx = document.getElementById('endpoint-select').value;
      const param = document.getElementById('param-input').value.trim();
      if (!lib || epIdx === '') return null;

      const ep = ENDPOINTS[epIdx];
      let path = ep.path;

      // Handle :param=value style
      if (param.startsWith(':')) {
        const eq = param.indexOf('=');
        const key = param.slice(1, eq);
        const val = param.slice(eq + 1) || '0';
        path = path.replace(':' + key, val);
        // If there's leftover after the id (e.g. :id=2?foo=bar)
        const qs = param.slice(eq + 1 + val.length);
        return ORIGIN + BASE + '/' + lib + path + qs;
      }

      const qs = param.startsWith('?') ? param : '';
      return ORIGIN + BASE + '/' + lib + path + qs;
    }

    function getSnippets(url) {
      if (!url) return { url: '—', curl: '—', fetch: '—' };
      return {
        url: url,
        curl: \`curl -s "\${url}" \\\\\n  -H "X-API-Key: YOUR_KEY" | jq .\`,
        fetch: \`const res = await fetch("\\n  \${url}",\\n  { headers: { "X-API-Key": "YOUR_KEY" } }\\n);\\nconst data = await res.json();\`,
      };
    }

    function updateSnippet() {
      const url = buildUrl();
      const snippets = getSnippets(url);
      document.getElementById('snippet-content').textContent = snippets[activeTab] || '—';
    }

    function switchTab(tab) {
      activeTab = tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      updateSnippet();
    }

    function copySnippet() {
      const text = document.getElementById('snippet-content').textContent;
      navigator.clipboard.writeText(text);
      const btn = document.querySelector('.copy-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    }

    async function sendRequest() {
      const url = buildUrl();
      if (!url) return;
      const area = document.getElementById('response-area');
      area.innerHTML = '<div class="loading">Loading...</div>';
      const t0 = Date.now();
      try {
        const res = await fetch(url);
        const ms = Date.now() - t0;
        const data = await res.json();
        const statusClass = res.ok ? 'status-ok' : 'status-err';
        area.innerHTML = \`
          <div class="response-header">
            <span class="response-meta">
              <span class="\${statusClass}">\${res.status} \${res.statusText}</span>
              &nbsp;·&nbsp;\${ms}ms
            </span>
          </div>
          <pre class="response">\${JSON.stringify(data, null, 2)}</pre>
        \`;
      } catch (e) {
        area.innerHTML = \`<span class="error-msg">Error: \${e.message}</span>\`;
      }
    }

    async function loadLibraryCards() {
      const grid = document.getElementById('libraries-grid');
      grid.innerHTML = '';

      // Pre-create cards
      for (const lib of libraries) {
        const meta = libraryMeta[lib] || {};
        const urlLink = meta.url
          ? \`<a href="\${meta.url}" target="_blank" rel="noopener" style="font-size:0.75rem;color:#7dd3fc;text-decoration:none;opacity:0.8" title="\${meta.url}">↗ Open</a>\`
          : '';
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = \`
          <div class="card-header">
            <span class="card-title">\${lib}</span>
            <div style="display:flex;align-items:center;gap:0.5rem">
              \${urlLink}
              <span class="badge badge-green" id="badge-\${lib}">Connected</span>
            </div>
          </div>
          <div id="stats-\${lib}" class="loading">Loading...</div>
        \`;
        grid.appendChild(card);
      }

      try {
        const res = await fetch(\`\${BASE}/dashboard/stats\`);
        const all = await res.json();
        for (const [lib, s] of Object.entries(all)) {
          const el = document.getElementById('stats-' + lib);
          if (!el) continue;
          if (s.status === 'error') {
            el.innerHTML = \`<span class="error-msg">\${s.error}</span>\`;
            document.getElementById('badge-' + lib).className = 'badge badge-red';
            document.getElementById('badge-' + lib).textContent = 'Error';
            continue;
          }
          const fmts = s.formats.map(f => \`<span class="format-tag">\${f.format} (\${f.count})</span>\`).join('');
          el.innerHTML = \`
            <div class="stat-row"><span class="stat-label">Books</span><span class="stat-value">\${s.total_books}</span></div>
            <div class="stat-row"><span class="stat-label">Authors</span><span class="stat-value">\${s.total_authors}</span></div>
            <div class="formats">\${fmts}</div>
          \`;
        }
      } catch {
        for (const lib of libraries) {
          const el = document.getElementById('stats-' + lib);
          if (el) el.innerHTML = '<span class="error-msg">Failed to load</span>';
        }
      }
    }

    function renderEndpointList() {
      const list = document.getElementById('endpoint-list');
      ENDPOINTS.forEach((ep, i) => {
        const div = document.createElement('div');
        div.className = 'endpoint';
        div.title = 'Click to load in explorer';
        div.onclick = () => {
          document.getElementById('endpoint-select').value = i;
          const hint = ep.hint || '';
          document.getElementById('param-input').value = hint;
          document.getElementById('param-input').placeholder = hint ? 'e.g. ' + hint : 'no params needed';
          updateSnippet();
          document.querySelector('.explorer').scrollIntoView({ behavior: 'smooth' });
        };
        div.innerHTML = \`
          <span class="method">GET</span>
          <span class="ep-path">/:library\${ep.path}</span>
          <span class="ep-desc">\${ep.desc}</span>
        \`;
        list.appendChild(div);
      });
    }

    init();
  </script>
</body>
</html>`;
}
