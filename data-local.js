/**
 * JAFT Data - local storage implementation.
 *
 * Responsibilities:
 *   - The same functions as data-supabase.js, stored in this browser only (localStorage)
 *   - Hiding archived and deleted records in one place: loadAll() never returns them
 *   - Seeding the fixed stages and the initial middle stages on first use
 *   - Upgrading stored data to the current version, the local mirror of migrations/ (LOCAL_MIGRATIONS)
 *   - Importing a backup file, for testing a new version on a copy of real data
 *
 * Used everywhere except on the live address (productionHosts in config.js), so local testing
 * never touches the real database.
 * There is no login: everything is saved as one local user.
 * tests/load-testdata.html fills this storage with a test data set.
 */

function createLocalData() {
  const KEY = 'jaft_local_v1';
  const USER = { id: 'local-user', name: 'Lokaal', email: '' };
  const TABLES = ['companies', 'persons', 'history_entries', 'stages', 'stage_changes', 'week_actions', 'app_settings'];
  const now = () => new Date().toISOString();
  const copy = o => JSON.parse(JSON.stringify(o));

  // The same steps as the files in migrations/, for data in this browser. Step n brings data
  // from version n - 1 to version n. Never change a step that has shipped; add a new one.
  const LOCAL_MIGRATIONS = {
    // 1: initial. Data from before versioning stored week actions by the start of their week.
    1: db => {
      db.week_actions = (db.week_actions || []).map(({ weekStart, ...a }) => ({ ...a, happenedOn: a.happenedOn || weekStart }));
      db.app_settings = db.app_settings || [];
      delete db.vias; // via options became fixed keys before versioning started
    },
    // 2: access list. Only in the real database (members.allowed); nothing to change locally.
    2: () => {}
  };

  function upgrade(db) {
    let v = db.schemaVersion || 0;
    while (v < SCHEMA_VERSION && LOCAL_MIGRATIONS[v + 1]) { LOCAL_MIGRATIONS[v + 1](db); v++; }
    db.schemaVersion = v;
    return db;
  }

  function seed() {
    const db = Object.fromEntries(TABLES.map(t => [t, []]));
    db.schemaVersion = SCHEMA_VERSION;
    const meta = { createdAt: now(), createdBy: USER.id, changedAt: null, changedBy: null };
    db.stages = [
      { id: 'contact', kind: 'start', name: null, position: 0, ...meta },
      { id: newId(), kind: 'middle', name: 'Gesprek', position: 1, ...meta },
      { id: newId(), kind: 'middle', name: 'Offerte', position: 2, ...meta },
      { id: 'order', kind: 'end', name: null, position: 1000, ...meta }
    ];
    return db;
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const db = JSON.parse(raw), before = db.schemaVersion || 0;
        upgrade(db);
        TABLES.forEach(t => { db[t] = db[t] || []; });
        if (db.schemaVersion !== before) write(db);
        return db;
      }
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
        stages: db.stages, stageChanges: db.stage_changes, weekActions: db.week_actions,
        settings: Object.fromEntries(db.app_settings.map(s => [s.key, s.value])),
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

    // The version of the stored data, compared with SCHEMA_VERSION at startup.
    async schemaVersion() { return read().schemaVersion; },

    // The access list only exists in the real database; locally there are no logins.
    async hasAccess() { return true; },

    // A shared setting, by key.
    async saveSetting(key, value) {
      const db = read(), row = db.app_settings.find(s => s.key === key);
      if (row) Object.assign(row, { value, changedAt: now(), changedBy: USER.id });
      else db.app_settings.push({ key, value, changedAt: now(), changedBy: USER.id });
      write(db);
    },

    // Everything, exactly as stored, for the backup export.
    async exportAll() { const db = copy(read()); delete db.schemaVersion; return db; },

    // Testing only: replace the local data with a backup file, then upgrade it to this version.
    importBackup(backup) {
      const db = { ...copy(backup.data), schemaVersion: backup.schemaVersion || 0 };
      delete db.members; delete db.schema_migrations;
      write(upgrade(db));
      return db;
    }
  };
}
