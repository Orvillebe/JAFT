/**
 * JAFT Data - local storage implementation.
 *
 * Responsibilities:
 *   - The same functions as data-supabase.js, stored in this browser only (localStorage)
 *   - Hiding archived and deleted records in one place: loadAll() never returns them
 *   - Seeding the fixed stages and the initial middle stages and via options on first use
 *
 * Used to test the app before Supabase is swapped in (config.js: backend 'local').
 * There is no login: everything is saved as one local user.
 * tests/load-testdata.html fills this storage with a test data set.
 */

function createLocalData() {
  const KEY = 'jaft_local_v1';
  const USER = { id: 'local-user', name: 'Lokaal', email: '' };
  const TABLES = ['companies', 'persons', 'history_entries', 'stages', 'stage_changes', 'vias', 'week_actions'];
  const now = () => new Date().toISOString();
  const copy = o => JSON.parse(JSON.stringify(o));

  function seed() {
    const db = Object.fromEntries(TABLES.map(t => [t, []]));
    const meta = { createdAt: now(), createdBy: USER.id, changedAt: null, changedBy: null };
    db.stages = [
      { id: 'contact', kind: 'start', name: null, position: 0, ...meta },
      { id: crypto.randomUUID(), kind: 'middle', name: 'Gesprek', position: 1, ...meta },
      { id: crypto.randomUUID(), kind: 'middle', name: 'Offerte', position: 2, ...meta },
      { id: 'order', kind: 'end', name: null, position: 1000, ...meta }
    ];
    db.vias = ['Event', 'Doorverwijzing', 'Andere'].map((name, i) => ({ id: crypto.randomUUID(), name, position: i + 1, archivedAt: null, ...meta }));
    return db;
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const db = JSON.parse(raw); TABLES.forEach(t => { db[t] = db[t] || []; }); return db; }
    } catch (e) { console.error('Local data unreadable, starting empty', e); }
    const db = seed(); write(db); return db;
  }
  function write(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function find(db, table, id) {
    const row = db[table].find(r => r.id === id);
    if (!row) throw new Error(`Not found: ${table} ${id}`);
    return row;
  }
  const visible = r => !r.archivedAt && !r.deletedAt;

  return {
    needsLogin: false,
    async signIn() {},
    async signOut() {},
    async getSession() { return { userId: USER.id, email: USER.email }; },

    async loadAll() {
      const db = read();
      const persons = db.persons.filter(visible), ids = new Set(persons.map(p => p.id));
      return copy({
        companies: db.companies.filter(visible),
        persons,
        entries: db.history_entries.filter(e => !e.deletedAt && ids.has(e.personId)),
        stages: db.stages, stageChanges: db.stage_changes, vias: db.vias, weekActions: db.week_actions,
        members: [USER]
      });
    },

    // Only the Bin and the Archive ask for hidden records.
    async loadHidden() {
      const db = read();
      return copy({
        bin: {
          companies: db.companies.filter(r => r.deletedAt),
          persons: db.persons.filter(r => r.deletedAt),
          entries: db.history_entries.filter(r => r.deletedAt)
        },
        archive: {
          companies: db.companies.filter(r => r.archivedAt && !r.deletedAt),
          persons: db.persons.filter(r => r.archivedAt && !r.deletedAt)
        }
      });
    },

    async insert(table, row) {
      const db = read();
      const full = { createdAt: now(), createdBy: USER.id, changedAt: null, changedBy: null, ...row };
      db[table].push(full); write(db);
      return copy(full);
    },
    async update(table, id, fields) {
      const db = read(), row = find(db, table, id);
      Object.assign(row, fields, { changedAt: now(), changedBy: USER.id }); write(db);
      return copy(row);
    },
    async remove(table, id) {
      const db = read();
      db[table] = db[table].filter(r => r.id !== id);
      if (table === 'persons') db.history_entries = db.history_entries.filter(e => e.personId !== id);
      write(db);
    },

    // A new contact in one go: a new company if needed, a new person or a contact person
    // that becomes a contact, and the first-contact entry.
    async createContact({ company, person, personIsNew, entry }) {
      const db = read(), meta = { createdAt: now(), createdBy: USER.id, changedAt: null, changedBy: null };
      if (company) db.companies.push({ ...meta, ...company });
      let p;
      if (personIsNew) { p = { ...meta, ...person }; db.persons.push(p); }
      else { p = find(db, 'persons', person.id); Object.assign(p, person, { changedAt: now(), changedBy: USER.id }); }
      const e = { ...meta, ...entry };
      db.history_entries.push(e);
      write(db);
      return copy({ company: company ? db.companies[db.companies.length - 1] : null, person: p, entry: e });
    },

    // A company with its persons, archived together under one group id.
    async archiveCompany(companyId, group) {
      const db = read(), at = now();
      const c = find(db, 'companies', companyId);
      Object.assign(c, { archivedAt: at, archiveGroup: group });
      db.persons.filter(p => p.companyId === companyId && visible(p)).forEach(p => Object.assign(p, { archivedAt: at, archiveGroup: group }));
      write(db);
    },
    async restoreGroup(group) {
      const db = read();
      ['companies', 'persons'].forEach(t => db[t].filter(r => r.archiveGroup === group).forEach(r => Object.assign(r, { archivedAt: null, archiveGroup: null })));
      write(db);
    },

    // Remove for good what has been in the bin longer than the bin period.
    async purgeBin(beforeIso) {
      const db = read(), old = r => r.deletedAt && r.deletedAt < beforeIso;
      const gone = new Set(db.persons.filter(old).map(p => p.id));
      db.companies = db.companies.filter(r => !old(r));
      db.persons = db.persons.filter(r => !old(r));
      db.history_entries = db.history_entries.filter(r => !old(r) && !gone.has(r.personId));
      write(db);
    },

    // Everything, exactly as stored, for the backup export.
    async exportAll() { return copy(read()); }
  };
}
