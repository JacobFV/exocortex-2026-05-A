export function renderHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Exocortex</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #101314;
        --panel: #171b1d;
        --panel-2: #1f2427;
        --line: #30383c;
        --line-strong: #465157;
        --text: #f2f4f1;
        --muted: #a9b3ae;
        --soft: #d9ded8;
        --green: #63c58f;
        --amber: #d7b35f;
        --red: #df6f64;
        --cyan: #67b8d1;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-width: 920px;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
        letter-spacing: 0;
      }
      button, input, textarea, select {
        font: inherit;
      }
      button {
        min-height: 34px;
        border: 1px solid var(--line-strong);
        border-radius: 6px;
        background: #252c2f;
        color: var(--text);
        cursor: pointer;
      }
      button:hover { border-color: var(--soft); }
      button.primary { background: #31523e; border-color: #47775a; }
      button.danger { background: #59302d; border-color: #804840; }
      button.ghost { background: transparent; }
      input, textarea, select {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #0d1011;
        color: var(--text);
        padding: 8px 10px;
      }
      textarea { resize: vertical; min-height: 88px; }
      label {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.25;
      }
      h1, h2, h3, p { margin: 0; }
      h1 { font-size: 22px; font-weight: 700; }
      h2 { font-size: 16px; font-weight: 650; }
      h3 { font-size: 13px; color: var(--soft); font-weight: 650; }
      code { color: var(--soft); }
      .app {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 340px 1fr;
      }
      .sidebar {
        border-right: 1px solid var(--line);
        background: #141819;
        padding: 16px;
        display: grid;
        align-content: start;
        gap: 16px;
      }
      .content {
        min-width: 0;
        display: grid;
        grid-template-rows: auto auto 1fr;
      }
      .topbar {
        min-height: 64px;
        border-bottom: 1px solid var(--line);
        padding: 12px 18px;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
        align-items: center;
        background: #131718;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(5, minmax(112px, 1fr));
        gap: 8px;
        min-width: 600px;
      }
      .stat {
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 8px 10px;
        background: var(--panel);
      }
      .stat span { display: block; color: var(--muted); font-size: 11px; }
      .stat strong { display: block; margin-top: 3px; font-size: 18px; }
      .tabs {
        display: flex;
        gap: 6px;
        padding: 10px 18px;
        border-bottom: 1px solid var(--line);
        background: #15191a;
      }
      .tabs button {
        min-width: 104px;
        background: transparent;
      }
      .tabs button.active {
        background: #243036;
        border-color: var(--cyan);
      }
      .workspace {
        padding: 16px 18px 24px;
        overflow: auto;
      }
      .panel {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--panel);
        min-width: 0;
      }
      .panel + .panel { margin-top: 14px; }
      .panel-header {
        min-height: 46px;
        border-bottom: 1px solid var(--line);
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .panel-body {
        padding: 12px;
      }
      .stack { display: grid; gap: 10px; }
      .two-col {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(300px, 420px);
        gap: 14px;
        align-items: start;
      }
      .three-col {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .row > * { min-width: 0; }
      .row button { flex: 0 0 auto; padding: 0 12px; }
      .session-list {
        display: grid;
        gap: 8px;
        max-height: 280px;
        overflow: auto;
      }
      .session-card {
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 10px;
        background: #111516;
        text-align: left;
      }
      .session-card.active {
        border-color: var(--green);
        background: #17221b;
      }
      .session-card strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .session-card span {
        display: block;
        margin-top: 3px;
        color: var(--muted);
        font-size: 12px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        min-height: 22px;
        max-width: 100%;
        padding: 2px 8px;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--soft);
        background: #111516;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pill.green { border-color: #47775a; color: var(--green); }
      .pill.amber { border-color: #806c37; color: var(--amber); }
      .pill.red { border-color: #804840; color: var(--red); }
      .muted { color: var(--muted); }
      .small { font-size: 12px; line-height: 1.35; }
      .timeline {
        display: grid;
        gap: 8px;
        max-height: calc(100vh - 260px);
        overflow: auto;
      }
      .event {
        display: grid;
        grid-template-columns: 150px 1fr;
        gap: 10px;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 9px;
        background: #111516;
      }
      .event-meta {
        min-width: 0;
        color: var(--muted);
        font-size: 12px;
      }
      .event-type {
        display: block;
        color: var(--soft);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .event-body {
        min-width: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: 13px;
        line-height: 1.4;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th, td {
        border-bottom: 1px solid var(--line);
        padding: 8px;
        text-align: left;
        vertical-align: top;
        overflow-wrap: anywhere;
        font-size: 12px;
      }
      th {
        color: var(--muted);
        font-weight: 600;
        background: #15191a;
      }
      tr:last-child td { border-bottom: 0; }
      .json {
        max-height: 360px;
        overflow: auto;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #0d1011;
        color: #d8ded9;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
      }
      .browser-frame {
        width: 100%;
        aspect-ratio: 16 / 10;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #0d1011;
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .browser-frame img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: white;
      }
      .empty {
        color: var(--muted);
        padding: 18px;
        text-align: center;
      }
      .status-line {
        color: var(--muted);
        font-size: 12px;
        min-height: 18px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .hidden { display: none; }
      @media (max-width: 1100px) {
        .app { grid-template-columns: 300px 1fr; }
        .two-col { grid-template-columns: 1fr; }
        .stats { grid-template-columns: repeat(3, minmax(100px, 1fr)); min-width: 0; }
      }
    </style>
  </head>
  <body>
    <main class="app">
      <aside class="sidebar">
        <div class="stack">
          <h1>Exocortex</h1>
          <div id="status" class="status-line">Loading runtime</div>
        </div>

        <form id="session-form" class="panel">
          <div class="panel-header"><h2>Agent Session</h2></div>
          <div class="panel-body stack">
            <label>Goal
              <textarea id="goal">Understand current wearable context and keep modalities separated.</textarea>
            </label>
            <label>Model
              <input id="model" value="local-rules" />
            </label>
            <button class="primary" type="submit">Start Session</button>
          </div>
        </form>

        <section class="panel">
          <div class="panel-header">
            <h2>App Input</h2>
            <span class="pill">app_input_text</span>
          </div>
          <div class="panel-body stack">
            <input id="app-text" placeholder="Text observation" />
            <button id="inject-text" type="button">Inject Text</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>Sessions</h2>
            <button class="ghost" type="button" data-action="refresh">Refresh</button>
          </div>
          <div id="session-list" class="panel-body session-list"></div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <h2>Models</h2>
          </div>
          <div id="model-health" class="panel-body stack"></div>
        </section>
      </aside>

      <section class="content">
        <header class="topbar">
          <div>
            <h2 id="active-title">No session selected</h2>
            <div id="active-subtitle" class="status-line"></div>
          </div>
          <div class="stats">
            <div class="stat"><span>Sessions</span><strong id="stat-sessions">0</strong></div>
            <div class="stat"><span>Events</span><strong id="stat-events">0</strong></div>
            <div class="stat"><span>Modalities</span><strong id="stat-modalities">0</strong></div>
            <div class="stat"><span>Graph Objects</span><strong id="stat-objects">0</strong></div>
            <div class="stat"><span>Active Grants</span><strong id="stat-grants">0</strong></div>
          </div>
        </header>

        <nav class="tabs" id="tabs">
          <button type="button" data-tab="timeline" class="active">Timeline</button>
          <button type="button" data-tab="modalities">Modalities</button>
          <button type="button" data-tab="browser">Browser</button>
          <button type="button" data-tab="safety">Safety</button>
          <button type="button" data-tab="calibration">Calibration</button>
          <button type="button" data-tab="graph">Graph</button>
          <button type="button" data-tab="artifacts">Artifacts</button>
        </nav>

        <div class="workspace">
          <section id="view-timeline" class="view"></section>
          <section id="view-modalities" class="view hidden"></section>
          <section id="view-browser" class="view hidden"></section>
          <section id="view-safety" class="view hidden"></section>
          <section id="view-calibration" class="view hidden"></section>
          <section id="view-graph" class="view hidden"></section>
          <section id="view-artifacts" class="view hidden"></section>
        </div>
      </section>
    </main>
    <script>
      const state = {
        sessions: [],
        selectedSessionId: undefined,
        events: [],
        bindings: [],
        artifacts: [],
        models: { models: [], health: [] },
        modalities: { devices: [], modalities: [], deviceTypes: [], modalityTypes: [] },
        continuity: { objects: [], relations: [], events: [] },
        safety: { policies: [], grants: [] },
        calibrationProfiles: [],
        browsers: [],
        browserFrame: undefined,
        selectedTab: 'timeline',
        eventFilter: 'all',
        graphFilter: ''
      };
      let refreshQueued = false;

      function el(selector) {
        return document.querySelector(selector);
      }

      function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, function (char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }

      function json(value) {
        return escapeHtml(JSON.stringify(value, null, 2));
      }

      function shortId(value) {
        const text = String(value ?? '');
        return text.length > 18 ? text.slice(0, 8) + '...' + text.slice(-6) : text;
      }

      function time(value) {
        if (!value) return '';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleTimeString();
      }

      function selectedSession() {
        return state.sessions.find(function (session) { return session.id === state.selectedSessionId; });
      }

      function currentBrowserId() {
        const select = el('#browser-session');
        return select && select.value ? select.value : state.browsers[0]?.id;
      }

      async function refresh() {
        try {
          const sessions = await window.exocortex.listSessions();
          state.sessions = Array.isArray(sessions) ? sessions : [];
          if (!state.selectedSessionId || !state.sessions.some(function (session) { return session.id === state.selectedSessionId; })) {
            state.selectedSessionId = state.sessions[0]?.id;
          }

          const selected = selectedSession();
          const base = await Promise.all([
            window.exocortex.listModalities(),
            window.exocortex.listContinuityObjects(),
            window.exocortex.listContinuityRelations(),
            window.exocortex.listContinuityEvents(),
            window.exocortex.listActuatorSafety(),
            window.exocortex.listBrowserSessions(),
            window.exocortex.listModels(),
            window.exocortex.listCalibrationProfiles()
          ]);
          state.modalities = base[0] || state.modalities;
          state.continuity = { objects: base[1] || [], relations: base[2] || [], events: base[3] || [] };
          state.safety = base[4] || { policies: [], grants: [] };
          state.browsers = base[5] || [];
          state.models = base[6] || { models: [], health: [] };
          state.calibrationProfiles = base[7] || [];
          if (selected) {
            const details = await Promise.all([
              window.exocortex.listEvents(selected.id),
              window.exocortex.listBindings(selected.id),
              window.exocortex.listArtifacts(selected.id)
            ]);
            state.events = details[0] || [];
            state.bindings = details[1] || [];
            state.artifacts = details[2] || [];
          } else {
            state.events = [];
            state.bindings = [];
            state.artifacts = [];
          }
          render();
          setStatus('Runtime refreshed');
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), true);
        }
      }

      function scheduleRefresh() {
        if (refreshQueued) return;
        refreshQueued = true;
        window.setTimeout(function () {
          refreshQueued = false;
          void refresh();
        }, 120);
      }

      function setStatus(message, isError) {
        const status = el('#status');
        status.textContent = message;
        status.style.color = isError ? 'var(--red)' : 'var(--muted)';
      }

      function render() {
        renderShell();
        renderSessions();
        renderModels();
        renderTimeline();
        renderModalities();
        renderBrowser();
        renderSafety();
        renderCalibration();
        renderGraph();
        renderArtifacts();
      }

      function renderShell() {
        const session = selectedSession();
        el('#active-title').textContent = session ? session.goal : 'No session selected';
        el('#active-subtitle').textContent = session
          ? session.id + ' / ' + session.state + ' / ' + (session.runtime?.model || 'unknown-model')
          : 'Start an agent session to bind runtime modalities.';
        el('#stat-sessions').textContent = String(state.sessions.length);
        el('#stat-events').textContent = String(state.events.length);
        el('#stat-modalities').textContent = String((state.modalities.modalities || []).length);
        el('#stat-objects').textContent = String(state.continuity.objects.length);
        el('#stat-grants').textContent = String((state.safety.grants || []).length);

        document.querySelectorAll('.view').forEach(function (view) {
          view.classList.toggle('hidden', view.id !== 'view-' + state.selectedTab);
        });
        document.querySelectorAll('#tabs button').forEach(function (button) {
          button.classList.toggle('active', button.dataset.tab === state.selectedTab);
        });
      }

      function renderSessions() {
        const root = el('#session-list');
        if (!state.sessions.length) {
          root.innerHTML = '<div class="empty">No sessions</div>';
          return;
        }
        root.innerHTML = state.sessions.map(function (session) {
          const active = session.id === state.selectedSessionId ? ' active' : '';
          return '<button class="session-card' + active + '" type="button" data-action="select-session" data-session-id="' + escapeHtml(session.id) + '">' +
            '<strong>' + escapeHtml(session.goal) + '</strong>' +
            '<span>' + escapeHtml(session.state) + ' / ' + escapeHtml(shortId(session.id)) + ' / ' + escapeHtml(time(session.updatedAt)) + '</span>' +
          '</button>';
        }).join('');
      }

      function renderModels() {
        const health = state.models.health || [];
        const root = el('#model-health');
        if (!root) return;
        root.innerHTML = health.length ? health.map(function (model) {
          const tone = model.status === 'available' || model.status === 'configured' ? 'green' : 'red';
          return '<div class="small"><span class="pill ' + tone + '">' + escapeHtml(model.status) + '</span> <strong>' + escapeHtml(model.id) + '</strong><br><span class="muted">' + escapeHtml(model.message) + '</span></div>';
        }).join('') : '<div class="empty">No models</div>';
      }

      function renderTimeline() {
        const session = selectedSession();
        const filters = ['all', 'messages', 'tools', 'modalities', 'errors'];
        const controls = filters.map(function (filter) {
          const active = state.eventFilter === filter ? ' active' : '';
          return '<button type="button" class="ghost' + active + '" data-action="event-filter" data-filter="' + filter + '">' + filter + '</button>';
        }).join('');
        const stop = session && (session.state === 'running' || session.state === 'starting')
          ? '<button class="danger" type="button" data-action="stop-session">Stop Session</button>'
          : '';
        const events = filteredEvents();
        el('#view-timeline').innerHTML =
          '<section class="panel">' +
            '<div class="panel-header"><h2>Session Timeline</h2><div class="row">' + controls + stop + '</div></div>' +
            '<div class="panel-body">' +
              (events.length ? '<div class="timeline">' + events.map(renderEvent).join('') + '</div>' : '<div class="empty">No events</div>') +
            '</div>' +
          '</section>';
      }

      function filteredEvents() {
        return state.events.filter(function (event) {
          if (state.eventFilter === 'messages') return event.type && event.type.startsWith('message.');
          if (state.eventFilter === 'tools') return event.type && event.type.startsWith('tool_call.');
          if (state.eventFilter === 'modalities') return event.type && event.type.startsWith('modality.');
          if (state.eventFilter === 'errors') return event.type && (event.type.includes('error') || event.type.includes('failed'));
          return true;
        });
      }

      function renderEvent(event) {
        return '<article class="event">' +
          '<div class="event-meta">' +
            '<span class="event-type">' + escapeHtml(event.type) + '</span>' +
            '<span>' + escapeHtml(time(event.createdAt)) + ' / #' + escapeHtml(event.sequence) + '</span>' +
            (event.modalityId ? '<span>' + escapeHtml(shortId(event.modalityId)) + '</span>' : '') +
          '</div>' +
          '<div class="event-body">' + eventSummary(event) + '</div>' +
        '</article>';
      }

      function eventSummary(event) {
        if (event.type === 'message.completed' || event.type === 'message.delta') {
          return '<span class="pill">' + escapeHtml(event.role) + '</span> ' +
            (event.source ? '<span class="pill green">' + escapeHtml(event.source) + '</span> ' : '') +
            escapeHtml(event.text);
        }
        if (event.type === 'modality.observation') {
          return '<span class="pill green">' + escapeHtml(event.observationType) + '</span> ' + json(event.value);
        }
        if (event.type === 'modality.action') {
          return '<span class="pill amber">' + escapeHtml(event.actionType) + '</span> ' + json(event.value);
        }
        if (event.type === 'tool_call.started') return '<span class="pill amber">' + escapeHtml(event.name) + '</span> ' + json(event.input);
        if (event.type === 'tool_call.completed') return json(event.output);
        if (event.type === 'tool_call.failed' || event.type === 'session.error') return '<span class="pill red">' + escapeHtml(event.code) + '</span> ' + escapeHtml(event.message);
        if (event.type === 'session.state_changed') return escapeHtml(event.previousState + ' -> ' + event.nextState);
        return json(event);
      }

      function renderModalities() {
        const modalities = state.modalities.modalities || [];
        const bindings = state.bindings || [];
        const bindingByModality = new Map(bindings.map(function (binding) { return [binding.modalityInstanceId, binding]; }));
        const rows = modalities.map(function (modality) {
          const binding = bindingByModality.get(modality.id);
          return '<tr>' +
            '<td><strong>' + escapeHtml(modality.key) + '</strong><br><span class="muted">' + escapeHtml(shortId(modality.id)) + '</span></td>' +
            '<td>' + escapeHtml(modality.source) + '</td>' +
            '<td>' + escapeHtml(modality.direction) + '</td>' +
            '<td>' + escapeHtml(modality.kind) + '</td>' +
            '<td>' + escapeHtml(modality.state) + '</td>' +
            '<td>' + (binding ? '<span class="pill green">' + escapeHtml(binding.policy) + '</span>' : '<span class="pill">unbound</span>') + '</td>' +
          '</tr>';
        }).join('');
        el('#view-modalities').innerHTML =
          '<section class="panel">' +
            '<div class="panel-header"><h2>Device And Modality Graph</h2><span class="pill">' + modalities.length + ' modalities</span></div>' +
            '<div class="panel-body">' +
              '<table><thead><tr><th>Key</th><th>Source</th><th>Direction</th><th>Kind</th><th>State</th><th>Session Policy</th></tr></thead><tbody>' +
              (rows || '<tr><td colspan="6">No modalities</td></tr>') +
              '</tbody></table>' +
            '</div>' +
          '</section>';
      }

      function renderBrowser() {
        const options = state.browsers.map(function (browser) {
          return '<option value="' + escapeHtml(browser.id) + '">' + escapeHtml(browser.currentUrl || browser.id) + '</option>';
        }).join('');
        const frame = state.browserFrame && state.browserFrame.data
          ? '<img src="' + escapeHtml(state.browserFrame.data) + '" alt="Browser projection" />'
          : '<div class="empty">No captured frame</div>';
        el('#view-browser').innerHTML =
          '<div class="two-col">' +
            '<section class="panel">' +
              '<div class="panel-header"><h2>Browser Projection</h2><button type="button" data-action="create-browser">Create Browser</button></div>' +
              '<div class="panel-body stack">' +
                '<div class="row"><select id="browser-session">' + options + '</select><button type="button" data-action="capture-browser">Capture</button></div>' +
                '<div class="row"><input id="browser-url" placeholder="https://example.com" /><button type="button" class="primary" data-action="navigate-browser">Navigate</button></div>' +
                '<div class="browser-frame">' + frame + '</div>' +
              '</div>' +
            '</section>' +
            '<section class="panel">' +
              '<div class="panel-header"><h2>Browser Sessions</h2><span class="pill">' + state.browsers.length + '</span></div>' +
              '<div class="panel-body"><div class="json">' + json(state.browsers) + '</div></div>' +
            '</section>' +
          '</div>';
      }

      function renderSafety() {
        const policies = state.safety.policies || [];
        const grants = state.safety.grants || [];
        const outputBindings = (state.bindings || []).filter(function (binding) {
          return binding.direction === 'output' || binding.direction === 'duplex';
        });
        const channelOptions = policies.map(function (policy) {
          return '<option value="' + escapeHtml(policy.channel) + '">' + escapeHtml(policy.channel) + '</option>';
        }).join('');
        const bindingOptions = outputBindings.map(function (binding) {
          return '<option value="' + escapeHtml(binding.id) + '">' + escapeHtml(binding.key) + '</option>';
        }).join('');
        const policyRows = policies.map(function (policy) {
          return '<tr><td>' + escapeHtml(policy.channel) + '</td><td>' + escapeHtml(policy.requiresArm) + '</td><td>' + escapeHtml(policy.maxDuty) + '</td><td>' + escapeHtml(policy.maxPulseUs ?? '') + '</td><td>' + escapeHtml(policy.minIntervalMs ?? '') + '</td></tr>';
        }).join('');
        const grantRows = grants.map(function (grant) {
          return '<tr><td>' + escapeHtml(grant.channel) + '</td><td>' + escapeHtml(grant.reason) + '</td><td>' + escapeHtml(time(grant.expiresAt)) + '</td></tr>';
        }).join('');
        el('#view-safety').innerHTML =
          '<div class="two-col">' +
            '<section class="panel">' +
              '<div class="panel-header"><h2>Actuator Safety</h2><span class="pill">' + grants.length + ' grants</span></div>' +
              '<div class="panel-body stack">' +
                '<div class="three-col">' +
                  '<label>Channel<select id="arm-channel">' + channelOptions + '</select></label>' +
                  '<label>Reason<input id="arm-reason" value="operator requested" /></label>' +
                  '<label>&nbsp;<button type="button" class="primary" data-action="arm-actuator">Arm</button></label>' +
                '</div>' +
                '<table><thead><tr><th>Channel</th><th>Reason</th><th>Expires</th></tr></thead><tbody>' + (grantRows || '<tr><td colspan="3">No active grants</td></tr>') + '</tbody></table>' +
              '</div>' +
            '</section>' +
            '<section class="panel">' +
              '<div class="panel-header"><h2>Modality Action</h2></div>' +
              '<div class="panel-body stack">' +
                '<label>Binding<select id="action-binding">' + bindingOptions + '</select></label>' +
                '<label>Action Type<input id="action-type" value="actuator.command" /></label>' +
                '<label>Payload<textarea id="action-payload">{ "enabled": false, "duty": 0 }</textarea></label>' +
                '<button type="button" data-action="send-action">Send Action</button>' +
              '</div>' +
            '</section>' +
          '</div>' +
          '<section class="panel">' +
            '<div class="panel-header"><h2>Safety Policies</h2></div>' +
            '<div class="panel-body"><table><thead><tr><th>Channel</th><th>Requires Arm</th><th>Max Duty</th><th>Max Pulse Us</th><th>Min Interval Ms</th></tr></thead><tbody>' + (policyRows || '<tr><td colspan="5">No policies</td></tr>') + '</tbody></table></div>' +
          '</section>';
      }

      function renderCalibration() {
        const profiles = state.calibrationProfiles || [];
        const rows = profiles.map(function (object) {
          return '<tr><td>' + escapeHtml(object.data?.profileId || object.id) + '<br><span class="muted">' + escapeHtml(object.data?.deviceKey || '') + '</span></td><td>' + escapeHtml(object.data?.profileHash || '') + '</td><td>' + escapeHtml(time(object.provenance?.createdAt)) + '</td></tr>';
        }).join('');
        el('#view-calibration').innerHTML =
          '<div class="two-col">' +
            '<section class="panel">' +
              '<div class="panel-header"><h2>Accepted Calibration Profiles</h2><span class="pill">' + profiles.length + '</span></div>' +
              '<div class="panel-body"><table><thead><tr><th>Profile</th><th>Hash</th><th>Accepted</th></tr></thead><tbody>' + (rows || '<tr><td colspan="3">No active calibration profiles</td></tr>') + '</tbody></table></div>' +
            '</section>' +
            '<section class="panel">' +
              '<div class="panel-header"><h2>Accept Profile</h2></div>' +
              '<div class="panel-body stack">' +
                '<label>Calibration Profile JSON<textarea id="calibration-profile-json">{\\n  "id": "head_serial_bridge_calibration",\\n  "name": "head_serial_bridge calibration",\\n  "deviceKey": "head_serial_bridge",\\n  "createdAt": "2026-05-20T00:00:00.000Z",\\n  "updatedAt": "2026-05-20T00:00:00.000Z",\\n  "calibrations": []\\n}</textarea></label>' +
                '<button type="button" class="primary" data-action="accept-calibration">Accept Profile</button>' +
              '</div>' +
            '</section>' +
          '</div>';
      }

      function renderGraph() {
        const filter = state.graphFilter.trim().toLowerCase();
        const objects = state.continuity.objects.filter(function (object) {
          if (!filter) return true;
          return object.type.toLowerCase().includes(filter) || JSON.stringify(object.data).toLowerCase().includes(filter);
        }).slice(-80).reverse();
        const relations = state.continuity.relations.slice(-80).reverse();
        const events = state.continuity.events.slice(-80).reverse();
        const objectRows = objects.map(function (object) {
          return '<tr><td>' + escapeHtml(object.type) + '<br><span class="muted">' + escapeHtml(shortId(object.id)) + '</span></td><td>' + json(object.data) + '</td><td>' + escapeHtml(object.version) + '</td></tr>';
        }).join('');
        const relationRows = relations.map(function (relation) {
          return '<tr><td>' + escapeHtml(relation.type) + '</td><td>' + escapeHtml(shortId(relation.sourceId)) + '</td><td>' + escapeHtml(shortId(relation.targetId)) + '</td></tr>';
        }).join('');
        el('#view-graph').innerHTML =
          '<section class="panel">' +
            '<div class="panel-header"><h2>Continuity Graph</h2><div class="row"><input id="graph-filter" value="' + escapeHtml(state.graphFilter) + '" placeholder="Filter objects" /><button type="button" data-action="apply-graph-filter">Filter</button></div></div>' +
            '<div class="panel-body stack">' +
              '<div class="three-col">' +
                '<div class="stat"><span>Objects</span><strong>' + state.continuity.objects.length + '</strong></div>' +
                '<div class="stat"><span>Relations</span><strong>' + state.continuity.relations.length + '</strong></div>' +
                '<div class="stat"><span>Events</span><strong>' + state.continuity.events.length + '</strong></div>' +
              '</div>' +
              '<table><thead><tr><th>Object</th><th>Data</th><th>Version</th></tr></thead><tbody>' + (objectRows || '<tr><td colspan="3">No objects</td></tr>') + '</tbody></table>' +
            '</div>' +
          '</section>' +
          '<section class="panel">' +
            '<div class="panel-header"><h2>Recent Relations</h2></div>' +
            '<div class="panel-body"><table><thead><tr><th>Type</th><th>Source</th><th>Target</th></tr></thead><tbody>' + (relationRows || '<tr><td colspan="3">No relations</td></tr>') + '</tbody></table></div>' +
          '</section>' +
          '<section class="panel">' +
            '<div class="panel-header"><h2>Recent Graph Events</h2></div>' +
            '<div class="panel-body"><div class="json">' + json(events) + '</div></div>' +
          '</section>';
      }

      function renderArtifacts() {
        const rows = state.artifacts.map(function (artifact) {
          return '<tr><td>' + escapeHtml(artifact.kind || artifact.type || 'artifact') + '<br><span class="muted">' + escapeHtml(shortId(artifact.id)) + '</span></td><td>' + json(artifact) + '</td></tr>';
        }).join('');
        el('#view-artifacts').innerHTML =
          '<section class="panel">' +
            '<div class="panel-header"><h2>Artifacts</h2><span class="pill">' + state.artifacts.length + '</span></div>' +
            '<div class="panel-body"><table><thead><tr><th>Artifact</th><th>Payload</th></tr></thead><tbody>' + (rows || '<tr><td colspan="2">No artifacts</td></tr>') + '</tbody></table></div>' +
          '</section>';
      }

      el('#session-form').addEventListener('submit', async function (event) {
        event.preventDefault();
        const goal = el('#goal').value.trim();
        const model = el('#model').value.trim() || undefined;
        if (!goal) return;
        setStatus('Starting session');
        const session = await window.exocortex.createSession(goal, model);
        state.selectedSessionId = session.id;
        await refresh();
      });

      el('#inject-text').addEventListener('click', async function () {
        const input = el('#app-text');
        const text = input.value.trim();
        if (!text) return;
        await window.exocortex.injectAppText(text);
        input.value = '';
        await refresh();
      });

      el('#tabs').addEventListener('click', function (event) {
        const button = event.target.closest('button[data-tab]');
        if (!button) return;
        state.selectedTab = button.dataset.tab;
        render();
      });

      document.body.addEventListener('click', async function (event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        try {
          if (action === 'refresh') await refresh();
          if (action === 'select-session') {
            state.selectedSessionId = button.dataset.sessionId;
            await refresh();
          }
          if (action === 'event-filter') {
            state.eventFilter = button.dataset.filter;
            renderTimeline();
          }
          if (action === 'stop-session' && state.selectedSessionId) {
            await window.exocortex.stopSession(state.selectedSessionId);
            await refresh();
          }
          if (action === 'create-browser') {
            const frame = await window.exocortex.createBrowserSession(state.selectedSessionId);
            state.browserFrame = frame;
            await refresh();
          }
          if (action === 'capture-browser') {
            const id = currentBrowserId();
            if (id) state.browserFrame = await window.exocortex.browserCapture(id, state.selectedSessionId);
            await refresh();
          }
          if (action === 'navigate-browser') {
            const id = currentBrowserId();
            const url = el('#browser-url').value.trim();
            if (id && url) state.browserFrame = await window.exocortex.browserDispatch(id, { type: 'navigate', url: url }, state.selectedSessionId);
            await refresh();
          }
          if (action === 'arm-actuator') {
            const channel = el('#arm-channel').value;
            const reason = el('#arm-reason').value.trim();
            if (channel) await window.exocortex.armActuator(channel, reason);
            await refresh();
          }
          if (action === 'send-action') {
            const session = selectedSession();
            const bindingId = el('#action-binding').value;
            const actionType = el('#action-type').value.trim();
            const payload = JSON.parse(el('#action-payload').value);
            if (session && bindingId && actionType) await window.exocortex.sendModalityAction(session.id, bindingId, actionType, payload);
            await refresh();
          }
          if (action === 'accept-calibration') {
            const profile = JSON.parse(el('#calibration-profile-json').value);
            await window.exocortex.acceptCalibrationProfile(profile);
            await refresh();
          }
          if (action === 'apply-graph-filter') {
            state.graphFilter = el('#graph-filter').value;
            renderGraph();
          }
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error), true);
        }
      });

      window.exocortex.onSessionEvent(scheduleRefresh);
      window.exocortex.onContinuityEvent(scheduleRefresh);
      window.exocortex.onBrowserEvent(function (event) {
        if (event && event.type === 'projection_frame') state.browserFrame = event.frame;
        scheduleRefresh();
      });
      void refresh();
    </script>
  </body>
</html>`;
}
