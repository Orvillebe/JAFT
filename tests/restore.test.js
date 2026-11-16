/**
 * Tests for tools/restore.js: a backup becomes an SQL script that restores it.
 * Run: node tests/restore.test.js (no dependencies).
 * Optional: node tests/restore.test.js out.sql  writes the generated script, e.g. for a syntax check.
 */

const assert = require('assert');
const fs = require('fs');
global.SCHEMA_VERSION = require('../version.js').SCHEMA_VERSION;
global.newId = () => 'id-' + Math.random().toString(36).slice(2);
const CFG = require('../config.js');
const M = require('../model.js')(CFG);
const makeTestData = require('./testdata.js');
const createLocalData = require('../data-local.js');
const buildRestoreSql = require('../tools/restore.js');

let ok = 0;
function test(name, fn) {
  try { fn(); ok++; } catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

const local = createLocalData();
const upgrade = b => local.upgradeBackup(b);
const data = makeTestData(CFG, M);
delete data.schemaVersion;
const backup = { app: 'JAFT', kind: 'backup', appVersion: 'test', schemaVersion: SCHEMA_VERSION, exportedAt: '2026-10-30T12:00:00Z', data };
const sql = buildRestoreSql(backup, upgrade, SCHEMA_VERSION);
if (process.argv[2]) fs.writeFileSync(process.argv[2], sql);

test('the script is one transaction with the version and empty-database checks first', () => {
  assert.ok(sql.indexOf('begin;') < sql.indexOf('raise exception') && sql.indexOf('raise exception') < sql.indexOf('insert into'));
  assert.ok(sql.includes(`<> ${SCHEMA_VERSION} then`));
  assert.ok(sql.includes('only goes into an empty database'));
  assert.ok(sql.trim().split('commit;').length === 2);
});

test('every record of the backup is in the script, with its id', () => {
  for (const t of ['companies', 'persons', 'history_entries', 'stage_changes', 'week_actions']) {
    for (const r of data[t]) assert.ok(sql.includes(`'${r.id}'`), `${t} ${r.id} missing`);
  }
  assert.ok(sql.includes(`${data.persons.length} persons`));
});

test('only middle stages are inserted; the fixed ones are already in the database', () => {
  const stageInsert = sql.slice(sql.indexOf('insert into stages'), sql.indexOf(';', sql.indexOf('insert into stages')));
  assert.ok(!stageInsert.includes("'contact'") && !stageInsert.includes("'order'"));
  assert.ok(stageInsert.includes("'Kennismaking'"));
});

test('no undefined or NaN slips into the script', () => {
  assert.ok(!/undefined|NaN/.test(sql));
});

test('a user id that is not a real one (local data) becomes empty, a real one is looked up', () => {
  assert.ok(!sql.includes("'local-user'"));
  const real = buildRestoreSql({ ...backup, data: { ...data, companies: [{ ...data.companies[0], createdBy: '4341c37c-eb5f-467d-bc12-cf3000000000' }] } }, upgrade, SCHEMA_VERSION);
  assert.ok(real.includes("(select id from members where id = '4341c37c-eb5f-467d-bc12-cf3000000000'::uuid)"));
});

test('quotes in text are escaped', () => {
  const q = buildRestoreSql({ ...backup, data: { ...data, companies: [{ ...data.companies[0], note: "Jan's bedrijf" }] } }, upgrade, SCHEMA_VERSION);
  assert.ok(q.includes("'Jan''s bedrijf'"));
});

test('an older backup is upgraded with the local steps', () => {
  const old = JSON.parse(JSON.stringify(backup));
  old.schemaVersion = 0;
  old.data.week_actions = old.data.week_actions.map(({ happenedOn, ...a }) => ({ ...a, weekStart: happenedOn }));
  const s = buildRestoreSql(old, upgrade, SCHEMA_VERSION);
  assert.ok(s.includes(`restored as version ${SCHEMA_VERSION}`));
  assert.ok(!/undefined/.test(s));
});

test('upgrading to version 4 renames active same-name companies, never archived ones', () => {
  const co = (id, name, extra = {}) => ({ id, name, phone: '', email: '', website: '', note: '', archivedAt: null, archiveGroup: null, deletedAt: null, ...extra });
  const old = { schemaVersion: 3, data: { ...JSON.parse(JSON.stringify(data)), companies: [
    co('a', 'Govaplast'), co('b', ' govaplast '), co('c', 'GOVAPLAST'), co('d', 'Govaplast', { archivedAt: '2026-11-01T00:00:00Z', archiveGroup: 'g' }), co('e', 'Govaplast (2)', { deletedAt: '2026-11-01T00:00:00Z' })
  ] } };
  const names = Object.fromEntries(upgrade(old).companies.map(c => [c.id, c.name]));
  assert.deepStrictEqual(names, { a: 'Govaplast', b: 'govaplast (2)', c: 'GOVAPLAST (3)', d: 'Govaplast', e: 'Govaplast (2)' });
});

test('upgrading to version 5 makes every company active and no status entry made with a company', () => {
  const old = { schemaVersion: 4, data: JSON.parse(JSON.stringify(data)) };
  old.data.companies.forEach(c => { delete c.active; delete c.inactiveSince; });
  old.data.history_entries.forEach(e => { delete e.withCompany; });
  const up = upgrade(old);
  assert.ok(up.companies.every(c => c.active === true && c.inactiveSince === null));
  assert.ok(up.history_entries.every(e => e.withCompany === false));
});

test('company status and with_company are in the restore script', () => {
  assert.ok(/insert into companies \([^)]*active, inactive_since/.test(sql));
  assert.ok(/insert into history_entries \([^)]*with_company/.test(sql));
});

test('the test data has unique active company names', () => {
  const active = data.companies.filter(c => !c.archivedAt && !c.deletedAt).map(c => c.name.trim().toLowerCase());
  assert.strictEqual(new Set(active).size, active.length);
});

test('a newer backup and a non-backup are refused', () => {
  assert.throws(() => buildRestoreSql({ ...backup, schemaVersion: SCHEMA_VERSION + 1 }, upgrade, SCHEMA_VERSION), /newer version/);
  assert.throws(() => buildRestoreSql({ app: 'JAFT', kind: 'analysis' }, upgrade, SCHEMA_VERSION), /not a JAFT backup/);
});

console.log(`${ok} tests passed${process.exitCode ? ', with failures above' : ''}`);
