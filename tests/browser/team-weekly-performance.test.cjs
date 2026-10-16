'use strict';

// Run the real dashboard object and real modal markup with synthetic in-memory
// data. No login, database request, production lead record, or handler stub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const htmlPath = process.env.TEAM_DASHBOARD_HTML || path.join(__dirname, '..', '..', 'admin-dashboard.html');
const sourceDom = new JSDOM(fs.readFileSync(htmlPath, 'utf8'));
const sourceDocument = sourceDom.window.document;
const dashboardSources = [];
function walk(node, source) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id?.name === 'AdminDashboard' && node.init?.type === 'ObjectExpression') {
    dashboardSources.push(source.slice(node.init.start, node.init.end));
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, source));
    else if (value && typeof value === 'object') walk(value, source);
  }
}
for (const script of sourceDocument.querySelectorAll('script:not([src])')) {
  const type = (script.getAttribute('type') || '').toLowerCase();
  if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) continue;
  const source = script.textContent;
  walk(acorn.parse(source, { ecmaVersion: 'latest', sourceType: type === 'module' ? 'module' : 'script' }), source);
}
assert.equal(dashboardSources.length, 1, 'Locate exactly one production AdminDashboard object');
const markup = ['view-team', 'agent-modal'].map(id => {
  const element = sourceDocument.getElementById(id);
  assert.ok(element, `Production markup includes ${id}`);
  return element.outerHTML;
}).join('');
sourceDom.window.close();

const NAME = 'Mohamed "Jimmy" Gamal';
const EMAIL = 'jimmy@example.test';
function agent(overrides = {}) {
  return { id: 'fixture-jimmy', agent_name: NAME, name: NAME, agent_email: EMAIL, email: EMAIL,
    employment_status: 'active', role: 'agent', active_start_date: '2026-10-12', ...overrides };
}
function lead(id, status = 'Confirmed', date = '2026-10-16T12:00:00', overrides = {}) {
  return { id, appointment_coordinator_name: NAME, agent_email: EMAIL, date_submitted: date,
    status, company_name: 'Synthetic test client', homeowner_names: `Synthetic ${id}`, ...overrides };
}
function fixture(options = {}) {
  const state = {
    agents: options.agents || [agent()],
    leads: options.leads || [],
    payrollWeeklyFactView: []
  };
  const originalState = JSON.stringify(state);
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, {
    url: 'https://example.test/admin-dashboard.html#team', runScripts: 'dangerously'
  });
  const win = dom.window;
  const errors = [];
  win.addEventListener('error', event => { errors.push(event.error || event.message); event.preventDefault(); });
  win.__testNow = options.now || '2026-10-16T12:00:00';
  win.eval(`{
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [window.__testNow])); }
      static now() { return new NativeDate(window.__testNow).getTime(); }
    };
  }`);
  win.portal = { adminState: state };
  win.eval(`window.Admin = (${dashboardSources[0]});`);
  const Admin = win.Admin;
  // Inject only the data source, not any renderer, date/metric helper, or click handler.
  Admin.getState = () => state;
  Admin.teamPeriod = 'selected-week';
  Admin._teamSelectedWeek = options.selectedWeek || '2026-10-10|2026-10-16';
  const document = win.document;
  return {
    win, Admin, document, state,
    clickName(name = NAME) {
      Admin.renderTeam();
      const button = [...document.querySelectorAll('#team-body button')].find(b =>
        b.getAttribute('onclick')?.includes('Admin.openAgentModal(') && b.textContent.trim() === name);
      assert.ok(button, 'Agent has a clickable Team name');
      button.click();
      assert.deepEqual(errors, [], 'Name click and weekly rendering must not throw');
      assert.equal(document.getElementById('agent-modal').classList.contains('hidden'), false);
    },
    weeks() { return Array.from(Admin._agentWeeklyRows || []); },
    metric(type, index = 0) {
      const button = [...document.querySelectorAll('#agent-weekly-performance-body button')].find(b =>
        b.getAttribute('onclick') === `Admin.openAgentLeadDrilldown(${index}, '${type}')`);
      assert.ok(button, `Weekly ${type} metric button exists`);
      button.click();
      assert.deepEqual(errors, [], 'Weekly metric must render actual lead details without errors');
      assert.equal(document.getElementById('agent-drilldown-section').classList.contains('hidden'), false);
      return [...document.querySelectorAll('#agent-leads-body tr')].filter(tr => tr.children.length === 12);
    },
    close() {
      try {
        assert.deepEqual(errors, [], 'No browser errors');
        assert.equal(JSON.stringify(state), originalState, 'Rendering must not change agent or lead data');
      } finally { win.close(); }
    }
  };
}
function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// This is the reported path: real name button -> real weekly renderer -> real
// weekly metric button -> real lead-detail rows. Previously the weekly body was empty.
test('Monday starter has Week 1 and all twelve leads before the next Saturday', () => {
  const leads = Array.from({ length: 12 }, (_, i) => lead(`jimmy-${i + 1}`, i === 11 ? 'Rejected' : 'Confirmed'));
  leads.push(lead('other-agent', 'Confirmed', '2026-10-16T12:00:00', {
    appointment_coordinator_name: 'Another Agent', agent_email: 'another@example.test'
  }));
  const f = fixture({ leads });
  try {
    f.clickName();
    const weeks = f.weeks();
    assert.equal(weeks.length, 1, 'First partial workweek must not disappear');
    assert.equal(weeks[0].weekNumber, 1);
    assert.equal(localDate(weeks[0].start), '2026-10-10');
    assert.equal(localDate(weeks[0].end), '2026-10-16');
    assert.deepEqual([weeks[0].total, weeks[0].qualified, weeks[0].rejected, weeks[0].credited], [12, 11, 1, 0]);
    assert.match(f.document.getElementById('agent-weekly-performance-body').textContent, /Week 1/);
    assert.equal(f.metric('total').length, 12);
    assert.equal(f.metric('qualified').length, 11);
    assert.equal(f.metric('rejected').length, 1);
    assert.equal(f.metric('credited').length, 0);
    assert.match(f.document.getElementById('agent-leads-body').textContent, /No leads found/);
  } finally { f.close(); }
});

for (const day of [10, 11, 12, 13, 14, 15, 16]) {
  test(`Start on October ${day} includes the current Saturday-Friday week`, () => {
    const f = fixture({ agents: [agent({ active_start_date: `2026-10-${day}` })], leads: [lead('current')] });
    try {
      f.clickName();
      assert.equal(f.weeks().length, 1);
      assert.equal(f.weeks()[0].total, 1);
      assert.equal(localDate(f.weeks()[0].start), '2026-10-10');
    } finally { f.close(); }
  });
}

test('Saturday rollover keeps Week 1, adds Week 2, and assigns midnight boundaries once', () => {
  const f = fixture({ now: '2026-10-17T12:00:00', leads: [
    lead('friday-end', 'Confirmed', '2026-10-16T23:59:59.999'),
    lead('saturday-start', 'Credited', '2026-10-17T00:00:00')
  ] });
  try {
    f.clickName();
    assert.deepEqual(f.weeks().map(w => w.weekNumber), [2, 1]);
    assert.deepEqual(f.weeks().map(w => w.total), [1, 1]);
    assert.equal(localDate(f.weeks()[0].start), '2026-10-17');
    assert.equal(localDate(f.weeks()[1].end), '2026-10-16');
    assert.match(f.metric('total', 0)[0].textContent, /Synthetic saturday-start/);
    assert.match(f.metric('total', 1)[0].textContent, /Synthetic friday-end/);
  } finally { f.close(); }
});

test('Selected previous week does not erase the most-recent-first weekly history', () => {
  const f = fixture({ agents: [agent({ active_start_date: '2026-10-05' })],
    selectedWeek: '2026-10-03|2026-10-09', leads: [
      lead('previous', 'Confirmed', '2026-10-09T12:00:00'), lead('current', 'Rejected')
    ] });
  try {
    f.clickName();
    assert.deepEqual(f.weeks().map(w => w.weekNumber), [2, 1]);
    assert.deepEqual(f.weeks().map(w => w.total), [1, 1]);
    assert.equal(f.metric('total', 1).length, 1);
  } finally { f.close(); }
});

test('An active agent with no leads gets a real zero-count week, not an empty table', () => {
  const f = fixture();
  try {
    f.clickName();
    assert.equal(f.weeks().length, 1);
    assert.equal(f.weeks()[0].total, 0);
    assert.equal(f.metric('total').length, 0);
  } finally { f.close(); }
});

for (const overrides of [
  { active_start_date: null, start_date: '2026-10-12' },
  { active_start_date: '2026-10-12T12:00:00Z' },
  { active_start_date: ' 2026-10-12 ' }
]) {
  test(`Valid start date form renders: ${JSON.stringify(overrides)}`, () => {
    const f = fixture({ agents: [agent(overrides)], leads: [lead('current')] });
    try {
      f.clickName();
      assert.equal(f.weeks().length, 1);
      assert.equal(f.weeks()[0].total, 1);
    } finally { f.close(); }
  });
}

for (const [startDate, expected] of [
  [null, /Missing active_start_date/], ['not-a-date', /Invalid active start date/],
  ['2026-10-19', /has not started yet/]
]) {
  test(`Unusable start date shows an explanation and clears another agent's cached leads: ${startDate}`, () => {
    const second = agent({ id: 'fixture-second', name: 'Second Agent', agent_name: 'Second Agent',
      email: 'second@example.test', agent_email: 'second@example.test', active_start_date: startDate });
    const f = fixture({ agents: [agent(), second], leads: [lead('private-to-first-agent')] });
    try {
      f.clickName();
      f.metric('total');
      f.Admin.openAgentModal(second.name, second.email);
      assert.equal(f.weeks().length, 0);
      assert.match(f.document.getElementById('agent-weekly-performance-body').textContent, expected);
      assert.doesNotMatch(f.document.getElementById('agent-leads-body').textContent, /private-to-first-agent/);
      assert.equal(f.document.getElementById('agent-drilldown-section').classList.contains('hidden'), true);
      assert.equal(f.document.getElementById('agent-weekly-performance-body').closest('.bg-white.rounded-2xl').classList.contains('hidden'), false);
    } finally { f.close(); }
  });
}

test('Future start inside this same calendar week does not create an active week prematurely', () => {
  const f = fixture({ now: '2026-10-14T12:00:00', agents: [agent({ active_start_date: '2026-10-16' })] });
  try {
    f.clickName();
    assert.equal(f.weeks().length, 0);
    assert.match(f.document.getElementById('agent-weekly-performance-body').textContent, /has not started yet/);
  } finally { f.close(); }
});

test('Reopening the weekly view after a Team metric restores weekly section visibility', () => {
  const f = fixture({ leads: [lead('current')] });
  try {
    f.Admin.openTeamLeadDrilldown(NAME, EMAIL, 'total');
    f.clickName();
    assert.equal(f.weeks().length, 1);
    assert.equal(f.document.getElementById('agent-weekly-performance-body').closest('.bg-white.rounded-2xl').classList.contains('hidden'), false);
    assert.equal(f.metric('total').length, 1);
  } finally { f.close(); }
});

test('Saturday-Friday calendar boundaries remain stable across daylight saving change', () => {
  const f = fixture({ now: '2026-11-06T12:00:00', agents: [agent({ active_start_date: '2026-10-26' })], leads: [
    lead('before-dst', 'Confirmed', '2026-10-30T23:59:59.999'),
    lead('after-dst', 'Confirmed', '2026-11-06T23:59:59.999')
  ] });
  try {
    f.clickName();
    assert.deepEqual(f.weeks().map(w => localDate(w.start)), ['2026-10-31', '2026-10-24']);
    assert.deepEqual(f.weeks().map(w => w.total), [1, 1]);
  } finally { f.close(); }
});
