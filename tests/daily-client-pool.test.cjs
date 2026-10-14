'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('admin-dashboard.html', 'utf8');
const start = source.indexOf('// DAILY CLIENT POOL COMPATIBILITY START');
const end = source.indexOf('// DAILY CLIENT POOL COMPATIBILITY END', start);
assert.ok(start >= 0 && end > start, 'client pool compatibility helpers are installed');
const helpersSource = source.slice(start, end);
function makeAdmin(document = {}) {
  return vm.runInNewContext(`({${helpersSource}})`, { document, window: {} });
}
const admin = makeAdmin();
const row = (extra = {}) => ({
  code: 'Client 001', searchName: 'Example Roofing', clientName: 'Example Contact',
  passbookStatus: 'ACTIVE', packageStatus: 'ONGOING', dealStatus: 'PAID', ...extra
});
const codes = rows => Array.from(rows, value => value.code);

test('legacy imported package status falls back to the stored active client status', () => {
  for (const value of ['Pause', 'PAUSED', ' ongoing ', 'Completed', 'Refunded', '', null]) {
    assert.equal(admin.resolvePassbookClientStatus({ client_status: value, status: ' active ' }), 'ACTIVE');
  }
});

test('explicit current client exclusions cannot be overridden by an old active status', () => {
  for (const value of ['Inactive', 'Blacklisted']) {
    assert.equal(admin.resolvePassbookClientStatus({ client_status: value, status: 'ACTIVE' }), value.toUpperCase());
  }
  assert.equal(admin.resolvePassbookClientStatus({ client_status: 'Active', status: 'INACTIVE' }), 'ACTIVE');
});

test('unknown and missing client statuses fail closed', () => {
  assert.equal(admin.resolvePassbookClientStatus(), 'INACTIVE');
  assert.equal(admin.resolvePassbookClientStatus({ client_status: 'Pause' }), 'INACTIVE');
  assert.equal(admin.resolvePassbookClientStatus({ client_status: 'Unrecognized', status: 'ACTIVE' }), 'INACTIVE');
  assert.equal(admin.resolvePassbookClientStatus({ client_status: 'Pause', status: 'BLACKLISTED' }), 'BLACKLISTED');
  assert.equal(admin.resolvePassbookClientStatus({ client_status: '', status: 'Inactive' }), 'INACTIVE');
});

test('the actual health-row normalizer resolves old fields without changing package truth', () => {
  const methodStart = source.indexOf('normalizeClientHealthRows(allocationRows, rawClients = [], packages = []) {');
  const methodEnd = source.indexOf('// --- NEW SALES PIPELINE ENGINE ---', methodStart);
  assert.ok(methodStart >= 0 && methodEnd > methodStart);
  const method = vm.runInNewContext(`({${source.slice(methodStart, methodEnd)}})`, { window: {} });
  const context = { ...admin, getState: () => ({ clientHealthView: [] }) };
  const allocation = { client_code: 'Client 001', package_id: 'example-package', package_status: 'ACTIVE', purchased_leads: 20, qualified_leads: 8, owed_leads: 12 };
  const client = { id: 'example-client', client_code: 'Client 001', company_name: 'Example Roofing', status: 'ACTIVE', client_status: 'Pause' };
  const pkg = { id: 'example-package', status: 'ACTIVE', deal_status: 'PAID' };
  const before = JSON.stringify({ allocation, client, pkg });
  const normalized = method.normalizeClientHealthRows.call(context, [allocation], [client], [pkg]);
  assert.equal(normalized[0].passbookStatus, 'ACTIVE');
  assert.equal(normalized[0].packageStatus, 'ONGOING');
  assert.equal(normalized[0].owedRemaining, 12);
  assert.deepEqual(codes(admin.getDailyClientPoolRows(normalized, 'ONGOING', 'example')), ['Client 001']);
  assert.deepEqual(codes(admin.getDailyClientPoolRows(normalized, 'ALL', '001')), ['Client 001']);
  assert.equal(admin.getDailyClientPoolRows(normalized, 'PAUSE').length, 0);
  assert.equal(JSON.stringify({ allocation, client, pkg }), before, 'source records are not mutated');
  const paused = method.normalizeClientHealthRows.call(context, [allocation], [client], [{ ...pkg, status: 'Pause' }]);
  assert.equal(paused[0].packageStatus, 'PAUSE');
  assert.equal(admin.getDailyClientPoolRows(paused, 'ONGOING').length, 0);
  assert.equal(admin.getDailyClientPoolRows(paused, 'PAUSE').length, 1);
});

test('ONGOING, PAUSE and ALL respect package statuses', () => {
  const rows = [row(), row({ code: 'Client 002', packageStatus: 'PAUSE' })];
  assert.deepEqual(codes(admin.getDailyClientPoolRows(rows)), ['Client 001']);
  assert.deepEqual(codes(admin.getDailyClientPoolRows(rows, 'PAUSE')), ['Client 002']);
  assert.deepEqual(codes(admin.getDailyClientPoolRows(rows, 'ALL')), ['Client 001', 'Client 002']);
  assert.equal(admin.getDailyClientPoolRows([row({ packageStatus: ' paused ' })], 'pause').length, 1);
  assert.equal(admin.getDailyClientPoolRows([row({ packageStatus: ' active ' })], 'active').length, 1);
});

test('ALL never reintroduces completed, refunded, inactive or blacklisted clients', () => {
  const excluded = [
    row({ packageStatus: 'COMPLETED' }), row({ packageStatus: 'REFUNDED' }),
    row({ dealStatus: 'REFUNDED' }), row({ passbookStatus: 'INACTIVE' }),
    row({ passbookStatus: 'BLACKLISTED' }), row({ packageStatus: '' }), row({ code: '' })
  ];
  assert.equal(admin.getDailyClientPoolRows(excluded, 'ALL').length, 0);
});

test('clients on the selected day and shift board stay out of the pool', () => {
  assert.equal(admin.getDailyClientPoolRows([row()], 'ALL', '', new Set(['  CLIENT 001  '])).length, 0);
  assert.equal(admin.getDailyClientPoolRows([row()], 'ALL', '', new Set(['Client 002'])).length, 1);
  assert.equal(admin.getDailyClientPoolRows([row()], 'ALL', '', new Set()).length, 1);
});

test('search supports case-insensitive names, client numbers and contact names', () => {
  const rows = [row()];
  for (const query of ['EXAMPLE', '  roofing ', '001', 'contact']) {
    assert.equal(admin.getDailyClientPoolRows(rows, 'ALL', query).length, 1);
  }
  assert.equal(admin.getDailyClientPoolRows(rows, 'ALL', 'another company').length, 0);
  assert.equal(admin.getDailyClientPoolRows([row({ searchName: '', roofingCompany: 'Example Roofing <span>RENEWAL</span>' })], 'ALL', 'roofing renewal').length, 1);
  assert.equal(admin.getDailyClientPoolRows(null).length, 0);
});

test('empty-state recovery changes only the package filter and re-renders', () => {
  const select = { value: 'PAUSE' };
  const search = { value: 'example' };
  const instance = makeAdmin({ getElementById: id => id === 'daily-client-pool-status' ? select : search });
  let calls = 0;
  instance.dailyStrategySelectedDate = '2026-01-01';
  instance.dailyStrategyShift = 'afternoon';
  instance.renderDailyTab = () => ++calls;
  assert.equal(instance.showAllDailyClientPoolStatuses(), 1);
  assert.equal(select.value, 'ALL');
  assert.equal(search.value, 'example');
  assert.equal(instance.dailyStrategySelectedDate, '2026-01-01');
  assert.equal(instance.dailyStrategyShift, 'afternoon');
  assert.equal(calls, 1);
  assert.ok(source.includes('onclick="Admin.showAllDailyClientPoolStatuses()"'));
  assert.ok(source.includes('const activeClientPool = this.getDailyClientPoolRows('));
});

test('all admin inline scripts remain valid JavaScript', () => {
  const scripts = Array.from(source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi));
  assert.ok(scripts.length > 0);
  scripts.forEach((match, index) => new vm.Script(match[1], { filename: `admin-inline-${index}.js` }));
});
