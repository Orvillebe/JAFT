/**
 * JAFT Store - the data in memory, and every save with its undo.
 *
 * Responsibilities:
 *   - Loading everything once (DataService.loadAll), then updating memory after each save
 *   - Derived persons (Model.derivePerson), rebuilt after every change
 *   - Labels for stages, entry channels and via options
 *   - Every write returns a function that undoes it
 *   - Shared settings (the first day of the week), applied to the Model when loaded or changed
 *   - Deleting by the rules in docs/design.md: bin for empty things and history entries,
 *     archive for contacts and companies with persons
 *
 * Screens read and write only through the Store; they never see the data layer.
 * Rules live in model.js.
 */

const Store = (() => {
  const M = Model;
  let raw = { companies: [], persons: [], entries: [], stages: [], stageChanges: [], weekActions: [], members: [] };
  let cache = null, me = null;

  const uuid = () => newId();
  const nowIso = () => new Date().toISOString();

  async function load() {
    const cutoff = new Date(Date.now() - JAFT_CONFIG.binDays * 864e5).toISOString();
    try { await DataService.purgeBin(cutoff); } catch (e) { console.error('Emptying the bin failed', e); }
    raw = await DataService.loadAll();
    me = await DataService.getSession();
    applySettings();
    changed();
  }
  function changed() { cache = null; }

  /* ---------- shared settings ---------- */

  // The first day of the week: the shared setting, or the default from config.js.
  const weekStartsOn = () => {
    const v = raw.settings && raw.settings.week_starts_on;
    return Number.isInteger(v) && v >= 0 && v <= 6 ? v : JAFT_CONFIG.weekStartsOn;
  };
  function applySettings() { M.setWeekStartsOn(weekStartsOn()); }
  async function setWeekStartsOn(d) {
    const old = weekStartsOn();
    await DataService.saveSetting('week_starts_on', d);
    raw.settings = { ...raw.settings, week_starts_on: d }; applySettings(); changed();
    return { undo: async () => { await DataService.saveSetting('week_starts_on', old); raw.settings = { ...raw.settings, week_starts_on: old }; applySettings(); changed(); } };
  }

  function build() {
    const byPerson = {};
    raw.entries.forEach(e => (byPerson[e.personId] = byPerson[e.personId] || []).push(e));
    const companyName = Object.fromEntries(raw.companies.map(c => [c.id, c.name]));
    const persons = raw.persons.map(p => ({ ...M.derivePerson(p, byPerson[p.id] || []), companyName: companyName[p.companyId] || '' }));
    cache = { persons, byId: Object.fromEntries(persons.map(p => [p.id, p])), byPerson };
  }
  const c$ = () => { if (!cache) build(); return cache; };

  /* ---------- reading ---------- */

  const allPersons = () => c$().persons;
  const contacts = () => c$().persons.filter(p => p.contacted);
  const contactPersons = () => c$().persons.filter(p => !p.contacted);
  const person = id => c$().byId[id] || null;
  const entriesOf = id => M.sortEntries(c$().byPerson[id] || []);
  const entry = id => raw.entries.find(e => e.id === id) || null;
  const companies = () => raw.companies;
  const company = id => raw.companies.find(c => c.id === id) || null;
  const companiesNamed = name => raw.companies.filter(c => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const contactsOf = companyId => contacts().filter(p => p.companyId === companyId);
  const contactPersonsOf = companyId => contactPersons().filter(p => p.companyId === companyId);
  const myName = () => (raw.members.find(m => m.id === (me && me.userId)) || {}).name || (me && me.email) || '';

  // Stages in funnel order; "active" means it can be chosen today.
  const stages = () => M.funnel(raw.stages);
  const stage = id => raw.stages.find(s => s.id === id) || null;
  const stageArchived = s => M.isArchived(s, raw.stageChanges, M.today());
  const activeStages = () => stages().filter(s => !stageArchived(s));
  const stageLabel = s => (typeof s === 'string' ? (s = stage(s)) : s) ? (s.kind === 'middle' ? s.name : t('stage.' + s.id)) : t('stage.unknown');
  const stageChanges = () => raw.stageChanges;

  const viaOptions = () => JAFT_CONFIG.viaOptions;
  const viaLabel = key => key ? t('via.' + key) : '';
  const channels = () => JAFT_CONFIG.entryChannels;
  const channel = key => JAFT_CONFIG.entryChannels.find(c => c.key === key) || null;
  const channelLabel = key => key ? t('channel.' + key) : t('channel.unknown');

  const counts = () => M.counts({ persons: allPersons(), stages: raw.stages, stageChanges: raw.stageChanges, weekActions: raw.weekActions, today: M.today() });
  const weekActions = () => raw.weekActions;

  /* ---------- writing ---------- */

  const replace = (list, row) => { const i = list.findIndex(x => x.id === row.id); if (i >= 0) list[i] = row; else list.push(row); };
  const drop = (list, id) => { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); };
  const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k] ?? null]));
  const PERSON_FIELDS = ['companyId', 'name', 'phone', 'email', 'jobTitle'];
  const COMPANY_FIELDS = ['name', 'phone', 'email', 'website', 'note'];
  const ENTRY_FIELDS = ['happenedOn', 'action', 'note', 'stageId', 'amount', 'status', 'nextStep', 'nextStepOn', 'entryChannel', 'via', 'hook'];

  // A new contact, or the first contact with an existing contact person (p.personId).
  // A new company is created when companyName is given without companyId.
  async function createContact(p) {
    const newCompany = !p.companyId && p.companyName ? { id: uuid(), name: p.companyName, phone: '', email: '', website: '', note: '' } : null;
    const companyId = p.companyId || (newCompany && newCompany.id) || null;
    const old = p.personId ? { ...raw.persons.find(x => x.id === p.personId) } : null;
    const personRow = { id: p.personId || uuid(), companyId, name: p.name, phone: p.phone, email: p.email, jobTitle: p.jobTitle };
    const entryRow = {
      id: uuid(), personId: personRow.id, kind: 'first_contact', happenedOn: p.happenedOn, action: '', note: p.note,
      stageId: M.START_STAGE, amount: null, status: null, nextStep: p.nextStep, nextStepOn: p.nextStepOn,
      entryChannel: p.entryChannel, via: p.via, hook: p.hook
    };
    const r = await DataService.createContact({ company: newCompany, person: personRow, personIsNew: !old, entry: entryRow });
    if (r.company) raw.companies.push(r.company);
    replace(raw.persons, r.person);
    raw.entries.push(r.entry);
    changed();
    const undo = async () => {
      if (old) {
        await DataService.remove('history_entries', r.entry.id); drop(raw.entries, r.entry.id);
        replace(raw.persons, await DataService.update('persons', old.id, pick(old, PERSON_FIELDS)));
      } else {
        await DataService.remove('persons', r.person.id); drop(raw.persons, r.person.id);
        raw.entries = raw.entries.filter(e => e.personId !== r.person.id);
      }
      if (r.company) { await DataService.remove('companies', r.company.id); drop(raw.companies, r.company.id); }
      changed();
    };
    return { person: r.person, undo };
  }

  async function addEntry(fields) {
    const row = await DataService.insert('history_entries', { id: uuid(), action: '', note: '', stageId: null, amount: null, status: null, nextStep: '', nextStepOn: null, ...fields });
    raw.entries.push(row); changed();
    return { entry: row, undo: async () => { await DataService.remove('history_entries', row.id); drop(raw.entries, row.id); changed(); } };
  }

  async function updateEntry(id, fields) {
    const old = pick(entry(id), Object.keys(fields).filter(k => ENTRY_FIELDS.includes(k)));
    replace(raw.entries, await DataService.update('history_entries', id, fields)); changed();
    return { undo: async () => { replace(raw.entries, await DataService.update('history_entries', id, old)); changed(); } };
  }

  // A history entry goes to the bin. The first-contact entry never does: archive the person instead.
  async function binEntry(id) {
    if (entry(id).kind === 'first_contact') throw new Error(t('error.first_contact_delete'));
    await DataService.update('history_entries', id, { deletedAt: nowIso() });
    drop(raw.entries, id); changed();
    return { undo: async () => { replace(raw.entries, await DataService.update('history_entries', id, { deletedAt: null })); changed(); } };
  }

  async function updatePerson(id, fields) {
    const old = pick(raw.persons.find(p => p.id === id), Object.keys(fields));
    replace(raw.persons, await DataService.update('persons', id, fields)); changed();
    return { undo: async () => { replace(raw.persons, await DataService.update('persons', id, old)); changed(); } };
  }

  async function addContactPerson(companyId, fields) {
    const row = await DataService.insert('persons', { id: uuid(), companyId, name: fields.name, phone: fields.phone, email: fields.email, jobTitle: fields.jobTitle });
    raw.persons.push(row); changed();
    return { person: row, undo: async () => { await DataService.remove('persons', row.id); drop(raw.persons, row.id); changed(); } };
  }

  // Deleting a person: a contact person goes to the bin, a contact (never empty) is archived.
  async function deletePerson(id) {
    const p = person(id);
    if (!p.contacted) {
      await DataService.update('persons', id, { deletedAt: nowIso() });
      drop(raw.persons, id); changed();
      return { binned: true, undo: async () => { replace(raw.persons, await DataService.update('persons', id, { deletedAt: null })); changed(); } };
    }
    const group = uuid();
    await DataService.update('persons', id, { archivedAt: nowIso(), archiveGroup: group });
    drop(raw.persons, id); raw.entries = raw.entries.filter(e => e.personId !== id); changed();
    return { binned: false, undo: async () => { await DataService.restoreGroup(group); await reload(); } };
  }

  async function saveCompany(id, fields) {
    if (!id) {
      const row = await DataService.insert('companies', { id: uuid(), ...pick(fields, COMPANY_FIELDS) });
      raw.companies.push(row); changed();
      return { company: row, undo: async () => { await DataService.remove('companies', row.id); drop(raw.companies, row.id); changed(); } };
    }
    const old = pick(company(id), COMPANY_FIELDS);
    const row = await DataService.update('companies', id, pick(fields, COMPANY_FIELDS));
    replace(raw.companies, row); changed();
    return { company: row, undo: async () => { replace(raw.companies, await DataService.update('companies', id, old)); changed(); } };
  }

  // What deleting a company takes along: everyone linked to it.
  const companyLinks = id => ({ contacts: contactsOf(id), contactPersons: contactPersonsOf(id) });

  // An empty company goes to the bin; a company with persons is archived together with them.
  async function deleteCompany(id) {
    const links = companyLinks(id);
    if (!links.contacts.length && !links.contactPersons.length) {
      await DataService.update('companies', id, { deletedAt: nowIso() });
      drop(raw.companies, id); changed();
      return { binned: true, undo: async () => { replace(raw.companies, await DataService.update('companies', id, { deletedAt: null })); changed(); } };
    }
    const group = uuid();
    await DataService.archiveCompany(id, group);
    await reload();
    return { binned: false, undo: async () => { await DataService.restoreGroup(group); await reload(); } };
  }

  /* ---------- bin and archive ---------- */

  const loadHidden = () => DataService.loadHidden();

  // Restore from the bin. A person whose company is in the bin brings the company back too.
  async function restoreFromBin(table, id, hidden) {
    if (table === 'persons') {
      const p = hidden.bin.persons.find(x => x.id === id);
      if (p && hidden.bin.companies.some(c => c.id === p.companyId)) await DataService.update('companies', p.companyId, { deletedAt: null });
    }
    await DataService.update(table, id, { deletedAt: null });
    await reload();
  }

  // Restore from the archive: everything archived together comes back together.
  // A person whose company is archived separately brings the company back too.
  async function restoreArchived(group, hidden) {
    await DataService.restoreGroup(group);
    for (const p of hidden.archive.persons.filter(x => x.archiveGroup === group)) {
      const c = hidden.archive.companies.find(x => x.id === p.companyId && x.archiveGroup !== group);
      if (c) await DataService.update('companies', c.id, { archivedAt: null, archiveGroup: null });
    }
    await reload();
  }

  async function reload() { raw = await DataService.loadAll(); applySettings(); changed(); }

  /* ---------- stages ---------- */

  async function addStage(name) {
    const middle = raw.stages.filter(s => s.kind === 'middle');
    const row = await DataService.insert('stages', { id: uuid(), kind: 'middle', name, position: Math.max(0, ...middle.map(s => s.position)) + 1 });
    raw.stages.push(row); changed();
  }
  async function renameStage(id, name) { replace(raw.stages, await DataService.update('stages', id, { name })); changed(); }
  // Archiving and restoring are kept with their date: the overview needs to know when.
  async function setStageArchived(id, archived) {
    const row = await DataService.insert('stage_changes', { id: uuid(), stageId: id, happenedOn: M.iso(M.today()), change: archived ? 'archived' : 'restored' });
    raw.stageChanges.push(row); changed();
  }
  // Swap positions with the neighbour in the funnel (middle stages only).
  async function moveStage(id, dir) {
    const middle = stages().filter(s => s.kind === 'middle'), i = middle.findIndex(s => s.id === id), j = i + dir;
    if (j < 0 || j >= middle.length) return;
    const a = middle[i], b = middle[j];
    replace(raw.stages, await DataService.update('stages', a.id, { position: b.position }));
    replace(raw.stages, await DataService.update('stages', b.id, { position: a.position }));
    changed();
  }

  /* ---------- week actions ---------- */

  // Every tap is its own record, so two people tapping at once never lose a tap.
  // It is stored with a date in the week it counts for; the week itself is never stored.
  async function addWeekAction(happenedOn, kind, value) {
    const row = await DataService.insert('week_actions', { id: uuid(), happenedOn, kind, value });
    raw.weekActions.push(row); changed();
    return { undo: async () => { await DataService.remove('week_actions', row.id); drop(raw.weekActions, row.id); changed(); } };
  }

  return {
    load, reload, weekStartsOn, setWeekStartsOn,
    allPersons, contacts, contactPersons, person, entriesOf, entry, companies, company, companiesNamed,
    contactsOf, contactPersonsOf, companyLinks, myName,
    stages, stage, stageArchived, activeStages, stageLabel, stageChanges,
    viaOptions, viaLabel, channels, channel, channelLabel,
    counts, weekActions,
    createContact, addEntry, updateEntry, binEntry, updatePerson, addContactPerson, deletePerson,
    saveCompany, deleteCompany, loadHidden, restoreFromBin, restoreArchived,
    addStage, renameStage, setStageArchived, moveStage,
    addWeekAction
  };
})();
