'use strict';

// Exercise the actual Team row renderer and its DOM click handlers. No live data
// or authentication is used. CI installs the pinned acorn/jsdom test dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const acorn = require('acorn');
const { JSDOM } = require('jsdom');

const htmlPath = process.env.TEAM_DASHBOARD_HTML || path.join(__dirname, '..', '..', 'admin-dashboard.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const sourceDom = new JSDOM(html);
const rowSources = [];
let scriptCount = 0;

function walk(node, source) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'ArrowFunctionExpression' && node.params.length === 1 && node.params[0].name === 'r') {
    const body = source.slice(node.start, node.end);
    if (body.includes('const safeName =') && body.includes('Admin.openAgentModal(') && body.includes('Admin.openTeamLeadDrilldown(')) {
      rowSources.push(body);
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, source));
    else if (value && typeof value === 'object') walk(value, source);
  }
}

for (const script of sourceDom.window.document.querySelectorAll('script:not([src])')) {
  const type = (script.getAttribute('type') || '').toLowerCase();
  if (type && type !== 'text/javascript' && type !== 'application/javascript' && type !== 'module') continue;
  const source = script.textContent;
  const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: type === 'module' ? 'module' : 'script' });
  scriptCount++;
  walk(ast, source);
}
sourceDom.window.close();
assert.equal(rowSources.length, 1, 'Locate exactly one production Team row renderer');

const cases = [
  ['Mohamed "Jimmy" Gamal', 'jimmy@example.test'],
  ['John Lloyd Reyes', 'john@example.test'],
  ["O'Connor", "o'connor@example.test"],
  ['Anne \\ "Ace" O\'Neil & <Ops>', 'quoted"name@example.test'],
  ['Literal &quot; and &#39; text', 'agent&tag@example.test'],
  ['First\nLast', 'first@example.test'],
  ['First\r\nLast', 'line\\name@example.test'],
  ['Agent\u2028Line\u2029End', 'unicode@example.test'],
  ['</button><img src=x onerror="window.injected=true">', "x');window.injected=true;//"],
  ['Mohamed “Jimmy” Gamal', 'curly@example.test']
];

test('all dashboard inline JavaScript parses', () => {
  assert.ok(scriptCount > 0);
});

for (const [name, email] of cases) {
  test(`Team name and all four lead-count buttons: ${JSON.stringify(name)}`, () => {
    const dom = new JSDOM('<!doctype html><table><tbody id="rows"></tbody></table>', {
      url: 'https://example.test/',
      runScripts: 'dangerously'
    });
    try {
      const calls = [];
      const errors = [];
      dom.window.addEventListener('error', event => {
        errors.push(event.error || event.message);
        event.preventDefault();
      });
      dom.window.Admin = {
        openAgentModal: (...args) => calls.push(['modal', ...args]),
        openTeamLeadDrilldown: (...args) => calls.push(['leads', ...args])
      };
      const renderRow = dom.window.eval(`(${rowSources[0]})`);
      const tbody = dom.window.document.getElementById('rows');
      const row = {
        id: 'test-agent', agentId: 'test-agent', name, email,
        total: 12, rejected: 1, qualified: 11, credited: 0, cancelRate: 0,
        weekNo: 1, warned: false, status: 'active', team_status: 'active'
      };
      // Re-render to cover rows rebuilt after Team filters/sorting/refresh.
      for (let pass = 0; pass < 2; pass++) {
        calls.length = 0;
        tbody.innerHTML = renderRow(row);
        const buttons = [...tbody.querySelectorAll('button[onclick]')].filter(button =>
          /Admin\.open(?:AgentModal|TeamLeadDrilldown)\(/.test(button.getAttribute('onclick'))
        );
        assert.equal(buttons.length, 5, 'Name plus total/rejected/qualified/credited controls remain present');
        assert.equal(buttons[0].textContent.trim(), name.replace(/\r\n?/g, '\n'), 'Display name remains unchanged plain text');
        assert.deepEqual(buttons.slice(1).map(button => button.textContent.trim()), ['12', '1', '11', '0']);
        assert.equal(tbody.querySelector('img,svg,script'), null, 'Agent names cannot create markup');
        buttons.forEach(button => button.click());
        assert.deepEqual(errors, [], 'Click handlers must not throw');
        assert.deepEqual(calls, [
          ['modal', name, email],
          ['leads', name, email, 'total'],
          ['leads', name, email, 'rejected'],
          ['leads', name, email, 'qualified'],
          ['leads', name, email, 'credited']
        ], 'All drilldowns receive the exact original agent name and email');
        assert.equal(dom.window.injected, undefined, 'Agent values are data, never executable code');
      }
    } finally {
      dom.window.close();
    }
  });
}
