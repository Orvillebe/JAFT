/**
 * JAFT Data - Supabase implementation (the JAFT project, separate from JATL).
 *
 * Responsibilities:
 *   - Login and logout (Supabase Auth; users are invited, registration is off)
 *   - The same functions as data-local.js, each write as one call
 *   - Translating between database columns (snake_case) and app fields (camelCase)
 *   - Hiding archived and deleted records in one place: loadAll() never returns them
 *
 * All login code lives in this file, so a shared login library can replace it later.
 * The publishable key may be in the code: Row Level Security (migrations/) enforces access.
 */

// The JAFT Supabase project (Settings > API). Both are public by design; RLS protects the data.
const SUPABASE_URL = 'https://sxwymjktraluaznwbmct.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_WnyP6M-kBIDePyN8EuqvMA_cMCFWgP1';

function createSupabaseData() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Supabase URL and key are not set in data-supabase.js');
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* ---------- mapping ---------- */

  const toCamel = k => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const toSnake = k => k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
  const fromDb = r => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v === null ? null : (k === 'amount' ? Number(v) : v)]));
  // Meta columns are filled by the database (defaults and a trigger), never by the app.
  const META = new Set(['createdAt', 'createdBy', 'changedAt', 'changedBy']);
  const toDb = r => Object.fromEntries(Object.entries(r).filter(([k, v]) => !META.has(k) && v !== undefined).map(([k, v]) => [toSnake(k), v]));

  function check(error) { if (error) throw error; }

  // Supabase returns at most 1000 rows per request: larger tables come in pages.
  // The order must be unique, or a row could fall between two pages.
  async function all(table, build = q => q, orderBy = 'id') {
    const rows = [], PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(sb.from(table).select('*')).order(orderBy).range(from, from + PAGE - 1);
      check(error);
      rows.push(...data);
      if (data.length < PAGE) return rows.map(fromDb);
    }
  }
  const visible = q => q.is('archived_at', null).is('deleted_at', null);

  /* ---------- auth ---------- */

  async function getSession() {
    const { data: { session } } = await sb.auth.getSession();
    return session ? { userId: session.user.id, email: session.user.email } : null;
  }

  return {
    needsLogin: true,
    async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); check(error); },
    async signOut() { const { error } = await sb.auth.signOut(); check(error); },
    getSession,

    async loadAll() {
      const [companies, persons, entries, stages, stageChanges, weekActions, settings, members] = await Promise.all([
        all('companies', visible), all('persons', visible), all('history_entries', q => q.is('deleted_at', null)),
        all('stages'), all('stage_changes'), all('week_actions'), all('app_settings', q => q, 'key'), all('members')
      ]);
      const ids = new Set(persons.map(p => p.id));
      return {
        companies, persons, entries: entries.filter(e => ids.has(e.personId)), stages, stageChanges, weekActions,
        settings: Object.fromEntries(settings.map(s => [s.key, s.value])), members
      };
    },

    // Only the Bin and the Archive ask for hidden records.
    async loadHidden() {
      const [bc, bp, be, ac, ap] = await Promise.all([
        all('companies', q => q.not('deleted_at', 'is', null)),
        all('persons', q => q.not('deleted_at', 'is', null)),
        all('history_entries', q => q.not('deleted_at', 'is', null)),
        all('companies', q => q.not('archived_at', 'is', null).is('deleted_at', null)),
        all('persons', q => q.not('archived_at', 'is', null).is('deleted_at', null))
      ]);
      return { bin: { companies: bc, persons: bp, entries: be }, archive: { companies: ac, persons: ap } };
    },

    async insert(table, row) {
      const { data, error } = await sb.from(table).insert(toDb(row)).select().single();
      check(error); return fromDb(data);
    },
    async update(table, id, fields) {
      const { data, error } = await sb.from(table).update(toDb(fields)).eq('id', id).select().single();
      check(error); return fromDb(data);
    },
    async remove(table, id) {
      const { error } = await sb.from(table).delete().eq('id', id);
      check(error);
    },

    // Company (if new), person and first-contact entry in one transaction: see create_contact in migrations/001_initial.sql.
    async createContact({ company, person, personIsNew, entry }) {
      const { data, error } = await sb.rpc('create_contact', {
        p: { company: company ? toDb(company) : null, person: toDb(person), person_is_new: personIsNew, entry: toDb(entry) }
      });
      check(error);
      return { company: fromDb(data.company), person: fromDb(data.person), entry: fromDb(data.entry) };
    },
    async archiveCompany(companyId, group) {
      const { error } = await sb.rpc('archive_company', { company_id: companyId, archive_group: group });
      check(error);
    },
    async restoreGroup(group) {
      const { error } = await sb.rpc('restore_archive_group', { archive_group: group });
      check(error);
    },

    async purgeBin(beforeIso) {
      for (const table of ['history_entries', 'persons', 'companies']) {
        const { error } = await sb.from(table).delete().lt('deleted_at', beforeIso);
        check(error);
      }
    },

    // The highest migration that has run. 0 when the version table doesn't exist yet.
    async schemaVersion() {
      const { data, error } = await sb.from('schema_migrations').select('version').order('version', { ascending: false }).limit(1);
      if (error) { console.error('Reading the database version failed', error); return 0; }
      return data.length ? data[0].version : 0;
    },

    // A shared setting, by key.
    async saveSetting(key, value) {
      const { error } = await sb.from('app_settings').upsert({ key, value });
      check(error);
    },

    // Everything, exactly as stored, for the backup export.
    async exportAll() {
      const tables = ['companies', 'persons', 'history_entries', 'stages', 'stage_changes', 'week_actions', 'members'];
      const out = {};
      for (const t of tables) out[t] = await all(t);
      out.app_settings = await all('app_settings', q => q, 'key');
      return out;
    }
  };
}
