/**
 * JAFT - Just A Funnel Tool
 *
 * Follow up contacts and see, week by week, whether you are moving forward.
 *
 * Structure (one file per task):
 *   config.js          - settings that change rarely (live address, week boundary, entry channels)
 *   i18n/nl.js, i18n.js - all interface text, by key
 *   model.js           - pure rules: calendar, stages, a person's state, week counts
 *   data-local.js      - storage in this browser (testing)
 *   data-supabase.js   - storage in Supabase, including login
 *   data-service.js    - picks one of the two
 *   store.js           - data in memory, saving with undo, bin and archive
 *   ui.js              - shared UI: toast, recent list, reward, swipe rows
 *   contacts.js        - Contacten tab: list, new contact, detail and timeline
 *   companies.js       - Bedrijven tab
 *   overview.js        - Overzicht page
 *   settings.js        - Instellingen page
 *   export.js          - backup and analysis export
 *   version.js         - app version and the database version it needs
 *   app.js             - this file: login, version check, loading, switching pages, the menu
 */

const App = (() => {
  const { $ } = UI;
  let page = 'input', loadedAt = 0, started = false, dbVersion = null;

  const PAGES = {
    input: { title: 'page.input', to: 'overview', button: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>', label: 'page.overview' },
    overview: { title: 'page.overview', to: 'input', button: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', label: 'page.to_input' },
    settings: { title: 'page.settings', to: 'input', button: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>', label: 'page.back' }
  };

  function showPage(p) {
    page = p;
    ['input', 'overview', 'settings'].forEach(k => $('page-' + k).classList.toggle('hidden', k !== p));
    $('title').textContent = t(PAGES[p].title);
    $('switch').innerHTML = PAGES[p].button + UI.esc(t(PAGES[p].label));
    $('switch').dataset.to = PAGES[p].to;
    $('menu').classList.add('hidden');
    if (p === 'overview') Overview.render();
    if (p === 'settings') Settings.render();
    window.scrollTo(0, 0);
  }

  // After undo or reload: show the open page again, without clearing forms.
  function refresh() {
    Recent.render();
    if (page === 'overview') Overview.render();
    else if (page === 'settings') Settings.render();
    else Contacts.refresh();
  }

  /* ---------- login ---------- */

  function showLogin(error = '') {
    $('loginScreen').classList.remove('hidden');
    $('app').classList.add('hidden');
    $('loginError').textContent = error;
  }

  async function login() {
    const email = $('loginEmail').value.trim(), pw = $('loginPassword').value;
    if (!email || !pw) { $('loginError').textContent = t('login.fill_in'); return; }
    $('loginBtn').disabled = true; $('loginError').textContent = '';
    try { await DataService.signIn(email, pw); await start(); }
    catch (e) { $('loginError').textContent = t('login.failed'); console.error(e); }
    finally { $('loginBtn').disabled = false; }
  }

  async function logout() {
    if (!UI.confirmPopup(t('confirm.logout'))) return;
    try { await DataService.signOut(); } catch (e) { console.error(e); }
    location.reload();
  }

  /* ---------- starting ---------- */

  // The database must be exactly the version this code was built for (version.js).
  // Older: the migration hasn't run yet. Newer: this copy of the app is outdated.
  // Either way nothing is loaded or saved, so the data can't get mixed up.
  // A connection problem is thrown, not treated as a version: the caller decides what to show.
  async function checkVersion() {
    dbVersion = await DataService.schemaVersion();
    if (dbVersion === SCHEMA_VERSION) return true;
    $('loading').classList.add('hidden'); $('app').classList.add('hidden');
    $('versionText').textContent = dbVersion < SCHEMA_VERSION
      ? t('version.db_older', { db: dbVersion, app: SCHEMA_VERSION })
      : t('version.app_older', { db: dbVersion, app: SCHEMA_VERSION });
    $('versionReload').classList.toggle('hidden', dbVersion < SCHEMA_VERSION);
    $('versionScreen').classList.remove('hidden');
    return false;
  }

  async function start() {
    $('loginScreen').classList.add('hidden');
    $('loading').classList.remove('hidden');
    try {
      if (!await checkVersion()) return;
      await Store.load();
      loadedAt = Date.now();
    } catch (e) {
      console.error(e);
      $('loading').classList.add('hidden');
      return showLogin(t('error.load', { reason: e.message || e }));  // also when there's no connection
    }
    $('loading').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('me').textContent = Store.myName() || t('menu.me');
    if (!started) {
      started = true;
      Contacts.init(); Companies.init(); Overview.init(); Settings.init(); Toast.init();
      Contacts.setMode('contacts'); Contacts.renderNew(); Recent.render();
    }
    showPage('input');
  }

  // Coming back to the app after a while shows what the other person saved meanwhile.
  // Only reloads data: a half-filled form stays as it is. Without a connection nothing changes on
  // screen; the next return to the app tries again.
  async function reloadIfStale() {
    if (document.visibilityState !== 'visible' || !started || Date.now() - loadedAt < 60000) return;
    try { if (!await checkVersion()) return; await Store.reload(); loadedAt = Date.now(); refresh(); }
    catch (e) { console.error('Reloading failed', e); }
  }

  async function init() {
    I18N.applyTranslations();
    $('loginBtn').onclick = login;
    $('loginPassword').onkeydown = e => { if (e.key === 'Enter') login(); };
    // The eye shows or hides the password; the cursor stays in the field.
    $('pwToggle').onclick = () => {
      const show = $('loginPassword').type === 'password';
      $('loginPassword').type = show ? 'text' : 'password';
      $('pwToggle').setAttribute('aria-pressed', show);
      const label = t(show ? 'login.hide_password' : 'login.show_password');
      $('pwToggle').setAttribute('aria-label', label); $('pwToggle').title = label;
      $('loginPassword').focus();
    };
    $('switch').onclick = () => showPage($('switch').dataset.to);
    // The menu under your name: Instellingen and Afmelden.
    $('me').onclick = e => { e.stopPropagation(); $('menu').classList.toggle('hidden'); };
    document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) $('menu').classList.add('hidden'); });
    $('toSettings').onclick = () => showPage('settings');
    $('logout').onclick = logout;
    $('versionReload').onclick = () => location.reload();
    $('logout').classList.toggle('hidden', !DataService.needsLogin);
    $('localNote').classList.toggle('hidden', DataService.needsLogin);
    document.querySelectorAll('textarea').forEach(el => el.addEventListener('input', () => UI.grow(el)));
    document.addEventListener('visibilitychange', reloadIfStale);
    const session = await DataService.getSession();
    if (session) await start(); else showLogin();
  }

  const versions = () => ({ app: APP_VERSION, db: dbVersion });

  return { init, refresh, versions };
})();

App.init();
