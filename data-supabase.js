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
 * The publishable key may be in the code: Row Level Security in schema.sql enforces access.
 */

// Fill in after creating the JAFT Supabase project (Settings > API).
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';

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
  async function all(table, build = q => q) {
    const rows = [], PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(sb.from(table).select('*')).order('id').range(from, from + PAGE - 1);
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
      const [companies, persons, entries, stages, stageChanges, vias, weekActions, members] = await Promise.all([
        all('companies', visible), all('persons', visible), all('history_entries', q => q.is('deleted_at', null)),
        all('stages'), all('stage_changes'), all('vias'), all('week_actions'), all('members')
      ]);
      const ids = new Set(persons.map(p => p.id));
      return { companies, persons, entries: entries.filter(e => ids.has(e.personId)), stages, stageChanges, vias, weekActions, members };
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

    // Company (if new), person and first-contact entry in one transaction: see create_contact in schema.sql.
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

    // Everything, exactly as stored, for the backup export.
    async exportAll() {
      const tables = ['companies', 'persons', 'history_entries', 'stages', 'stage_changes', 'vias', 'week_actions', 'members'];
      const out = {};
      for (const t of tables) out[t] = await all(t);
      return out;
    }
  };
}
