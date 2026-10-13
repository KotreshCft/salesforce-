const SUPABASE_URL = 'https://ozkbnimjuhaweigscdby.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96a2JuaW1qdWhhd2VpZ3NjZGJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyODc4NDYsImV4cCI6MjA2Njg2Mzg0Nn0.C4OgN-JEBX9ZqnRDXU9XmGnED2pCh3kI82GrHPXtq8U';

const state = {
  pin: '',
  activeTab: 'registrations',
  search: '',
  status: 'all',
  data: { registrations: [], workshop_requests: [], case_study_emails: [] }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function clean(value) {
  const text = String(value ?? '').trim();
  if (!text || text === 'Not provided' || text === '0000000000' || text.endsWith('@no-email.invalid')) return '—';
  return text;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(typeof value === 'number' ? value : String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(date);
}

function secondsFromLabel(value) {
  const text = String(value || '');
  const hours = Number(text.match(/([\d.]+)h/)?.[1] || 0);
  const minutes = Number(text.match(/([\d.]+)m/)?.[1] || 0);
  const seconds = Number(text.match(/([\d.]+)s/)?.[1] || 0);
  return Math.round(hours * 3600 + minutes * 60 + seconds);
}

function duration(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function activeSeconds(row) {
  const direct = Number(row.total_active_seconds);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const pageDetails = pageTotals(row);
  const sum = Object.values(pageDetails).reduce((total, item) => total + Number(item?.activeSeconds || item?.active_seconds || 0), 0);
  return sum || secondsFromLabel(row.total_active_time);
}

function pageTotals(row) {
  const flow = parseJson(row.flow_json, {});
  return parseJson(flow.pageTotals ?? row.page_time_details, {});
}

function pageVisits(row) {
  const flow = parseJson(row.flow_json, {});
  return parseJson(flow.pageVisits ?? row.page_visits, []);
}

function activityEvents(row) {
  const flow = parseJson(row.flow_json, {});
  return parseJson(flow.events ?? row.activity_events, []);
}

function labelPage(page) {
  const labels = {
    welcome: 'Welcome', home: 'Explore', library: 'Industry & story library',
    detail: 'Demo / story detail', thanks: 'Session recap',
    industry_demos: 'Industry demos', customer_stories: 'Customer stories',
    demo_detail: 'Demo detail', story_detail: 'Story detail'
  };
  return labels[page] || String(page || 'Unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function loadData(pin, { fromLogin = false } = {}) {
  const button = fromLogin ? $('#loginButton') : $('#refreshButton');
  button.disabled = true;
  $('#loginError').textContent = '';
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_salesforce_dashboard_data`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin_pin: pin })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body?.message || `Supabase returned ${response.status}`;
      if (response.status === 404 || /schema cache|function/i.test(message)) throw new Error('SETUP_REQUIRED');
      if (/Incorrect staff PIN/i.test(message)) throw new Error('Incorrect staff PIN. Please try again.');
      throw new Error(message);
    }
    state.pin = pin;
    state.data = {
      registrations: Array.isArray(body.registrations) ? body.registrations : [],
      workshop_requests: Array.isArray(body.workshop_requests) ? body.workshop_requests : [],
      case_study_emails: Array.isArray(body.case_study_emails) ? body.case_study_emails : []
    };
    $('#loginScreen').classList.add('hidden');
    $('#syncStatus').textContent = `Updated ${formatDate(body.generated_at || new Date())}`;
    render();
  } catch (error) {
    if (error.message === 'SETUP_REQUIRED') {
      $('#loginError').innerHTML = 'Dashboard access is not enabled yet. Run <strong>supabase_remote_dashboard.sql</strong> once in the Supabase SQL Editor.';
    } else {
      $('#loginError').textContent = error.message === 'Failed to fetch' ? 'Could not reach Supabase. Check the internet connection.' : error.message;
    }
    if (!fromLogin) $('#loginScreen').classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
}

function filteredRows() {
  const key = state.activeTab === 'registrations' ? 'registrations' : state.activeTab === 'workshops' ? 'workshop_requests' : 'case_study_emails';
  const query = state.search.toLowerCase();
  return state.data[key].filter((row) => {
    if (state.activeTab === 'registrations' && state.status !== 'all' && row.session_status !== state.status) return false;
    return !query || Object.entries(row).some(([field, value]) => !['page_time_details','page_visits','activity_events','flow_json'].includes(field) && String(value ?? '').toLowerCase().includes(query));
  });
}

function renderMetrics() {
  const rows = state.data.registrations;
  const totalActive = rows.reduce((sum, row) => sum + activeSeconds(row), 0);
  const interactions = rows.reduce((sum, row) => sum + Number(row.interaction_count || activityEvents(row).length || 0), 0);
  const items = [
    ['Registered visitors', rows.length],
    ['Completed sessions', rows.filter((row) => row.session_status === 'completed').length],
    ['Active time', duration(totalActive)],
    ['Interactions', interactions],
    ['Workshop requests', state.data.workshop_requests.length]
  ];
  $('#metricGrid').innerHTML = items.map(([label,value]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join('');
  $('#registrationCount').textContent = rows.length;
  $('#workshopCount').textContent = state.data.workshop_requests.length;
  $('#mailCount').textContent = state.data.case_study_emails.length;
  $('#totalRecords').textContent = rows.length + state.data.workshop_requests.length + state.data.case_study_emails.length;
}

function renderRegistrationTable(rows) {
  return `<table><thead><tr><th>Visitor</th><th>City / Industry</th><th>Session</th><th>Time</th><th>Activity</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `
    <tr data-id="${escapeHtml(row.session_id)}">
      <td><span class="name">${escapeHtml(clean(row.full_name))}</span><span class="subtle">${escapeHtml(clean(row.work_email))}</span></td>
      <td><span class="name">${escapeHtml(clean(row.participant_city))}</span><span class="subtle">${escapeHtml(clean(row.industry))} · App: ${escapeHtml(clean(row.application_city))}</span></td>
      <td><span class="name">${escapeHtml(formatDate(row.started_at))}</span><span class="subtle">${escapeHtml(row.session_id)}</span></td>
      <td><span class="name">${escapeHtml(duration(activeSeconds(row)))} active</span><span class="subtle">${escapeHtml(clean(row.total_session_time))} open</span></td>
      <td><span class="name">${escapeHtml(row.pages_viewed_count || pageVisits(row).length || 0)} pages</span><span class="subtle">${escapeHtml(row.interaction_count || activityEvents(row).length || 0)} interactions</span></td>
      <td><span class="pill ${escapeHtml(row.session_status)}">${escapeHtml(row.session_status || 'active')}</span></td>
    </tr>`).join('')}</tbody></table>`;
}

function renderWorkshopTable(rows) {
  return `<table><thead><tr><th>Visitor</th><th>Contact</th><th>Focus area</th><th>Challenge</th><th>Format</th><th>Requested</th></tr></thead><tbody>${rows.map((row) => `
    <tr><td><span class="name">${escapeHtml(clean(row.full_name))}</span><span class="subtle">${escapeHtml(row.session_id)}</span></td>
    <td><span class="name">${escapeHtml(clean(row.work_email))}</span><span class="subtle">${escapeHtml(clean(row.mobile_number))}</span></td>
    <td>${escapeHtml(clean(row.focus_choices || row.selected_focus))}</td><td>${escapeHtml(clean(row.challenge))}</td>
    <td><span class="pill">${escapeHtml(clean(row.preferred_format))}</span></td><td>${escapeHtml(formatDate(row.requested_at))}</td></tr>`).join('')}</tbody></table>`;
}

function renderMailTable(rows) {
  return `<table><thead><tr><th>Visitor</th><th>Email</th><th>Selected stories</th><th>Count</th><th>Sent</th></tr></thead><tbody>${rows.map((row) => `
    <tr><td><span class="name">${escapeHtml(clean(row.full_name))}</span><span class="subtle">${escapeHtml(row.session_id)}</span></td>
    <td>${escapeHtml(clean(row.work_email))}</td><td>${escapeHtml(clean(row.selected_studies))}</td>
    <td>${escapeHtml(row.selected_count || 0)}</td><td>${escapeHtml(formatDate(row.sent_at))}</td></tr>`).join('')}</tbody></table>`;
}

function renderTable() {
  const rows = filteredRows();
  if (!rows.length) {
    $('#tableWrap').innerHTML = '<div class="empty"><strong>No matching records</strong><br>Try another search or refresh the dashboard.</div>';
    return;
  }
  $('#tableWrap').innerHTML = state.activeTab === 'registrations' ? renderRegistrationTable(rows) : state.activeTab === 'workshops' ? renderWorkshopTable(rows) : renderMailTable(rows);
  if (state.activeTab === 'registrations') {
    $$('tbody tr[data-id]').forEach((row) => row.addEventListener('click', () => openDrawer(row.dataset.id)));
  }
}

function render() {
  renderMetrics();
  renderTable();
  $('#statusFilter').style.display = state.activeTab === 'registrations' ? '' : 'none';
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.activeTab));
}

function detailCard(label, value) {
  return `<div class="detail-card"><small>${escapeHtml(label)}</small><strong>${escapeHtml(clean(value))}</strong></div>`;
}

function openDrawer(id) {
  const row = state.data.registrations.find((item) => item.session_id === id);
  if (!row) return;
  $('#drawerTitle').textContent = clean(row.full_name) === '—' ? 'Visitor journey' : row.full_name;
  const totals = pageTotals(row);
  const visits = pageVisits(row);
  const events = activityEvents(row);
  const demos = parseJson(row.demos_opened, []);
  const stories = parseJson(row.stories_opened, []);
  const totalOpenSeconds = secondsFromLabel(row.total_session_time) || visits.reduce((sum, item) => sum + Number(item.durationSeconds || 0), 0);
  const pageHtml = Object.entries(totals).map(([key,item]) => `<div class="page-row"><strong>${escapeHtml(labelPage(item.page || key))}<span class="subtle">${escapeHtml(item.visits || 0)} visit${Number(item.visits) === 1 ? '' : 's'}</span></strong><span>${escapeHtml(duration(item.activeSeconds || 0))}<br>active</span><span>${escapeHtml(duration(item.durationSeconds || 0))}<br>open</span></div>`).join('') || '<p class="subtle">No page timing data.</p>';
  const journeyHtml = visits.map((item) => `<div class="journey-item"><strong>${escapeHtml(labelPage(item.page))}</strong><p>Entered ${escapeHtml(formatDate(item.enteredAtIso || item.enteredAt))}${item.closedAt || item.closedAtIso ? ` · Left ${escapeHtml(formatDate(item.closedAtIso || item.closedAt))}` : ''}</p><p><b>${escapeHtml(duration(item.activeSeconds || 0))}</b> active · ${escapeHtml(duration(item.durationSeconds || 0))} open</p></div>`).join('') || '<p class="subtle">No visitor journey recorded.</p>';
  const tags = [...demos.map((item) => `Demo: ${typeof item === 'string' ? item : item.title || item.item || 'Viewed'}`), ...stories.map((item) => `Story: ${typeof item === 'string' ? item : item.title || item.item || 'Viewed'}`)];
  const eventHtml = events.slice().reverse().slice(0,100).map((item) => `<div class="journey-item"><strong>${escapeHtml(item.item || item.type || 'Interaction')}</strong><p>${escapeHtml(item.details || item.view || '')}</p><p>${escapeHtml(formatDate(item.timeIso || item.time))}</p></div>`).join('') || '<p class="subtle">No interaction events recorded.</p>';
  $('#drawerContent').innerHTML = `
    <div class="detail-grid">${detailCard('Email',row.work_email)}${detailCard('Industry',row.industry)}${detailCard('Visitor city',row.participant_city)}${detailCard('Application city',row.application_city)}${detailCard('Session started',formatDate(row.started_at))}${detailCard('Activity finished',formatDate(row.finished_at))}${detailCard('Last activity',formatDate(row.last_activity_at))}${detailCard('Session ID',row.session_id)}</div>
    <div class="mini-metrics"><div class="mini-metric"><strong>${escapeHtml(duration(activeSeconds(row)))}</strong><small>Active time</small></div><div class="mini-metric"><strong>${escapeHtml(duration(totalOpenSeconds))}</strong><small>Total time</small></div><div class="mini-metric"><strong>${escapeHtml(row.pages_viewed_count || visits.length || 0)}</strong><small>Pages</small></div><div class="mini-metric"><strong>${escapeHtml(row.interaction_count || events.length || 0)}</strong><small>Interactions</small></div></div>
    <h3 class="section-title">Time spent on each page</h3><div>${pageHtml}</div>
    <h3 class="section-title">Demos and stories opened</h3><div class="tag-list">${tags.length ? tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('') : '<span class="subtle">None recorded.</span>'}</div>
    <h3 class="section-title">Visitor journey</h3><div class="journey">${journeyHtml}</div>
    <h3 class="section-title">Interaction timeline</h3><div class="journey">${eventHtml}</div>`;
  $('#drawerBackdrop').hidden = false;
  $('#detailDrawer').classList.add('open');
  $('#detailDrawer').setAttribute('aria-hidden','false');
}

function closeDrawer() {
  $('#detailDrawer').classList.remove('open');
  $('#detailDrawer').setAttribute('aria-hidden','true');
  $('#drawerBackdrop').hidden = true;
}

function csvCell(value) {
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return `"${text.replaceAll('"','""')}"`;
}

function exportCsv() {
  const rows = filteredRows();
  if (!rows.length) return;
  const excluded = new Set(['write_token']);
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => !excluded.has(key));
  const csv = [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\r\n');
  const blob = new Blob(['\ufeff',csv], { type:'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `salesforce-${state.activeTab}-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

$('#loginForm').addEventListener('submit', (event) => { event.preventDefault(); loadData($('#pinInput').value.trim(), { fromLogin:true }); });
$('#refreshButton').addEventListener('click', () => loadData(state.pin));
$('#logoutButton').addEventListener('click', () => { state.pin = ''; $('#pinInput').value = ''; $('#loginScreen').classList.remove('hidden'); });
$('#searchInput').addEventListener('input', (event) => { state.search = event.target.value.trim(); renderTable(); });
$('#statusFilter').addEventListener('change', (event) => { state.status = event.target.value; renderTable(); });
$('#exportButton').addEventListener('click', exportCsv);
$$('.tab').forEach((tab) => tab.addEventListener('click', () => { state.activeTab = tab.dataset.tab; render(); }));
$('#closeDrawer').addEventListener('click', closeDrawer);
$('#drawerBackdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDrawer(); });
