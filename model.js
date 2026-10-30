/**
 * JAFT Model - pure rules, no DOM and no database.
 *
 * Responsibilities:
 *   Calendar  - day numbers from the plan start, weeks (Thursday to Wednesday by default),
 *               ISO week numbers, date formatting
 *   Stages    - funnel order, whether a stage was archived on a day or in a week
 *   Persons   - a person's state (stage, active, next step, amount, stage visits),
 *               derived from its history entries. Nothing of this is stored.
 *   Counts    - week figures for the overview and the reward after saving
 *   Outcomes  - what happened to each planned next step (for the analysis export)
 *
 * Every rule is decided here, once. Elsewhere: config.js (settings), data-*.js (storage),
 * store.js (memory and saving), the screen modules (DOM).
 * Works in Node too, so tests/model.test.js can test the rules.
 */

function createModel(cfg) {
  const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
  const START_STAGE = 'contact', END_STAGE = 'order';

  /* ---------- Calendar ---------- */

  const [sy, sm, sd] = cfg.planStart.split('-').map(Number);
  const weekday = dt => (dt.getDay() + 6) % 7; // 0 = Monday
  const dateOf = i => new Date(sy, sm - 1, sd + i);
  // Math.round absorbs the 23- and 25-hour days around daylight saving time.
  const dayOfDate = dt => Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()) - new Date(sy, sm - 1, sd)) / 864e5);
  const day = iso => { const [y, m, d] = iso.split('-').map(Number); return dayOfDate(new Date(y, m - 1, d)); };
  const iso = i => { const d = dateOf(i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const today = (now = new Date()) => dayOfDate(now);
  const dayOfTimestamp = ts => dayOfDate(new Date(ts));
  const END = day(cfg.planEnd);

  // Week 1 is the week the plan starts in. SHIFT moves the week boundary to the chosen first day.
  // The first day is a shared setting (Instellingen); config.js only holds the default.
  // Only the week view depends on it: everything is stored by date.
  let weekStartsOn = cfg.weekStartsOn, SHIFT = 0;
  function setWeekStartsOn(d) { weekStartsOn = d; SHIFT = (weekday(dateOf(0)) - d + 7) % 7; }
  setWeekStartsOn(cfg.weekStartsOn);
  const weekOf = i => Math.floor((i + SHIFT) / 7) + 1;
  const weekStart = w => (w - 1) * 7 - SHIFT;
  const weekPos = i => (((i + SHIFT) % 7) + 7) % 7; // 0 = first day of the week
  const inWeek = (i, w) => i >= weekStart(w) && i <= weekStart(w) + 6;

  const fmtDay = i => { const d = dateOf(i); return d.getDate() + ' ' + MONTHS[d.getMonth()]; };
  const fmtDayLong = i => DAYS[weekday(dateOf(i))] + ' ' + fmtDay(i);
  const euro = n => '€ ' + Math.round(n).toLocaleString('nl-BE');
  const pct = x => Math.round(x * 100) + '%';

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  }
  // A week belongs to the day it ends on: that day gives the ISO week number and the month.
  const weekEnd = w => dateOf(weekStart(w) + 6);
  const weekNumber = w => isoWeek(weekEnd(w));
  const monthIndex = d => d.getFullYear() * 12 + d.getMonth();

  /* ---------- Stages ---------- */

  // Funnel order: the start stage first, the end stage last, middle stages by position.
  function funnel(stages) {
    const rank = s => s.kind === 'start' ? -Infinity : s.kind === 'end' ? Infinity : s.position;
    return stages.slice().sort((a, b) => rank(a) - rank(b));
  }

  // Changes per stage, in the order they happened.
  function changesOf(stageId, stageChanges) {
    return stageChanges.filter(c => c.stageId === stageId)
      .sort((a, b) => day(a.happenedOn) - day(b.happenedOn) || (a.createdAt < b.createdAt ? -1 : 1));
  }
  // Was the stage archived on day d? Fixed stages never are. Before its first change a stage is active.
  function archivedOn(stage, d, stageChanges) {
    if (stage.kind !== 'middle') return false;
    let archived = false;
    for (const c of changesOf(stage.id, stageChanges)) { if (day(c.happenedOn) > d) break; archived = c.change === 'archived'; }
    return archived;
  }
  const isArchived = (stage, stageChanges, T) => archivedOn(stage, T, stageChanges);
  // A stage is shown in a week if it was active on at least one day of that week.
  function visibleInWeek(stage, w, stageChanges) {
    for (let i = weekStart(w); i <= weekStart(w) + 6; i++) if (!archivedOn(stage, i, stageChanges)) return true;
    return false;
  }

  /* ---------- Persons ---------- */

  // The order things happened in: the day it happened, then the moment it was entered.
  function sortEntries(entries) {
    return entries.slice().sort((a, b) => day(a.happenedOn) - day(b.happenedOn) ||
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : (a.id < b.id ? -1 : 1)));
  }

  /**
   * A person's state from its history entries. A person without a first-contact entry
   * is a contact person who has not been contacted yet.
   *
   * Stage: the stage of the most recent entry that set one. A visit is counted each time
   * the person enters a stage from a different one; skipped stages are not visits.
   *
   * Next step: one open step, the most recently planned one. It closes when an action is
   * done on or after its planned day. An action before that day only replaces it when a
   * new step is planned; a note or a stage change alone leaves it open.
   */
  function derivePerson(person, entries) {
    const sorted = sortEntries(entries);
    const visits = [];
    let stageId = null, active = true, amount = null, nextStep = null, first = null, last = null;
    for (const e of sorted) {
      const d = day(e.happenedOn);
      last = last === null ? d : Math.max(last, d);
      if (e.kind === 'first_contact') { first = first || e; if (stageId !== START_STAGE) { stageId = START_STAGE; visits.push({ stageId, day: d, entryId: e.id }); } }
      else if (e.kind === 'status') active = e.status !== 'inactive';
      else if (e.stageId && e.stageId !== stageId) { stageId = e.stageId; visits.push({ stageId, day: d, entryId: e.id }); }
      if (e.amount) amount = Number(e.amount);
      if (e.nextStepOn) nextStep = { text: e.nextStep || '', day: day(e.nextStepOn), entryId: e.id };
      else if (e.action && nextStep && d >= nextStep.day) nextStep = null;
    }
    return {
      ...person,
      contacted: !!first,
      firstContact: first,
      entryChannel: first ? first.entryChannel : null,
      via: first ? first.via || null : null,
      hook: first ? first.hook || '' : '',
      firstContactDay: first ? day(first.happenedOn) : null,
      stageId, active, amount, nextStep, visits,
      lastActivity: last
    };
  }

  // What happened to each planned next step: done (on time or late), replaced, or still open.
  function nextStepOutcomes(entries, T) {
    const sorted = sortEntries(entries), out = [];
    sorted.forEach((e, i) => {
      if (!e.nextStepOn) return;
      const due = day(e.nextStepOn);
      let outcome = { result: due < T ? 'open_late' : 'open', daysLate: Math.max(0, T - due) };
      for (const n of sorted.slice(i + 1)) {
        const d = day(n.happenedOn);
        if (n.action && d >= due) { outcome = { result: d > due ? 'done_late' : 'done_on_time', on: d, daysLate: d - due }; break; }
        if (n.nextStepOn) { outcome = { result: 'replaced', on: d }; break; }
      }
      out.push({ entryId: e.id, plannedOn: day(e.happenedOn), text: e.nextStep || '', due, ...outcome });
    });
    return out;
  }

  // Is a history entry valid? Returns an error key for the translation file, or null.
  function validateEntry(e, T) {
    const d = day(e.happenedOn);
    if (d > T) return 'error.future_date';
    if (e.kind === 'follow_up' && !e.action && !e.note && !e.stageId && !e.nextStepOn && !e.amount) return 'error.empty_entry';
    if (e.nextStepOn && day(e.nextStepOn) <= d) return 'error.next_step_before_entry';
    return null;
  }

  /* ---------- Counts ---------- */

  /**
   * Week figures. persons are derived persons (archived ones are never passed in),
   * stages all stages, T today's day number.
   * The current week compares with last week up to the same weekday, so it stays fair.
   */
  function counts({ persons, stages, stageChanges, weekActions, today: T }) {
    const contacted = persons.filter(p => p.contacted);
    const currentWeek = weekOf(T);
    const maxPosFor = w => w === currentWeek ? weekPos(T) : 6;
    const ordered = funnel(stages);

    const visitsInWeek = (stageId, w, maxPos = 6) => contacted.reduce((n, p) =>
      n + p.visits.filter(v => v.stageId === stageId && inWeek(v.day, w) && weekPos(v.day) <= maxPos).length, 0);
    const newInWeek = (w, maxPos = 6) => contacted.filter(p => inWeek(p.firstContactDay, w) && weekPos(p.firstContactDay) <= maxPos);
    const byChannel = (list, key) => list.filter(p => p.entryChannel === key).length;
    const total = stageId => contacted.reduce((n, p) => n + p.visits.filter(v => v.stageId === stageId).length, 0);
    const weekStages = w => ordered.filter(s => visibleInWeek(s, w, stageChanges));
    const totalStages = () => ordered.filter(s => !isArchived(s, stageChanges, T));

    // Week actions are stored by date; the week they count for follows from the date.
    function actions(w) {
      const rows = weekActions.filter(a => inWeek(day(a.happenedOn), w));
      const events = Math.max(0, rows.filter(a => a.kind === 'event').reduce((n, a) => n + a.value, 0));
      const posts = rows.filter(a => a.kind === 'post').sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
      return { events, post: posts.length ? posts[posts.length - 1].value === 1 : false };
    }

    // Did anything happen in week w, and is at least one block better than last week?
    function weekState(w) {
      if (w < 1 || w > currentWeek) return { something: false, better: false };
      const md = maxPosFor(w), a = actions(w), ss = weekStages(w);
      const now = ss.map(s => visitsInWeek(s.id, w));
      const something = now.some(n => n > 0) || a.events > 0 || a.post;
      if (w === 1) return { something, better: something }; // first week: something beats nothing
      const before = ss.map(s => visitsInWeek(s.id, w - 1, md));
      const nW = newInWeek(w), nV = newInWeek(w - 1, md);
      const better = now.some((n, i) => n > before[i]) ||
        cfg.entryChannels.some(c => byChannel(nW, c.key) > byChannel(nV, c.key)) ||
        a.events > actions(w - 1).events;
      return { something, better };
    }

    // Per stage: how many visits in week w, and is that more than last week (up to the same weekday)?
    function improvements(w) {
      const md = maxPosFor(w), res = {};
      ordered.forEach(s => { const now = visitsInWeek(s.id, w); res[s.id] = { now, better: now > visitsInWeek(s.id, w - 1, md) }; });
      return res;
    }

    return { contacted, currentWeek, maxPosFor, visitsInWeek, newInWeek, byChannel, total, weekStages, totalStages, actions, weekState, improvements };
  }

  return {
    START_STAGE, END_STAGE,
    setWeekStartsOn, weekStartsOn: () => weekStartsOn,
    day, iso, today, dateOf, dayOfTimestamp, END,
    weekOf, weekStart, weekPos, inWeek, weekEnd, weekNumber, monthIndex,
    fmtDay, fmtDayLong, euro, pct,
    funnel, archivedOn, isArchived, visibleInWeek,
    sortEntries, derivePerson, nextStepOutcomes, validateEntry, counts
  };
}

if (typeof module !== 'undefined') module.exports = createModel;
else window.Model = createModel(JAFT_CONFIG);
