/**
 * JAFT Contacts - the Contacten tab on the "Contact ingeven" page.
 *
 * Responsibilities:
 *   - Tabs Contacten and Bedrijven (setMode), and going back to where you came from
 *   - Search list with filters (status, stage), sorting and "+ Nieuw"
 *   - The "Nieuw contact" form with suggestions for company and contact person
 *   - A contact's detail: details, active or inactive, timeline, update form,
 *     correcting and deleting history entries, deleting (archiving) the contact
 *   - Date pickers (Wanneer, Volgende stap) for both forms
 *
 * Rules (stage, next step, active) live in model.js; saving goes through store.js.
 * The Bedrijven tab is in companies.js.
 */

const Contacts = (() => {
  const { $, q, esc, seg, chips, regrowAll, busy, confirmPopup } = UI;
  const M = Model, CFG = JAFT_CONFIG;
  const WHEN = ['today', 'yesterday', 'date'];
  const NEXT = [['tomorrow', 1], ['week', 7], ['2weeks', 14], ['date', null]];
  const SORTS = ['next', 'name', 'company'];

  const filter = { status: 'active', stage: 'all' };
  let sort = 'next', mode = 'contacts', origin = 'contacts', selectedId = null, showAll = false, editingHeader = false;
  let editingEntryId = null, editingNextOf = null; // the entry being corrected
  let pickedCompany = null, pickedPerson = null;   // chosen in the "Nieuw contact" form
  const st = { n: { when: 'today', next: null, channel: null, via: null }, u: { when: 'today', next: null, stage: null } }; // stage null: no change
  let DI = null, BTN = null; // date inputs and their chips, set in init()

  const T = () => M.today();
  const selected = () => selectedId && Store.person(selectedId);

  /* =============================================
     Date pickers
     ============================================= */

  function dayFrom(f) {
    const w = st[f].when, inp = DI[f].d;
    if (w === 'yesterday') return Math.max(0, T() - 1);
    if (w === 'date' && inp.value) return Math.min(T(), M.day(inp.value));
    return T();
  }
  // A text without a day plans a week ahead; a day without a text is "Opvolgen".
  function nextFrom(f, text) {
    const v = st[f].next;
    if (!text && !v) return null;
    const opt = NEXT.find(x => x[0] === v), inp = DI[f].v;
    const d = !opt ? T() + 7 : opt[0] === 'date' ? (inp.value ? M.day(inp.value) : T() + 7) : T() + opt[1];
    return { text, day: d };
  }

  // "Datum" opens the calendar at once: the chip is itself a real date field laid invisibly
  // over the chip, so a normal tap opens the calendar in every browser (Chrome and Edge via showPicker).
  function dateChip(inp) {
    const lab = document.createElement('label');
    lab.className = 'chip datechip';
    lab.innerHTML = '<span class="dl"></span>';
    inp.className = 'dateover'; inp.removeAttribute('tabindex'); inp.removeAttribute('aria-hidden');
    inp.setAttribute('aria-label', t('date.pick'));
    inp.addEventListener('click', () => { try { inp.showPicker(); } catch (e) { /* the browser opens it itself */ } });
    lab.appendChild(inp);
    return lab;
  }
  function setChip(lab, on) {
    const inp = lab.querySelector('input');
    lab.classList.toggle('on', on);
    lab.querySelector('.dl').textContent = inp.value ? t('date.chosen', { day: M.fmtDayLong(M.day(inp.value)) }) : t('date.date');
  }
  function renderDates(f) {
    const w = q(`[data-when="${f}"]`), v = q(`[data-next="${f}"]`);
    w.innerHTML = chips(WHEN.filter(k => k !== 'date').map(k => [k, t('when.' + k)]), st[f].when); w.appendChild(BTN[f].when);
    setChip(BTN[f].when, st[f].when === 'date');
    v.innerHTML = chips(NEXT.filter(x => x[0] !== 'date').map(([k]) => [k, t('next.' + k)]), st[f].next); v.appendChild(BTN[f].next);
    setChip(BTN[f].next, st[f].next === 'date');
  }
  // Limits depend on today: set again each time a form opens.
  function setLimits(f) { DI[f].d.max = M.iso(T()); DI[f].v.min = M.iso(T() + 1); }

  function initDates() {
    // Fixed references: the date inputs move into their chip and are not always in the page.
    DI = { n: { d: q('[data-whendate="n"]'), v: q('[data-nextdate="n"]') }, u: { d: q('[data-whendate="u"]'), v: q('[data-nextdate="u"]') } };
    BTN = {};
    ['n', 'u'].forEach(f => {
      BTN[f] = { when: dateChip(DI[f].d), next: dateChip(DI[f].v) };
      // Another choice clears the chosen date, so the chip never shows what no longer applies.
      q(`[data-when="${f}"]`).onclick = e => { const k = e.target.closest('button')?.dataset.k; if (!k) return; st[f].when = k; DI[f].d.value = ''; renderDates(f); };
      q(`[data-next="${f}"]`).onclick = e => { const k = e.target.closest('button')?.dataset.k; if (!k) return; st[f].next = st[f].next === k ? null : k; DI[f].v.value = ''; renderDates(f); };
      DI[f].d.onchange = e => { st[f].when = e.target.value ? 'date' : 'today'; renderDates(f); };
      DI[f].v.onchange = e => { st[f].next = e.target.value ? 'date' : null; renderDates(f); };
      setLimits(f);
    });
  }

  /* =============================================
     Tabs
     ============================================= */

  // Two tabs: Contacten and Bedrijven. The new-contact form belongs to Contacten and opens from
  // the search list or from a company; "Terug" and saving return to where you came from.
  function setMode(k) {
    if (k === 'new' && mode !== 'new') origin = mode || 'contacts';
    mode = k;
    $('tabs').innerHTML = seg([['contacts', t('tab.contacts')], ['companies', t('tab.companies')]], k === 'new' ? 'contacts' : k);
    $('newPanel').classList.toggle('hidden', k !== 'new');
    $('contactsPanel').classList.toggle('hidden', k !== 'contacts');
    $('companiesPanel').classList.toggle('hidden', k !== 'companies');
    if (k === 'companies') Companies.show();
    if (k === 'contacts') { if (selected()) renderDetail(); else { renderList(); $('search').focus(); } }
  }
  function backToOrigin() {
    if (origin === 'contacts') { closeDetail(); $('search').value = ''; }
    setMode(origin);
  }

  /* =============================================
     New contact
     ============================================= */

  function clearNew() {
    ['nName', 'nCompany', 'nJob', 'nPhone', 'nEmail', 'nHook', 'nNext', 'nNote'].forEach(i => { $(i).value = ''; });
    DI.n.d.value = ''; DI.n.v.value = '';
    Object.assign(st.n, { when: 'today', next: null, channel: null, via: null });
    $('nExisting').classList.add('hidden');
    pickedPerson = null; pickCompany(null);
    setLimits('n'); renderNew(); regrowAll();
  }

  // Opens the form, optionally with a name, a company or a known contact person filled in.
  function openNew({ name = '', company = null, companyName = '', person = null } = {}) {
    setMode('new'); clearNew(); window.scrollTo(0, 0);
    if (person) return pickPerson(person);
    if (companyName) { $('nCompany').value = companyName; companyChanged(); $('nName').focus(); return; }
    if (company) pickCompany(company);
    if (name) { $('nName').value = name; nameChanged(false); $('nPhone').focus(); }
    else $(company ? 'nName' : 'nCompany').focus();
  }

  function renderNew() {
    const ch = Store.channel(st.n.channel);
    $('nChannel').innerHTML = seg(Store.channels().map(c => [c.key, Store.channelLabel(c.key)]), st.n.channel);
    $('nVia').innerHTML = chips(Store.viaOptions().map(k => [k, Store.viaLabel(k)]), st.n.via);
    $('nViaWrap').classList.toggle('hidden', !(ch && ch.asksVia));
    renderDates('n');
    $('saveNew').disabled = !($('nName').value.trim() && st.n.channel);
  }

  // Does this name exist already? Then a link to the existing contact (never a block).
  function nameChanged(byUser) {
    // Clearing the name lets go of a chosen contact person; fixing a typo does not.
    if (byUser && !$('nName').value.trim()) pickedPerson = null;
    if (byUser) renderPersonSuggestions();
    const n = $('nName').value.trim().toLowerCase();
    const hits = n ? Store.contacts().filter(c => c.name.toLowerCase() === n) : [];
    $('nExisting').classList.toggle('hidden', !hits.length);
    if (hits.length) {
      $('nExisting').innerHTML = esc(t('new.name_exists', { count: hits.length })) + hits.map(h =>
        `<button type="button" class="link-btn" data-id="${esc(h.id)}">${esc(h.name)}${h.companyName ? ' · ' + esc(h.companyName) : ''} · ${esc(Store.stageLabel(h.stageId))} ›</button>`).join('');
      $('nExisting').querySelectorAll('[data-id]').forEach(b => { b.onclick = () => { setMode('contacts'); select(b.dataset.id); }; });
    }
    renderNew();
  }

  // Company: typing shows companies from the list (with details to tell duplicates apart),
  // or offers a new one. Names are not unique, so "new" is always possible.
  function companyChanged() {
    pickCompany(null);
    renderCompanySuggestions();
    const same = Store.companiesNamed($('nCompany').value);
    $('nCompanyNote').classList.toggle('hidden', !same.length);
    if (same.length) $('nCompanyNote').textContent = t('new.company_exists');
  }
  function renderCompanySuggestions() {
    const text = $('nCompany').value.trim(), tl = text.toLowerCase();
    if (!text || pickedCompany) { $('companySuggest').classList.add('hidden'); return; }
    const hits = Store.companies().filter(c => c.name.toLowerCase().includes(tl)).sort((a, b) => a.name.localeCompare(b.name, 'nl')).slice(0, 6);
    const exists = Store.companiesNamed(text).length > 0;
    $('companySuggest').innerHTML = hits.map(c => `<button type="button" data-cid="${esc(c.id)}"><span>${esc(c.name)}</span><small>${esc(Companies.info(c))}</small></button>`).join('') +
      `<button type="button" class="new-opt" data-new="1">${esc(t(exists ? 'new.company_new_anyway' : 'new.company_new', { name: text }))}</button>`;
    $('companySuggest').classList.remove('hidden');
  }
  function pickCompany(c) {
    pickedCompany = c;
    if (c) { $('nCompany').value = c.name; $('nCompanyNote').classList.add('hidden'); }
    $('companySuggest').classList.add('hidden');
    if (pickedPerson && (!c || pickedPerson.companyId !== c.id)) pickedPerson = null;
  }

  // Person: after the company, the name field shows its contact persons not yet contacted.
  // Without a company it searches all companies, and fills in the company too.
  function renderPersonSuggestions() {
    const text = $('nName').value.trim().toLowerCase();
    if (pickedPerson) { $('personSuggest').classList.add('hidden'); return; }
    const source = pickedCompany ? Store.contactPersonsOf(pickedCompany.id) : (text ? Store.contactPersons() : []);
    const hits = source.filter(p => !text || p.name.toLowerCase().includes(text)).slice(0, 6);
    $('personSuggest').innerHTML = hits.map(p => `<button type="button" data-pid="${esc(p.id)}"><span>${esc(p.name)}</span><small>${esc(pickedCompany ? t('person.not_contacted') : [p.companyName, p.phone].filter(Boolean).join(' · '))}</small></button>`).join('');
    $('personSuggest').classList.toggle('hidden', !hits.length);
  }
  function pickPerson(p) {
    pickCompany(p ? Store.company(p.companyId) : pickedCompany);
    pickedPerson = p;
    if (p) { $('nName').value = p.name; $('nJob').value = p.jobTitle || ''; $('nPhone').value = p.phone || ''; $('nEmail').value = p.email || ''; }
    $('personSuggest').classList.add('hidden');
    nameChanged(false);
  }

  async function saveNew() {
    const d = dayFrom('n'), w = M.weekOf(d), before = Store.counts().improvements(w);
    const companyText = $('nCompany').value.trim();
    const company = companyText ? pickedCompany : null;
    // A contact person of this company becomes a contact.
    const person = pickedPerson && company && pickedPerson.companyId === company.id ? pickedPerson : null;
    const name = $('nName').value.trim(), next = nextFrom('n', $('nNext').value.trim());
    const ch = Store.channel(st.n.channel), asksVia = ch && ch.asksVia;
    const r = await Store.createContact({
      personId: person ? person.id : null, companyId: company ? company.id : null, companyName: company ? '' : companyText,
      name, jobTitle: $('nJob').value.trim(), phone: $('nPhone').value.trim(), email: $('nEmail').value.trim(),
      entryChannel: st.n.channel, via: asksVia ? st.n.via : null, hook: asksVia ? $('nHook').value.trim() : '',
      happenedOn: M.iso(d), note: $('nNote').value.trim(),
      nextStep: next ? next.text : '', nextStepOn: next ? M.iso(next.day) : null
    });
    const via = asksVia && st.n.via ? ' · ' + Store.viaLabel(st.n.via) : '';
    const item = Recent.add({ personId: r.person.id, line: t('recent.new', { channel: Store.channelLabel(st.n.channel) + via }), day: d });
    Reward.show(before, w, t('toast.saved', { name }), async () => { await r.undo(); Recent.remove(item); });
    clearNew();
    backToOrigin();
    if (origin === 'contacts') $('search').focus();
  }

  function initNew() {
    $('newBack').onclick = backToOrigin;
    $('nChannel').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) { st.n.channel = k; renderNew(); } };
    $('nVia').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) { st.n.via = st.n.via === k ? null : k; renderNew(); } };
    $('nName').oninput = () => nameChanged(true);
    let pTimer = null;
    $('nName').onfocus = () => { clearTimeout(pTimer); renderPersonSuggestions(); };
    $('nName').onblur = () => { clearTimeout(pTimer); pTimer = setTimeout(() => $('personSuggest').classList.add('hidden'), 120); };
    $('personSuggest').onmousedown = e => e.preventDefault();
    $('personSuggest').onclick = e => { const b = e.target.closest('button'); if (b) pickPerson(Store.person(b.dataset.pid)); };
    $('nCompany').oninput = companyChanged;
    $('nCompany').onfocus = renderCompanySuggestions;
    $('nCompany').onblur = () => setTimeout(() => $('companySuggest').classList.add('hidden'), 120);
    $('companySuggest').onmousedown = e => e.preventDefault();
    $('companySuggest').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cid) pickCompany(Store.company(b.dataset.cid));
      else { $('companySuggest').classList.add('hidden'); $('nCompanyNote').classList.add('hidden'); }
      $('nName').focus();
    };
    $('saveNew').onclick = () => busy($('saveNew'), saveNew);
  }

  /* =============================================
     Search list
     ============================================= */

  function compare(a, b) {
    if (sort === 'name') return a.name.localeCompare(b.name, 'nl');
    if (sort === 'company') return (a.companyName || '~').localeCompare(b.companyName || '~', 'nl') || a.name.localeCompare(b.name, 'nl');
    // Next step: what is most overdue first, then the next planned step,
    // then those without a step, most recent activity first.
    const va = a.nextStep ? a.nextStep.day : Infinity, vb = b.nextStep ? b.nextStep.day : Infinity;
    if (va !== vb) return va - vb;
    return b.lastActivity - a.lastActivity;
  }

  // Search: every word separately, in any order.
  const words = () => $('search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (ws, fields) => { const s = fields.filter(Boolean).join(' ').toLowerCase(); return ws.every(w => s.includes(w)); };

  function renderFilters() {
    const options = {
      status: [['active', t('filter.active')], ['inactive', t('filter.inactive')], ['all', t('filter.all')]],
      stage: [['all', t('filter.all')]].concat(Store.stages().filter(s => !Store.stageArchived(s) || filter.stage === s.id).map(s => [s.id, Store.stageLabel(s)]))
    };
    const defaults = { status: 'active', stage: 'all' };
    document.querySelectorAll('[data-dd]').forEach(dd => {
      const key = dd.dataset.dd, opts = options[key], cur = filter[key];
      const btn = dd.querySelector('.dd-btn');
      btn.classList.toggle('on', cur !== defaults[key]);
      btn.innerHTML = `<span class="k">${esc(t('filter.' + key))}:</span><b>${esc((opts.find(o => o[0] === cur) || opts[0])[1])}</b><span class="arrow">▾</span>`;
      dd.querySelector('.dd-menu').innerHTML = opts.map(([k, l]) => `<button type="button" data-k="${esc(k)}" aria-pressed="${k === cur}">${esc(l)}</button>`).join('');
    });
  }

  function renderList() {
    $('sort').innerHTML = seg(SORTS.map(k => [k, t('sort.' + k)]), sort);
    renderFilters();
    const rawText = $('search').value.trim(), ws = words(), T0 = T();
    const match = c => matches(ws, [c.name, c.companyName, c.jobTitle, c.phone, c.email]);
    // Searching only filters; the chosen sort always decides the order.
    const all = Store.contacts();
    const cs = all.filter(c => filter.status === 'all' || (filter.status === 'active') === c.active)
      .filter(c => filter.stage === 'all' || c.stageId === filter.stage).filter(match).sort(compare);
    // What the search finds but the filter hides is mentioned under the list.
    const hidden = rawText ? all.filter(match).length - cs.length : 0;
    const limit = showAll || rawText ? cs.length : CFG.listLength;
    // With a search term: also contact persons who have not been contacted yet.
    const ps = rawText ? Store.contactPersons().filter(p => p.companyId && matches(ws, [p.name, p.companyName, p.jobTitle, p.phone, p.email])) : [];
    const bs = rawText ? Store.companies().filter(c => matches(ws, [c.name])) : [];
    const onlyCompany = bs.length === 1 ? bs[0] : null;
    // The new-contact button is always in the same place above the list.
    // With a search term it splits in two: the term is the name, or the term is the company.
    const plus = rawText
      ? `<div class="plus-row"><button type="button" class="plus" data-new="name">${esc(t('list.new_name'))}<small>${esc(rawText)}</small></button>` +
        `<button type="button" class="plus" data-new="company"${onlyCompany ? ` data-cid="${esc(onlyCompany.id)}"` : ''}>${esc(t('list.new_company'))}<small>${esc(onlyCompany ? onlyCompany.name : rawText)}</small></button></div>`
      : `<button type="button" class="plus" data-new="empty" style="margin:4px 0 8px">${esc(t('list.new_contact'))}</button>`;
    const row = c => {
      const late = c.nextStep && c.nextStep.day < T0;
      const nx = c.nextStep ? `${esc(c.nextStep.text || t('next.default'))} · ${late ? `<span class="pill late">${esc(t('list.days_late', { n: T0 - c.nextStep.day }))}</span>` : M.fmtDayLong(c.nextStep.day)}` : `<span class="muted">${esc(t('list.no_next'))}</span>`;
      return `<button type="button" class="item ${c.active ? '' : 'off'}" data-id="${esc(c.id)}"><span class="r1"><b>${esc(c.name)}</b><span>${c.active ? '' : `<span class="pill inactive">${esc(t('status.inactive'))}</span> `}<span class="pill ${stageClass(c.stageId)}">${esc(Store.stageLabel(c.stageId))}</span></span></span><span class="sub">${esc(c.companyName || t('list.no_company'))} · ${esc(Store.channelLabel(c.entryChannel))}</span><span class="nx">${nx}</span></button>`;
    };
    const psHtml = ps.length ? `<div class="group">${esc(t('list.not_contacted'))}</div>` + ps.map(p => `<button type="button" class="item" data-pid="${esc(p.id)}"><span class="r1"><b>${esc(p.name)}</b><span class="pill">${esc(t('person.not_contacted'))}</span></span><span class="sub">${esc([p.companyName, p.jobTitle, p.phone].filter(Boolean).join(' · '))}</span></button>`).join('') : '';
    $('list').innerHTML = plus +
      (rawText && (cs.length || hidden) ? `<div class="group">${esc(t('list.contacts'))}</div>` : '') +
      cs.slice(0, limit).map(row).join('') +
      (limit < cs.length ? `<button type="button" class="more" id="more">${esc(t('list.show_all', { n: cs.length }))}</button>` : '') +
      (cs.length || ps.length ? '' : `<div class="empty">${esc(all.length || rawText ? (rawText ? t('list.none_for', { text: rawText }) : t('list.none')) : t('list.first'))}</div>`) +
      (hidden ? `<button type="button" class="more" id="showHidden">${esc(t('list.hidden', { n: hidden }))}</button>` : '') +
      psHtml;
    const m = $('more'); if (m) m.onclick = () => { showAll = true; renderList(); };
    const sh = $('showHidden'); if (sh) sh.onclick = () => { filter.status = 'all'; filter.stage = 'all'; renderList(); };
  }

  // Colour per stage: the further in the funnel, the stronger. The end stage is gold.
  function stageClass(id) {
    const list = Store.stages(), i = list.findIndex(s => s.id === id);
    if (id === M.END_STAGE) return 'st-end';
    if (i <= 0) return '';
    return i >= list.length - 2 ? 'st-late' : 'st-mid';
  }

  function initList() {
    $('search').oninput = renderList;
    // Dropdowns: a tap opens, a choice closes. A tap elsewhere closes too.
    document.querySelectorAll('[data-dd]').forEach(dd => {
      const menu = dd.querySelector('.dd-menu');
      dd.querySelector('.dd-btn').onclick = e => {
        e.stopPropagation();
        document.querySelectorAll('[data-dd] .dd-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
        menu.classList.toggle('hidden');
      };
      menu.onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) { filter[dd.dataset.dd] = k; menu.classList.add('hidden'); showAll = false; renderList(); } };
    });
    document.addEventListener('click', e => { if (!e.target.closest('.dd')) document.querySelectorAll('[data-dd] .dd-menu').forEach(m => m.classList.add('hidden')); });
    $('sort').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) { sort = k; renderList(); } };
    $('list').onclick = e => {
      const n = e.target.closest('.plus');
      if (n) {
        if (n.dataset.new === 'name') return openNew({ name: $('search').value.trim() });
        if (n.dataset.new === 'company') return n.dataset.cid ? openNew({ company: Store.company(n.dataset.cid) }) : openNew({ companyName: $('search').value.trim() });
        return openNew();
      }
      const b = e.target.closest('.item'); if (!b) return;
      if (b.dataset.pid) return openNew({ person: Store.person(b.dataset.pid) });
      select(b.dataset.id);
    };
    // Enter in the search field: if nothing was found, a new contact with that name.
    $('search').onkeydown = e => { if (e.key === 'Enter' && $('search').value.trim() && !$('list').querySelector('.item')) openNew({ name: $('search').value.trim() }); };
    $('detailBack').onclick = () => { closeDetail(); renderList(); };
  }

  /* =============================================
     A contact's detail
     ============================================= */

  function select(id) {
    selectedId = id; editingHeader = false;
    resetUpdateForm();
    $('pickList').classList.add('hidden'); $('detail').classList.remove('hidden');
    renderDetail(); regrowAll(); window.scrollTo(0, 0);
  }
  function closeDetail() {
    selectedId = null; editingEntryId = null; editingNextOf = null;
    $('detail').classList.add('hidden'); $('pickList').classList.remove('hidden');
  }

  const IC = {
    company: '<path d="M4 21V7l6-3v17M10 21h10V10l-10-3M7 10h.01M7 14h.01M7 18h.01M14 13h2M14 17h2"/>',
    job: '<path d="M4 8h16v11H4zM9 8V5h6v3"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
    email: '<path d="M3 6h18v12H3zM3 7l9 6 9-6"/>'
  };

  function renderDetail() {
    const c = selected();
    if (!c) { closeDetail(); renderList(); return; }
    const company = c.companyId && Store.company(c.companyId);
    // Company, job title, phone and e-mail each on their own line with an icon. Only what exists is shown.
    const line = (ic, inner) => `<span class="dline"><svg viewBox="0 0 24 24">${IC[ic]}</svg>${inner}</span>`;
    const details = (company ? line('company', `<button type="button" class="link" id="toCompany">${esc(company.name)}</button>`) : '') +
      (c.jobTitle ? line('job', esc(c.jobTitle)) : '') +
      (c.phone ? line('phone', `<a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>`) : '') +
      (c.email ? line('email', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`) : '');
    const pen = `<button type="button" class="pencil" id="editHeader" aria-label="${esc(t('detail.edit'))}" title="${esc(t('detail.edit'))}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg></button>`;
    const status = `<label class="switch"><span>${esc(t(c.active ? 'status.active' : 'status.inactive'))}</span><input type="checkbox" id="activeToggle" ${c.active ? 'checked' : ''}><span class="tr"></span></label>`;
    $('detailHead').innerHTML = editingHeader
      ? `<div class="head-edit"><label class="f" for="hName" style="margin-top:0">${esc(t('field.name'))}</label><input type="text" id="hName" value="${esc(c.name)}" autocomplete="off">
          <input type="text" id="hJob" value="${esc(c.jobTitle || '')}" placeholder="${esc(t('field.job'))}" autocomplete="off" style="margin-top:8px">
          <label class="f">${esc(t('field.contact_details'))} <span class="opt">${esc(t('field.optional'))}</span></label>
          <input type="tel" id="hPhone" value="${esc(c.phone || '')}" placeholder="${esc(t('field.phone'))}" autocomplete="off" inputmode="tel">
          <input type="email" id="hEmail" value="${esc(c.email || '')}" placeholder="${esc(t('field.email'))}" autocomplete="off" inputmode="email" style="margin-top:8px">
          <div class="row2" style="margin-top:10px"><button type="button" class="obtn" id="hSave" style="flex:1">${esc(t('action.save'))}</button><button type="button" class="obtn quiet" id="hCancel">${esc(t('action.cancel'))}</button></div></div>
         <div class="statusrow" style="margin-top:12px"><b></b>${status}</div>`
      : `<div class="statusrow"><span class="namerow"><b>${esc(c.name)}</b>${pen}</span>${status}</div><div class="details">${details}</div>`;
    if ($('toCompany')) $('toCompany').onclick = () => { setMode('companies'); Companies.select(company); };
    if (editingHeader) initHeaderEdit(c); else $('editHeader').onclick = () => { editingHeader = true; renderDetail(); };
    $('activeToggle').onchange = e => busy($('activeToggle'), () => setActive(c, e.target.checked));
    renderTimeline(c);
    renderUpdateForm(c);
  }

  // Name, job title and contact details, e.g. completing a first name.
  function initHeaderEdit(c) {
    const inp = $('hName'); inp.focus(); inp.select();
    const ok = () => busy($('hSave'), async () => {
      const now = { name: inp.value.trim(), jobTitle: $('hJob').value.trim(), phone: $('hPhone').value.trim(), email: $('hEmail').value.trim() };
      if (!now.name) return inp.focus();
      if (Object.keys(now).some(k => now[k] !== (c[k] || ''))) {
        const r = await Store.updatePerson(c.id, now);
        const item = Recent.add({ personId: c.id, line: now.name !== c.name ? t('recent.renamed', { old: c.name }) : t('recent.details'), day: T() });
        Toast.show(now.name !== c.name ? t('toast.renamed', { name: now.name }) : t('toast.details'), '', async () => { await r.undo(); Recent.remove(item); });
      }
      editingHeader = false; renderDetail();
    });
    $('hSave').onclick = ok;
    $('hCancel').onclick = () => { editingHeader = false; renderDetail(); };
    ['hName', 'hJob', 'hPhone', 'hEmail'].forEach(i => { $(i).onkeydown = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') $('hCancel').click(); }; });
  }

  // Inactive changes nothing in stage or history; the contact only leaves the default list.
  async function setActive(c, on) {
    try {
      const r = await Store.addEntry({ personId: c.id, kind: 'status', happenedOn: M.iso(T()), status: on ? 'active' : 'inactive' });
      Toast.show(t(on ? 'toast.reactivated' : 'toast.deactivated', { name: c.name }), '', r.undo);
    } finally { renderDetail(); }
  }

  /* ---------- timeline ---------- */

  // One row per entry, with date, kind and the text under it. A row with more information
  // shows › and opens on a tap. Swipe or hover to correct or delete it.
  function renderTimeline(c) {
    const entries = Store.entriesOf(c.id), T0 = T();
    const nextText = e => e.nextStepOn ? `${esc(e.nextStep || t('next.default'))} · ${M.fmtDayLong(M.day(e.nextStepOn))}` : '';
    const row = (e, label, text, rows, cls, opts) => {
      const r = rows.filter(x => x[1]);
      const inner = `<button type="button" class="tlrow ${r.length ? 'can' : ''}" ${r.length ? 'aria-expanded="false"' : 'tabindex="-1"'}><small>${M.fmtDayLong(M.day(e.happenedOn))}</small><span class="lab">${label}</span>${r.length ? '<span class="chev">›</span>' : ''}${text ? `<q>${text}</q>` : ''}</button>` +
        (r.length ? `<div class="tlmore">${r.map(([k, v]) => `<div><b>${esc(k)}</b>${v}</div>`).join('')}</div>` : '');
      return `<li class="${cls} ${e.id === editingEntryId ? 'editing' : ''}">${SwipeRows.html(e.id, inner, opts)}</li>`;
    };
    const visitOf = Object.fromEntries(c.visits.map(v => [v.entryId, v.stageId]));
    const items = entries.map(e => {
      if (e.kind === 'first_contact') {
        const via = e.via ? ' · ' + esc(Store.viaLabel(e.via)) : '';
        return row(e, `${esc(t('timeline.new'))} · ${esc(Store.channelLabel(e.entryChannel))}${via}`, esc(e.hook), [[t('field.note'), esc(e.note)], [t('timeline.next_planned'), nextText(e)]], '', { canDelete: false });
      }
      if (e.kind === 'status') return row(e, esc(t(e.status === 'inactive' ? 'timeline.deactivated' : 'timeline.reactivated')), '', [], 'nt', { canEdit: false });
      const stageText = e.stageId ? esc(Store.stageLabel(e.stageId)) + (visitOf[e.id] ? '' : ' ' + esc(t('timeline.same_stage'))) : '';
      const amount = e.amount ? M.euro(e.amount) : '';
      if (e.action) return row(e, esc(t('timeline.action')), esc(e.action), [[t('timeline.stage'), stageText], [t('field.amount'), amount], [t('field.note'), esc(e.note)], [t('timeline.next_planned'), nextText(e)]], '');
      if (e.stageId) return row(e, stageText, esc(e.note), [[t('field.amount'), amount], [t('timeline.next_planned'), nextText(e)]], '');
      if (e.note) return row(e, esc(t('timeline.note')), esc(e.note), [[t('field.amount'), amount], [t('timeline.next_planned'), nextText(e)]], 'nt');
      return row(e, esc(t('timeline.next_planned')), nextText(e), [[t('field.amount'), amount]], 'nt');
    });
    // The next step comes last, in its own colour: it is what has to happen now.
    const n = c.nextStep;
    if (n) {
      const late = n.day < T0, src = Store.entry(n.entryId);
      const rows = src ? [[t('timeline.planned_on'), M.fmtDayLong(M.day(src.happenedOn))], [t('timeline.after'), esc(src.action || src.note)]].filter(x => x[1]) : [];
      const head = `<small>${esc(t('timeline.next'))} · ${M.fmtDayLong(n.day)}${late ? `<span class="pill late">${esc(t('list.days_late', { n: T0 - n.day }))}</span>` : ''}</small><b>${esc(n.text || t('next.default'))}</b>${rows.length ? '<span class="chev">›</span>' : ''}`;
      const inner = `<span class="nxbox"><button type="button" class="tlrow ${rows.length ? 'can' : ''}">${head}</button>${rows.length ? `<div class="tlmore">${rows.map(([k, x]) => `<div><b>${esc(k)}</b>${x}</div>`).join('')}</div>` : ''}</span>`;
      items.push(`<li class="nx">${SwipeRows.html('next:' + n.entryId, inner)}</li>`);
    }
    $('timeline').innerHTML = items.join('');
    SwipeRows.bind($('timeline'), {
      onTap: (id, e) => {
        const b = e.target.closest('.tlrow.can'); if (!b) return;
        const li = b.closest('li'); li.classList.toggle('open');
        b.setAttribute('aria-expanded', li.classList.contains('open'));
      },
      onEdit: id => id.startsWith('next:') ? startEdit(id.slice(5), true) : startEdit(id, false),
      onDelete: id => id.startsWith('next:') ? clearNextStep(id.slice(5)) : deleteEntry(id)
    });
  }

  async function deleteEntry(id) {
    const e = Store.entry(id);
    if (!confirmPopup(t('confirm.delete_entry', { day: M.fmtDayLong(M.day(e.happenedOn)) }))) return;
    try {
      const r = await Store.binEntry(id);
      if (editingEntryId === id) resetUpdateForm();
      Toast.show(t('toast.entry_binned'), '', r.undo);
    } catch (err) { Toast.error(err); }
    renderDetail();
  }

  // Removing the next step clears it from the entry that planned it.
  async function clearNextStep(entryId) {
    if (!confirmPopup(t('confirm.delete_next'))) return;
    try {
      const r = await Store.updateEntry(entryId, { nextStep: '', nextStepOn: null });
      Toast.show(t('toast.next_removed'), '', r.undo);
    } catch (err) { Toast.error(err); }
    renderDetail();
  }

  /* ---------- update form (new entry, or correcting one) ---------- */

  function resetUpdateForm() {
    editingEntryId = null; editingNextOf = null;
    Object.assign(st.u, { when: 'today', next: null, stage: null, channel: null, via: null });
    ['uAction', 'uNext', 'uNote', 'uAmount', 'uHook'].forEach(i => { $(i).value = ''; });
    DI.u.d.value = ''; DI.u.v.value = '';
    setLimits('u');
  }

  // Correcting fills the form below the timeline with the entry's values.
  function startEdit(entryId, focusNext) {
    const e = Store.entry(entryId);
    resetUpdateForm();
    editingEntryId = entryId; editingNextOf = focusNext ? entryId : null;
    st.u.when = 'date'; DI.u.d.value = e.happenedOn;
    if (e.nextStepOn) { st.u.next = 'date'; DI.u.v.value = e.nextStepOn; }
    $('uAction').value = e.action || ''; $('uNext').value = e.nextStep || ''; $('uNote').value = e.note || '';
    $('uAmount').value = e.amount || ''; $('uHook').value = e.hook || '';
    st.u.stage = e.kind === 'follow_up' && e.stageId ? e.stageId : null;
    st.u.channel = e.entryChannel || null; st.u.via = e.via || null;
    renderDetail(); regrowAll();
    $('updateForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $(focusNext ? 'uNext' : (e.kind === 'first_contact' ? 'uNote' : 'uAction')).focus({ preventScroll: true });
  }

  // The stage a person was in just before an entry (or now, for a new entry).
  // The stage choice starts there: leaving it selected means the entry changes nothing.
  function baseStage(c, e) {
    if (!e) return c.stageId;
    const all = Store.entriesOf(c.id);
    return M.derivePerson(c, all.slice(0, all.findIndex(x => x.id === e.id))).stageId;
  }

  function renderUpdateForm(c) {
    const e = editingEntryId && Store.entry(editingEntryId), first = e && e.kind === 'first_contact';
    $('updateTitle').textContent = t(e ? 'update.edit_title' : 'update.title');
    $('uActionWrap').classList.toggle('hidden', !!first);
    $('uStageWrap').classList.toggle('hidden', !!first);
    $('uFirstWrap').classList.toggle('hidden', !first);
    // Every active stage can be chosen: back, forward or skipping. The stage the person is in
    // is selected; leaving it selected changes nothing. An archived stage the person is in
    // (or that this entry set) stays visible, so you can see it, but can only be left.
    const base = baseStage(c, e), chosen = st.u.stage || base;
    const shown = Store.stages().filter(s => !Store.stageArchived(s) || s.id === base || (e && s.id === e.stageId));
    $('uStage').innerHTML = seg(shown.map(s => [s.id, Store.stageLabel(s)]), chosen);
    $('uAmountWrap').classList.toggle('hidden', chosen !== M.END_STAGE);
    if (first) {
      const ch = Store.channel(st.u.channel);
      $('uChannel').innerHTML = seg(Store.channels().map(x => [x.key, Store.channelLabel(x.key)]), st.u.channel);
      $('uVia').innerHTML = chips(Store.viaOptions().map(k => [k, Store.viaLabel(k)]), st.u.via);
      $('uViaWrap').classList.toggle('hidden', !(ch && ch.asksVia));
    }
    renderDates('u');
    $('saveUpdate').textContent = t(e ? 'update.save_edit' : 'action.save');
    $('cancelEdit').classList.toggle('hidden', !e);
  }

  async function saveUpdate() {
    const c = selected(), d = dayFrom('u'), w = M.weekOf(d), before = Store.counts().improvements(w);
    const e = editingEntryId && Store.entry(editingEntryId), first = e && e.kind === 'first_contact';
    const action = first ? '' : $('uAction').value.trim(), note = $('uNote').value.trim();
    const base = baseStage(c, e), chosen = st.u.stage || base;
    const stageId = first ? M.START_STAGE : (chosen === base ? null : chosen);
    const amount = chosen === M.END_STAGE ? (parseFloat($('uAmount').value) || null) : null;
    const next = nextFrom('u', $('uNext').value.trim());
    const fields = { happenedOn: M.iso(d), action, note, stageId, amount, nextStep: next ? next.text : '', nextStepOn: next ? M.iso(next.day) : null };
    if (first) {
      const ch = Store.channel(st.u.channel);
      Object.assign(fields, { entryChannel: st.u.channel, via: ch && ch.asksVia ? st.u.via : null, hook: ch && ch.asksVia ? $('uHook').value.trim() : '' });
    }
    const error = M.validateEntry({ kind: first ? 'first_contact' : 'follow_up', ...fields }, T());
    if (error) { Toast.show(t(error), 'error'); return; }
    if (e) {
      const r = await Store.updateEntry(e.id, fields);
      const item = Recent.add({ personId: c.id, line: t('recent.corrected'), day: d });
      Toast.show(t('toast.corrected'), '', async () => { await r.undo(); Recent.remove(item); });
      resetUpdateForm(); renderDetail();
      return;
    }
    const r = await Store.addEntry({ personId: c.id, kind: 'follow_up', ...fields });
    const result = stageId ? Store.stageLabel(stageId).toLowerCase() : next ? t('recent.next_planned') : note ? t('recent.note') : '';
    const item = Recent.add({ personId: c.id, line: [action, result].filter(Boolean).join(' · ') || t('recent.updated'), day: d });
    Reward.show(before, w, t('toast.updated', { name: c.name }), async () => { await r.undo(); Recent.remove(item); });
    closeDetail(); renderList();
  }

  async function deletePerson() {
    const c = selected();
    if (!confirmPopup(t('confirm.delete_contact', { name: c.name }))) return;
    const r = await Store.deletePerson(c.id);
    Toast.show(t('toast.contact_archived', { name: c.name }), '', r.undo);
    closeDetail(); renderList();
  }

  function initDetail() {
    $('uStage').onclick = e => { const b = e.target.closest('button'); if (b) { st.u.stage = b.dataset.k; renderDetail(); } };
    $('uChannel').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) { st.u.channel = k; renderDetail(); } };
    $('uVia').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) { st.u.via = st.u.via === k ? null : k; renderDetail(); } };
    $('saveUpdate').onclick = () => busy($('saveUpdate'), saveUpdate);
    $('cancelEdit').onclick = () => { resetUpdateForm(); renderDetail(); regrowAll(); };
    $('deletePerson').onclick = () => busy($('deletePerson'), deletePerson);
  }

  /* =============================================
     Public
     ============================================= */

  function init() {
    initDates(); initNew(); initList(); initDetail();
    $('tabs').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) setMode(k); };
  }

  // After a change from elsewhere (undo, reload): show again what is open, without clearing forms.
  function refresh() {
    if (mode === 'contacts') { if (selectedId) renderDetail(); else renderList(); }
    if (mode === 'companies') Companies.refresh();
    if (mode === 'new') renderNew();
  }

  return { init, setMode, openNew, select, refresh, renderNew };
})();
