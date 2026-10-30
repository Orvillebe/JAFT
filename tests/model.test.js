/**
 * Tests for model.js: calendar, stages, deriving a person, counts and next-step outcomes.
 * Run: node tests/model.test.js (no dependencies).
 */

const assert = require('assert');
const createModel = require('../model.js');
const CFG = require('../config.js');
const M = createModel(CFG);

let ok = 0;
function test(name, fn) {
  try { fn(); ok++; } catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

let n = 0;
const at = () => '2026-01-01T00:00:' + String(++n).padStart(2, '0') + '.000Z';
const entry = (kind, happenedOn, extra = {}) => ({ id: 'e' + (++n), kind, happenedOn, createdAt: at(), action: '', note: '', stageId: null, amount: null, status: null, nextStep: '', nextStepOn: null, ...extra });
const first = (d, extra) => entry('first_contact', d, { entryChannel: 'cold', ...extra });
const follow = (d, extra) => entry('follow_up', d, extra);
const P = { id: 'p1', name: 'Lotte Daems' };

const STAGES = [
  { id: 'contact', kind: 'start', position: 0 },
  { id: 'meeting', kind: 'middle', position: 1 },
  { id: 'quote', kind: 'middle', position: 2 },
  { id: 'order', kind: 'end', position: 99 }
];

/* ---------- calendar ---------- */

test('day 0 is the plan start, across daylight saving time', () => {
  assert.strictEqual(M.day('2026-10-19'), 0);
  assert.strictEqual(M.iso(0), '2026-10-19');
  assert.strictEqual(M.iso(M.day('2027-03-29')), '2027-03-29');
});

test('a week runs Thursday to Wednesday', () => {
  assert.strictEqual(M.iso(M.weekStart(1)), '2026-10-15');
  assert.strictEqual(M.weekOf(M.day('2026-10-21')), 1);
  assert.strictEqual(M.weekOf(M.day('2026-10-22')), 2);
  assert.strictEqual(M.weekNumber(1), 43);
  assert.strictEqual(M.fmtDayLong(M.day('2026-10-21')), 'wo 21 okt');
});

/* ---------- stages ---------- */

test('funnel order: start first, end last, middle by position', () => {
  const shuffled = [STAGES[3], STAGES[2], STAGES[0], STAGES[1]];
  assert.deepStrictEqual(M.funnel(shuffled).map(s => s.id), ['contact', 'meeting', 'quote', 'order']);
});

test('a stage archived mid-week is still visible in that week, not in the next', () => {
  const changes = [{ stageId: 'quote', happenedOn: '2026-10-24', change: 'archived', createdAt: at() }]; // Saturday, week 2
  assert.strictEqual(M.visibleInWeek(STAGES[2], 2, changes), true);
  assert.strictEqual(M.visibleInWeek(STAGES[2], 3, changes), false);
  assert.strictEqual(M.visibleInWeek(STAGES[2], 1, changes), true);
  const restored = changes.concat({ stageId: 'quote', happenedOn: '2026-11-05', change: 'restored', createdAt: at() }); // Thursday, week 4
  assert.strictEqual(M.visibleInWeek(STAGES[2], 4, restored), true);
  assert.strictEqual(M.visibleInWeek(STAGES[0], 3, [{ stageId: 'contact', happenedOn: '2026-10-20', change: 'archived' }]), true);
});

/* ---------- persons ---------- */

test('without a first contact a person is a contact person', () => {
  const p = M.derivePerson(P, []);
  assert.strictEqual(p.contacted, false);
  assert.strictEqual(p.stageId, null);
});

test('a new contact starts in contact, with its channel and next step', () => {
  const f = first('2026-10-20', { entryChannel: 'hook', viaId: 'v1', hook: 'beurs', nextStep: 'Bellen', nextStepOn: '2026-10-27' });
  const p = M.derivePerson(P, [f]);
  assert.strictEqual(p.stageId, 'contact');
  assert.strictEqual(p.entryChannel, 'hook');
  assert.deepStrictEqual(p.nextStep, { text: 'Bellen', day: M.day('2026-10-27'), entryId: f.id });
});

test('free flow: back and forth counts every entry, skips count nothing', () => {
  const p = M.derivePerson(P, [
    first('2026-10-20'),
    follow('2026-10-21', { stageId: 'quote' }),   // skips meeting
    follow('2026-10-22', { stageId: 'meeting' }), // back
    follow('2026-10-23', { stageId: 'quote' }),   // quote again
    follow('2026-10-24', { stageId: 'quote' })    // stays: not a new visit
  ]);
  assert.strictEqual(p.stageId, 'quote');
  assert.deepStrictEqual(p.visits.map(v => v.stageId), ['contact', 'quote', 'meeting', 'quote']);
});

test('order is the date it happened, not the moment it was entered', () => {
  const later = follow('2026-10-25', { stageId: 'meeting' });
  const backfilled = follow('2026-10-22', { stageId: 'quote' }); // entered after, happened before
  const p = M.derivePerson(P, [first('2026-10-20'), later, backfilled]);
  assert.strictEqual(p.stageId, 'meeting');
  assert.deepStrictEqual(p.visits.map(v => v.stageId), ['contact', 'quote', 'meeting']);
});

test('next step: an action on or after the planned day closes it', () => {
  const base = [first('2026-10-20', { nextStepOn: '2026-10-27' })];
  assert.strictEqual(M.derivePerson(P, [...base, follow('2026-10-27', { action: 'gebeld' })]).nextStep, null);
  assert.strictEqual(M.derivePerson(P, [...base, follow('2026-10-29', { action: 'gebeld' })]).nextStep, null);
});

test('next step: an action before the planned day only replaces it with a new step', () => {
  const base = [first('2026-10-20', { nextStepOn: '2026-10-27' })];
  assert.strictEqual(M.derivePerson(P, [...base, follow('2026-10-23', { action: 'gebeld' })]).nextStep.day, M.day('2026-10-27'));
  assert.strictEqual(M.derivePerson(P, [...base, follow('2026-10-23', { action: 'gebeld', nextStepOn: '2026-11-02' })]).nextStep.day, M.day('2026-11-02'));
});

test('next step: a note or a stage change alone leaves it open', () => {
  const base = [first('2026-10-20', { nextStepOn: '2026-10-27' })];
  assert.ok(M.derivePerson(P, [...base, follow('2026-10-29', { note: 'iets' })]).nextStep);
  assert.ok(M.derivePerson(P, [...base, follow('2026-10-29', { stageId: 'meeting' })]).nextStep);
});

test('inactive keeps stage and history, and can be undone', () => {
  const base = [first('2026-10-20'), follow('2026-10-22', { stageId: 'meeting' })];
  const off = M.derivePerson(P, [...base, entry('status', '2026-10-23', { status: 'inactive' })]);
  assert.strictEqual(off.active, false);
  assert.strictEqual(off.stageId, 'meeting');
  assert.strictEqual(M.derivePerson(P, [...base, entry('status', '2026-10-23', { status: 'inactive' }), entry('status', '2026-10-24', { status: 'active' })]).active, true);
});

test('amount: the most recent entry with an amount', () => {
  const p = M.derivePerson(P, [first('2026-10-20'), follow('2026-10-22', { stageId: 'order', amount: 9500 }), follow('2026-10-25', { amount: 11000 })]);
  assert.strictEqual(p.amount, 11000);
});

/* ---------- validation ---------- */

test('validation: no future dates, no empty follow-ups, next step after the entry', () => {
  const T = M.day('2026-10-30');
  assert.strictEqual(M.validateEntry(follow('2026-10-31', { action: 'x' }), T), 'error.future_date');
  assert.strictEqual(M.validateEntry(follow('2026-10-30', {}), T), 'error.empty_entry');
  assert.strictEqual(M.validateEntry(follow('2026-10-30', { action: 'x', nextStepOn: '2026-10-30' }), T), 'error.next_step_before_entry');
  assert.strictEqual(M.validateEntry(follow('2026-10-30', { note: 'x' }), T), null);
});

/* ---------- next-step outcomes ---------- */

test('next-step outcomes: on time, late, replaced, open', () => {
  const T = M.day('2026-11-10');
  const a = first('2026-10-20', { nextStepOn: '2026-10-27' });
  const b = follow('2026-10-29', { action: 'gebeld', nextStepOn: '2026-11-03' }); // closes a, 2 days late; plans b
  const c = follow('2026-11-01', { note: 'mail', nextStepOn: '2026-11-12' });   // replaces b
  const out = M.nextStepOutcomes([a, b, c], T);
  assert.deepStrictEqual([out[0].result, out[0].daysLate], ['done_late', 2]);
  assert.strictEqual(out[1].result, 'replaced');
  assert.strictEqual(out[2].result, 'open');
  const late = M.nextStepOutcomes([first('2026-10-20', { nextStepOn: '2026-10-27' }), follow('2026-10-29', { action: 'gebeld' })], T);
  assert.deepStrictEqual([late[0].result, late[0].daysLate], ['done_late', 2]);
});

/* ---------- counts ---------- */

const person = (id, channel, entries) => M.derivePerson({ id, name: id }, entries.map(e => ({ ...e, entryChannel: e.kind === 'first_contact' ? channel : undefined })));

test('counts: the current week compares up to the same weekday', () => {
  const persons = [
    person('a', 'cold', [first('2026-10-16')]),  // week 1, Friday
    person('b', 'cold', [first('2026-10-20')]),  // week 1, Tuesday
    person('c', 'hook', [first('2026-10-23')])   // week 2, Friday
  ];
  const c = M.counts({ persons, stages: STAGES, stageChanges: [], weekActions: [], today: M.day('2026-10-23') });
  assert.strictEqual(c.currentWeek, 2);
  assert.strictEqual(c.improvements(2).contact.better, false); // 1 against 1 up to Friday
  assert.strictEqual(c.weekState(2).better, true);             // more via hook
});

test('counts: visits, totals and contact persons', () => {
  const persons = [
    person('a', 'cold', [first('2026-10-20'), follow('2026-10-21', { stageId: 'quote' }), follow('2026-10-22', { stageId: 'meeting' }), follow('2026-10-23', { stageId: 'quote' })]),
    M.derivePerson({ id: 'cp', name: 'cp' }, [])
  ];
  const c = M.counts({ persons, stages: STAGES, stageChanges: [], weekActions: [], today: M.day('2026-10-30') });
  assert.strictEqual(c.total('quote'), 2);
  assert.strictEqual(c.total('meeting'), 1);
  assert.strictEqual(c.total('contact'), 1);
});

test('counts: archived stages leave the totals and the weeks they were archived in', () => {
  const changes = [{ stageId: 'meeting', happenedOn: '2026-10-19', change: 'archived', createdAt: at() }];
  const c = M.counts({ persons: [], stages: STAGES, stageChanges: changes, weekActions: [], today: M.day('2026-10-30') });
  assert.deepStrictEqual(c.totalStages().map(s => s.id), ['contact', 'quote', 'order']);
  assert.ok(c.weekStages(1).some(s => s.id === 'meeting'));  // active on Thu-Sun of week 1
  assert.ok(!c.weekStages(2).some(s => s.id === 'meeting'));
});

test('week actions: events add up per tap, the latest post tap decides', () => {
  const ws = M.iso(M.weekStart(2));
  const rows = [
    { weekStart: ws, kind: 'event', value: 1, createdAt: at() },
    { weekStart: ws, kind: 'event', value: 1, createdAt: at() },
    { weekStart: ws, kind: 'event', value: -1, createdAt: at() },
    { weekStart: ws, kind: 'post', value: 1, createdAt: at() },
    { weekStart: ws, kind: 'post', value: 0, createdAt: at() }
  ];
  const c = M.counts({ persons: [], stages: STAGES, stageChanges: [], weekActions: rows, today: 12 });
  assert.deepStrictEqual(c.actions(2), { events: 1, post: false });
  assert.deepStrictEqual(c.actions(1), { events: 0, post: false });
});

console.log(`${ok} tests passed${process.exitCode ? ', with failures above' : ''}`);
