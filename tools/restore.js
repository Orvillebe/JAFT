/**
 * JAFT Restore - turns a backup file into an SQL script that puts it back into the database.
 *
 * Responsibilities:
 *   - Check the backup (a JAFT backup, not from a newer database version than this code knows)
 *   - Bring older backups up to this version with the same steps as the local data (LOCAL_MIGRATIONS)
 *   - Write one SQL script, run in the Supabase SQL Editor as the database owner, that:
 *       stops unless the database is at this version (SCHEMA_VERSION),
 *       stops unless the database holds no contacts, companies or week actions yet,
 *       replaces the middle stages, settings and stage history with those from the backup,
 *       and inserts everything else exactly as it was: ids, dates, "created by", bin and archive.
 *     All in one transaction: if anything fails, nothing changes.
 *
 * Users are not restored: they are created again in Supabase (and put on the access list).
 * "Created by" and "changed by" only point to users that exist in the database; others become empty.
 *
 * Pure: no DOM and no network, so tests/restore.test.js can check it. tools/restore.html is the page.
 */

function buildRestoreSql(backup, upgradeBackup, schemaVersion) {
  if (!backup || backup.app !== 'JAFT' || backup.kind !== 'backup' || !backup.data) throw new Error('This is not a JAFT backup file.');
  const from = backup.schemaVersion || 0;
  if (from > schemaVersion) throw new Error(`The backup is from database version ${from}; this code knows up to version ${schemaVersion}. Use a newer version of JAFT.`);
  const db = upgradeBackup(backup);

  const toSnake = k => k.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const text = v => `'${String(v).replace(/'/g, "''")}'`;

  // Columns per table, as in migrations/ up to this version. Kinds:
  //   t text (null allowed)   T text, not null, '' when missing   n number   b boolean
  //   d date   ts timestamp (null allowed)   TS timestamp, now() when missing
  //   m a member id: only kept when that user exists in this database   j json
  const COLS = {
    companies: { id: 'T', name: 'T', phone: 'T', email: 'T', website: 'T', note: 'T', archived_at: 'ts', archive_group: 't', deleted_at: 'ts', created_by: 'm', created_at: 'TS', changed_by: 'm', changed_at: 'ts' },
    persons: { id: 'T', company_id: 't', name: 'T', phone: 'T', email: 'T', job_title: 'T', archived_at: 'ts', archive_group: 't', deleted_at: 'ts', created_by: 'm', created_at: 'TS', changed_by: 'm', changed_at: 'ts' },
    stages: { id: 'T', kind: 'T', name: 't', position: 'n', created_by: 'm', created_at: 'TS', changed_by: 'm', changed_at: 'ts' },
    stage_changes: { id: 'T', stage_id: 'T', happened_on: 'd', change: 'T', created_by: 'm', created_at: 'TS', changed_by: 'm', changed_at: 'ts' },
    history_entries: { id: 'T', person_id: 'T', kind: 'T', happened_on: 'd', action: 'T', note: 'T', stage_id: 't', amount: 'n', status: 't', next_step: 'T', next_step_on: 'd', entry_channel: 't', via: 't', hook: 'T', deleted_at: 'ts', created_by: 'm', created_at: 'TS', changed_by: 'm', changed_at: 'ts' },
    week_actions: { id: 'T', happened_on: 'd', kind: 'T', value: 'n', created_by: 'm', created_at: 'TS', changed_by: 'm', changed_at: 'ts' },
    app_settings: { key: 'T', value: 'j', changed_by: 'm', changed_at: 'TS' }
  };

  function value(kind, v) {
    const missing = v === null || v === undefined || v === '';
    switch (kind) {
      case 'T': return text(v ?? '');
      case 't': return missing ? 'null' : text(v);
      case 'n': return missing || isNaN(Number(v)) ? 'null' : String(Number(v));
      case 'b': return missing ? 'null' : (v ? 'true' : 'false');
      case 'd': return missing ? 'null' : `${text(v)}::date`;
      case 'ts': return missing ? 'null' : `${text(v)}::timestamptz`;
      case 'TS': return missing ? 'now()' : `${text(v)}::timestamptz`;
      case 'm': return typeof v === 'string' && UUID.test(v) ? `(select id from members where id = ${text(v)}::uuid)` : 'null';
      case 'j': return `${text(JSON.stringify(v ?? null))}::jsonb`;
    }
    throw new Error('Unknown column kind ' + kind);
  }

  function inserts(table, rows) {
    if (!rows || !rows.length) return `-- ${table}: nothing in the backup`;
    const cols = Object.keys(COLS[table]);
    const tuples = rows.map(r => {
      const snake = Object.fromEntries(Object.entries(r).map(([k, v]) => [toSnake(k), v]));
      return '  (' + cols.map(c => value(COLS[table][c], snake[c])).join(', ') + ')';
    });
    return `insert into ${table} (${cols.join(', ')}) values\n${tuples.join(',\n')};`;
  }

  const n = t => (db[t] || []).length;
  const middle = (db.stages || []).filter(s => s.kind === 'middle');
  const counts = `${n('companies')} companies, ${n('persons')} persons, ${n('history_entries')} history entries, ` +
    `${middle.length} middle stages, ${n('stage_changes')} stage changes, ${n('week_actions')} week actions, ${n('app_settings')} settings`;

  return [
    `-- JAFT restore of the backup from ${backup.exportedAt || 'an unknown date'}`,
    `-- Backup database version ${from}, restored as version ${schemaVersion}.`,
    `-- Contents: ${counts}.`,
    `-- Run in the Supabase SQL Editor. One transaction: if anything fails, nothing changes.`,
    '',
    'begin;',
    '',
    '-- Stop unless the database has exactly the version this backup was prepared for.',
    'do $$',
    'begin',
    `  if (select coalesce(max(version), 0) from schema_migrations) <> ${schemaVersion} then`,
    `    raise exception 'The database is not at version ${schemaVersion}. Run the migrations first, then this script.';`,
    '  end if;',
    '  if exists (select 1 from companies) or exists (select 1 from persons) or exists (select 1 from history_entries) or exists (select 1 from week_actions) then',
    `    raise exception 'The database already holds data. A restore only goes into an empty database, so nothing gets mixed.';`,
    '  end if;',
    'end $$;',
    '',
    '-- Stages: Contact and Opdracht are fixed and already there; the middle stages come from the backup.',
    'delete from stage_changes;',
    'delete from stages where kind = \'middle\';',
    inserts('stages', middle),
    '',
    '-- Settings: replaced by those from the backup.',
    'delete from app_settings;',
    inserts('app_settings', db.app_settings),
    '',
    inserts('stage_changes', db.stage_changes),
    '',
    inserts('companies', db.companies),
    '',
    inserts('persons', db.persons),
    '',
    inserts('history_entries', db.history_entries),
    '',
    inserts('week_actions', db.week_actions),
    '',
    'commit;',
    '',
    '-- Check: these counts should match the contents listed at the top.',
    "select 'companies' as tabel, count(*) from companies",
    "union all select 'persons', count(*) from persons",
    "union all select 'history_entries', count(*) from history_entries",
    "union all select 'middle stages', count(*) from stages where kind = 'middle'",
    "union all select 'stage_changes', count(*) from stage_changes",
    "union all select 'week_actions', count(*) from week_actions",
    "union all select 'app_settings', count(*) from app_settings;",
    ''
  ].join('\n');
}

if (typeof module !== 'undefined') module.exports = buildRestoreSql;
