/**
 * JAFT Settings - the "Instellingen" page, opened from your name in the top right.
 *
 * Responsibilities:
 *   - Backup: export everything, and show when this device last did
 *   - Look: light (the mockup), Orville licht or Orville (the house style of JATL), per device
 *   - Week: the first day of the week, shared by everyone (only the week view depends on it)
 *   - Stages: the fixed first and last stage, and the middle stages: add, rename, reorder,
 *     archive and restore (never delete)
 *   - Bin: what was deleted in the last days, with the days left and restore
 *   - Archive: deleted contacts and companies, restored per group (what went together comes back together)
 *   - About: the app version and the database version
 */

const Settings = (() => {
  const { $, esc, busy, download } = UI;
  const M = Model;
  const LAST_BACKUP = 'jaft_last_backup';
  let hidden = null;

  /* ---------- backup ---------- */

  function renderBackup() {
    let last = null;
    try { last = localStorage.getItem(LAST_BACKUP); } catch (e) { /* storage blocked */ }
    $('lastBackup').textContent = last ? t('settings.backup_last', { day: M.fmtDayLong(M.dayOfTimestamp(last)) }) : t('settings.backup_never');
  }
  async function backup() {
    download(`jaft-backup-${M.iso(M.today())}.json`, await Exporter.backup());
    try { localStorage.setItem(LAST_BACKUP, new Date().toISOString()); } catch (e) { /* storage blocked */ }
    renderBackup();
  }

  /* ---------- look ---------- */
  // A per-device preference, so it lives in this browser only. index.html applies it before drawing.

  const THEMES = ['light', 'orville-light', 'orville'], THEME_KEY = 'jaft_theme';
  function currentTheme() { return document.documentElement.dataset.theme || 'light'; }
  function renderTheme() { $('themeChoice').innerHTML = UI.seg(THEMES.map(k => [k, t('theme.' + k)]), currentTheme()); }
  function setTheme(k) {
    if (k === 'light') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = k;
    try { if (k === 'light') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, k); } catch (e) { /* storage blocked: only for this visit */ }
    renderTheme();
  }

  /* ---------- week ---------- */

  function renderWeek() {
    const days = t('weekdays').split(','), cur = Store.weekStartsOn();
    $('weekStart').innerHTML = days.map((d, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${esc(d)}</option>`).join('');
  }
  async function changeWeekStart() {
    const d = Number($('weekStart').value), days = t('weekdays').split(',');
    const r = await Store.setWeekStartsOn(d);
    Toast.show(t('toast.week_start', { day: days[d] }), '', async () => { await r.undo(); renderWeek(); });
  }

  /* ---------- about ---------- */

  function renderAbout() {
    const v = App.versions();
    $('versionInfo').textContent = t('settings.versions', { app: v.app, db: v.db });
  }

  /* ---------- stages ---------- */

  // One row per stage. Fixed stages only show their name; middle stages can be renamed, moved and archived.
  function manageRow(stage, archived, fixed) {
    const name = Store.stageLabel(stage);
    if (fixed) return `<div class="mrow fixed"><span class="mname">${esc(name)}</span><span class="pill">${esc(t('settings.fixed'))}</span></div>`;
    return `<div class="mrow ${archived ? 'archived' : ''}" data-id="${esc(stage.id)}">
      <input type="text" class="mname-in" value="${esc(name)}" aria-label="${esc(t('settings.name'))}">
      <button type="button" class="mbtn" data-act="up" aria-label="${esc(t('settings.up'))}">↑</button>
      <button type="button" class="mbtn" data-act="down" aria-label="${esc(t('settings.down'))}">↓</button>
      <button type="button" class="mbtn wide" data-act="${archived ? 'restore' : 'archive'}">${esc(t(archived ? 'settings.restore' : 'settings.archive'))}</button>
    </div>`;
  }
  function renderStages() {
    $('stageList').innerHTML = Store.stages().map(s => manageRow(s, Store.stageArchived(s), s.kind !== 'middle')).join('');
  }

  async function manageAction(row, act) {
    const id = row.dataset.id;
    if (act === 'up' || act === 'down') await Store.moveStage(id, act === 'up' ? -1 : 1);
    if (act === 'archive' || act === 'restore') {
      const label = row.querySelector('.mname-in').value;
      await Store.setStageArchived(id, act === 'archive');
      Toast.show(t(act === 'archive' ? 'toast.option_archived' : 'toast.option_restored', { name: label }));
    }
    renderStages();
  }
  async function rename(input) {
    const row = input.closest('.mrow'), name = input.value.trim();
    const current = Store.stage(row.dataset.id).name;
    if (!name) { input.value = current; return; }
    if (name === current) return;
    await Store.renameStage(row.dataset.id, name);
    Toast.show(t('toast.renamed', { name }));
  }
  async function addStage() {
    const input = $('newStage'), name = input.value.trim();
    if (!name) { input.focus(); return; }
    await Store.addStage(name);
    input.value = '';
    renderStages();
  }

  /* ---------- bin and archive ---------- */

  async function renderHidden() {
    $('binList').innerHTML = $('archiveList').innerHTML = `<div class="empty">${esc(t('settings.loading'))}</div>`;
    hidden = await Store.loadHidden();
    const days = r => Math.max(0, JAFT_CONFIG.binDays - Math.floor((Date.now() - new Date(r.deletedAt)) / 864e5));
    const binItems = [
      ...hidden.bin.entries.map(e => ({ table: 'history_entries', row: e, label: t('settings.bin_entry', { name: (Store.person(e.personId) || [...hidden.archive.persons, ...hidden.bin.persons].find(p => p.id === e.personId) || {}).name || t('settings.unknown_person'), day: M.fmtDayLong(M.day(e.happenedOn)) }), sub: e.action || e.note || '' })),
      ...hidden.bin.persons.map(p => ({ table: 'persons', row: p, label: p.name, sub: t('settings.bin_person') })),
      ...hidden.bin.companies.map(c => ({ table: 'companies', row: c, label: c.name, sub: t('settings.bin_company') }))
    ].sort((a, b) => (a.row.deletedAt < b.row.deletedAt ? 1 : -1));
    $('binList').innerHTML = binItems.length ? binItems.map(x =>
      `<div class="hrow"><span><b>${esc(x.label)}</b><small>${esc([x.sub, t('settings.days_left', { n: days(x.row) })].filter(Boolean).join(' · '))}</small></span>
       <button type="button" class="obtn" data-restore-bin="${esc(x.table)}:${esc(x.row.id)}">${esc(t('settings.restore'))}</button></div>`).join('')
      : `<div class="empty">${esc(t('settings.bin_empty'))}</div>`;

    // Archive: one row per group, naming everything in it.
    const groups = {};
    [...hidden.archive.companies.map(c => ({ ...c, isCompany: true })), ...hidden.archive.persons].forEach(r => (groups[r.archiveGroup] = groups[r.archiveGroup] || []).push(r));
    const list = Object.entries(groups).sort((a, b) => (a[1][0].archivedAt < b[1][0].archivedAt ? 1 : -1));
    $('archiveList').innerHTML = list.length ? list.map(([g, rows]) => {
      const company = rows.find(r => r.isCompany), people = rows.filter(r => !r.isCompany);
      const title = company ? company.name : people.map(p => p.name).join(', ');
      const sub = company && people.length ? t('settings.archive_with', { names: people.map(p => p.name).join(', ') }) : '';
      return `<div class="hrow"><span><b>${esc(title)}</b><small>${esc([sub, M.fmtDayLong(M.dayOfTimestamp(rows[0].archivedAt))].filter(Boolean).join(' · '))}</small></span>
        <button type="button" class="obtn" data-restore-group="${esc(g)}">${esc(t('settings.restore'))}</button></div>`;
    }).join('') : `<div class="empty">${esc(t('settings.archive_empty'))}</div>`;
  }

  /* ---------- page ---------- */

  function render() { renderBackup(); renderTheme(); renderWeek(); renderAbout(); renderStages(); renderHidden().catch(e => Toast.error(e, t('error.load_failed'))); }

  function init() {
    $('backupBtn').onclick = () => busy($('backupBtn'), backup);
    $('weekStart').onchange = () => busy($('weekStart'), changeWeekStart);
    $('themeChoice').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) setTheme(k); };
    $('addStage').onclick = () => busy($('addStage'), addStage);
    $('newStage').onkeydown = e => { if (e.key === 'Enter') $('addStage').click(); };
    const list = $('stageList');
    list.addEventListener('click', e => { const b = e.target.closest('.mbtn'); if (b) busy(b, () => manageAction(b.closest('.mrow'), b.dataset.act)); });
    list.addEventListener('change', e => { if (e.target.classList.contains('mname-in')) rename(e.target).catch(err => Toast.error(err)); });
    list.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('mname-in')) e.target.blur(); });
    $('binList').addEventListener('click', e => {
      const b = e.target.closest('[data-restore-bin]'); if (!b) return;
      const [table, id] = b.dataset.restoreBin.split(':');
      busy(b, async () => { await Store.restoreFromBin(table, id, hidden); Toast.show(t('toast.restored')); render(); });
    });
    $('archiveList').addEventListener('click', e => {
      const b = e.target.closest('[data-restore-group]'); if (!b) return;
      busy(b, async () => { await Store.restoreArchived(b.dataset.restoreGroup, hidden); Toast.show(t('toast.restored')); render(); });
    });
  }

  return { init, render };
})();
