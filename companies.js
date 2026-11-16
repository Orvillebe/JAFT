/**
 * JAFT Companies - the Bedrijven tab on the "Contact ingeven" page.
 *
 * Responsibilities:
 *   - Search list of companies and "+ Nieuw bedrijf"
 *   - Saving a company (name, general details, note); a name another active company has is refused
 *   - Active or inactive: an inactive company rests with all its contacts, and nothing is added to it
 *   - Contact persons not yet contacted: add, correct, delete, enter the first contact
 *   - Showing and opening the contacts at this company
 *   - Deleting the company: to the bin when empty, otherwise archived with everyone linked
 *
 * The "Nieuw contact" form and a contact's detail are in contacts.js.
 */

const Companies = (() => {
  const { $, esc, regrowAll, busy, confirmPopup } = UI;
  const M = Model;
  let selectedId = null, isNew = false, showAll = false, editingPersonId = null, statusFilter = 'active';
  const selected = () => selectedId && Store.company(selectedId);

  // Short status: how many contacts, and how many contact persons still to contact.
  function info(c) {
    const n = Store.contactsOf(c.id).length, p = Store.contactPersonsOf(c.id).length;
    return [c.website || '', t(n === 1 ? 'company.contacts_one' : n ? 'company.contacts_many' : 'company.contacts_none', { n }),
      p ? t(p === 1 ? 'company.persons_one' : 'company.persons_many', { n: p }) : ''].filter(Boolean).join(' · ');
  }

  /* ---------- list ---------- */

  function renderList() {
    const text = $('cSearch').value.trim(), ws = text.toLowerCase().split(/\s+/).filter(Boolean);
    const match = c => {
      const s = [c.name, c.phone, c.email, c.website, ...Store.contactPersonsOf(c.id).map(p => p.name)].filter(Boolean).join(' ').toLowerCase();
      return ws.every(w => s.includes(w));
    };
    $('cStatusFilter').innerHTML = UI.seg([['active', t('filter.active')], ['inactive', t('filter.inactive')], ['all', t('filter.all')]], statusFilter);
    const shown = c => statusFilter === 'all' || (statusFilter === 'active') === Store.companyActive(c);
    const cs = Store.companies().filter(shown).filter(match).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    const limit = showAll || text ? cs.length : JAFT_CONFIG.listLength;
    $('cList').innerHTML = cs.slice(0, limit).map(c =>
      `<button type="button" class="item ${Store.companyActive(c) ? '' : 'off'}" data-cid="${esc(c.id)}"><span class="r1"><b>${esc(c.name)}</b>${Store.companyActive(c) ? '' : `<span class="pill inactive">${esc(t('status.inactive'))}</span>`}</span><span class="sub">${esc(info(c))}</span>${c.note ? `<span class="nx muted">${esc(c.note)}</span>` : ''}</button>`
    ).join('') +
      (limit < cs.length ? `<button type="button" class="more" id="cMore">${esc(t('list.show_all', { n: cs.length }))}</button>` : '') +
      (cs.length ? '' : `<div class="empty">${esc(text ? t('company.none_for', { text }) : t('company.none'))}</div>`);
    const m = $('cMore'); if (m) m.onclick = () => { showAll = true; renderList(); };
  }

  // "Terug": to the list, or to where the company was opened from (Te doen).
  let backTo = null;
  function close() {
    selectedId = null; isNew = false;
    $('cDetail').classList.add('hidden'); $('cPick').classList.remove('hidden');
    const back = backTo; backTo = null;
    if (back) back(); else renderList();
  }
  // Opened from elsewhere, optionally with a contact person's form open to complete their details.
  function openFor(c, { person = null, back = null } = {}) {
    select(c); backTo = back;
    if (back) $('cBack').textContent = t('company.back_todo');
    if (person) openPersonForm(person);
  }

  /* ---------- one company ---------- */

  // Without a company: a new one.
  function select(c) {
    selectedId = c ? c.id : null; isNew = !c; backTo = null;
    $('cName').value = c ? c.name : ''; $('cPhone').value = c ? c.phone : ''; $('cEmail').value = c ? c.email : ''; $('cWeb').value = c ? c.website : '';
    $('cNote').value = c ? c.note : '';
    $('cDuplicate').classList.add('hidden');
    $('cPick').classList.add('hidden'); $('cDetail').classList.remove('hidden');
    $('cBack').textContent = t(c ? 'company.back' : 'company.back_list');
    $('deleteCompany').classList.toggle('hidden', !c);
    closePersonForm(); renderPeople(); regrowAll(); window.scrollTo(0, 0);
  }

  // The status row: a switch, and since when the company rests. Inactive: nothing can be added.
  function renderStatus() {
    const c = selected();
    $('cStatus').classList.toggle('hidden', !c);
    if (!c) return;
    const on = Store.companyActive(c);
    const since = on ? '' : `<span class="since">${esc(t('company.inactive_since', { day: M.fmtDayLong(M.day(c.inactiveSince)) }))}</span>`;
    $('cStatus').innerHTML = `${since || '<span></span>'}<label class="switch"><span>${esc(t(on ? 'status.active' : 'status.inactive'))}</span><input type="checkbox" id="cActiveToggle" ${on ? 'checked' : ''}><span class="tr"></span></label>`;
    $('cActiveToggle').onchange = e => busy($('cActiveToggle'), () => setStatus(e.target.checked));
    $('cButtons').classList.toggle('hidden', !on || !$('pForm').classList.contains('hidden'));
    $('cInactiveNote').classList.toggle('hidden', on);
    $('cInactiveNote').textContent = on ? '' : t('company.inactive_note', { name: c.name });
  }

  // Inactive: every active contact rests with the company. Contacts with an open next step are
  // named first, so you can still cancel (and move someone who left to another company first).
  // Active again: you choose which inactive contacts come back; those that rested with it are ticked.
  async function setStatus(on) {
    const c = selected();
    try {
      let r;
      if (!on) {
        const active = Store.contactsOf(c.id).filter(p => p.active), withStep = active.filter(p => p.nextStep);
        const list = withStep.map(p => `• ${p.name}: ${p.nextStep.text || t('next.default')} (${M.fmtDayLong(p.nextStep.day)})`).join('\n');
        if (withStep.length && !confirmPopup(t('company.confirm_inactive', { name: c.name, list }))) return;
        r = await Store.setCompanyStatus(c.id, false, active.map(p => p.id));
        Toast.show(t(active.length ? 'toast.company_inactive_with' : 'toast.company_inactive', { name: c.name, n: active.length }), '', r.undo);
      } else {
        const resting = Store.contactsOf(c.id).filter(p => !p.active);
        let ids = [];
        if (resting.length) {
          ids = await UI.askChoice({
            text: t('company.ask_reactivate', { name: c.name }), ok: t('company.reactivate'),
            items: resting.map(p => ({ id: p.id, label: p.name, sub: t(p.restsWithCompany ? 'company.rested_with' : 'company.rested_before'), checked: p.restsWithCompany }))
          });
          if (ids === null) return;
        }
        r = await Store.setCompanyStatus(c.id, true, ids);
        Toast.show(t(ids.length ? 'toast.company_active_with' : 'toast.company_active', { name: c.name, n: ids.length }), '', r.undo);
      }
    } finally { renderStatus(); renderPeople(); }
  }

  function renderPeople() {
    const c = selected();
    $('cPeopleWrap').classList.toggle('hidden', !c);
    renderStatus();
    if (!c) return;
    const ps = Store.contactPersonsOf(c.id).map(p => SwipeRows.html(p.id,
      `<span class="item static ${Store.companyActive(c) ? '' : 'off'}"><span class="r1"><b>${esc(p.name)}</b><span class="pill">${esc(t('person.not_contacted'))}</span></span>${p.jobTitle || p.phone || p.email ? `<span class="sub">${esc([p.jobTitle, p.phone, p.email].filter(Boolean).join(' · '))}</span>` : ''}</span>`)).join('');
    const cs = Store.contactsOf(c.id).map(p => `<button type="button" class="item ${p.active ? '' : 'off'}" data-id="${esc(p.id)}"><span class="r1"><b>${esc(p.name)}</b><span>${p.active ? '' : `<span class="pill inactive">${esc(t('status.inactive'))}</span> `}<span class="pill">${esc(Store.stageLabel(p.stageId))}</span></span></span>${p.nextStep ? `<span class="nx">${esc(p.nextStep.text || t('next.default'))} · ${UI.dueText(p.nextStep.day)}</span>` : ''}</button>`).join('');
    $('cPeople').innerHTML = ps + cs || `<div class="empty">${esc(t('company.no_people'))}</div>`;
    SwipeRows.bind($('cPeople'), {
      onTap: id => openPersonForm(Store.person(id)),
      onEdit: id => openPersonForm(Store.person(id)),
      onDelete: id => deleteContactPerson(id)
    });
  }

  // Same name as another active company: a message with a link to it. Saving is refused (names are unique).
  function duplicateCheck() {
    const others = Store.companiesNamed($('cName').value).filter(c => c.id !== selectedId);
    $('cDuplicate').classList.toggle('hidden', !others.length);
    if (others.length) {
      $('cDuplicate').innerHTML = esc(t('company.exists')) + others.map(o =>
        `<button type="button" class="link-btn" data-cid="${esc(o.id)}">${esc(o.name)}${o.website ? ' · ' + esc(o.website) : ''} ›</button>`).join('');
      $('cDuplicate').querySelectorAll('[data-cid]').forEach(b => { b.onclick = () => select(Store.company(b.dataset.cid)); });
    }
  }

  async function save() {
    const name = $('cName').value.trim();
    if (!name) { $('cName').focus(); return; }
    // Names are unique: the message under the name says which company has it.
    if (Store.companiesNamed(name).some(o => o.id !== selectedId)) { duplicateCheck(); $('cName').focus(); return; }
    const r = await Store.saveCompany(isNew ? null : selectedId, {
      name, phone: $('cPhone').value.trim(), email: $('cEmail').value.trim(), website: $('cWeb').value.trim(), note: $('cNote').value.trim()
    });
    const item = Recent.add({ name: r.company.name, company: '', line: t(isNew ? 'recent.company_new' : 'recent.company_updated'), day: M.today() });
    Toast.show(t('toast.saved', { name: r.company.name }), '', async () => { await r.undo(); Recent.remove(item); });
    close();
  }

  // Empty: to the bin. Otherwise archived with everyone linked, who are named first.
  async function deleteCompany() {
    const c = selected(), links = Store.companyLinks(c.id);
    const names = list => list.map(p => p.name).join(', ');
    let text = t('confirm.delete_company_empty', { name: c.name });
    if (links.contacts.length || links.contactPersons.length) {
      text = t('confirm.delete_company', { name: c.name }) +
        (links.contacts.length ? '\n• ' + t(links.contacts.length === 1 ? 'confirm.linked_contact' : 'confirm.linked_contacts', { n: links.contacts.length, names: names(links.contacts) }) : '') +
        (links.contactPersons.length ? '\n• ' + t(links.contactPersons.length === 1 ? 'confirm.linked_person' : 'confirm.linked_persons', { n: links.contactPersons.length, names: names(links.contactPersons) }) : '') +
        (links.contacts.length ? '\n' + t('confirm.not_counted') : '');
    }
    if (!confirmPopup(text)) return;
    const r = await Store.deleteCompany(c.id);
    Toast.show(t(r.binned ? 'toast.company_binned' : 'toast.company_archived', { name: c.name }), '', r.undo);
    close();
  }

  /* ---------- contact persons ---------- */
  // Adding or correcting happens in a small form under the list.

  function openPersonForm(p) {
    editingPersonId = p ? p.id : null;
    $('pName').value = p ? p.name : ''; $('pJob').value = p ? p.jobTitle || '' : ''; $('pPhone').value = p ? p.phone : ''; $('pEmail').value = p ? p.email : '';
    $('pForm').classList.remove('hidden'); $('cButtons').classList.add('hidden');
    $('pFirstContact').classList.toggle('hidden', !p || !Store.companyActive(selected()));
    $('pName').focus();
  }
  function closePersonForm() { editingPersonId = null; $('pForm').classList.add('hidden'); $('cButtons').classList.toggle('hidden', !Store.companyActive(selected())); }

  async function savePerson() {
    const c = selected(), name = $('pName').value.trim();
    if (!name) { $('pName').focus(); return; }
    const v = { name, jobTitle: $('pJob').value.trim(), phone: $('pPhone').value.trim(), email: $('pEmail').value.trim() };
    const r = editingPersonId ? await Store.updatePerson(editingPersonId, v) : await Store.addContactPerson(c.id, v);
    const item = Recent.add({ name, company: c.name, line: t(editingPersonId ? 'recent.person_updated' : 'recent.person_new'), day: M.today() });
    Toast.show(t('toast.saved', { name }), '', async () => { await r.undo(); Recent.remove(item); });
    closePersonForm(); renderPeople();
  }

  async function deleteContactPerson(id) {
    const p = Store.person(id);
    if (!confirmPopup(t('confirm.delete_person', { name: p.name }))) return;
    try {
      const r = await Store.deletePerson(id);
      if (editingPersonId === id) closePersonForm();
      Toast.show(t('toast.person_binned', { name: p.name }), '', r.undo);
    } catch (e) { Toast.error(e); }
    renderPeople();
  }

  function init() {
    $('cSearch').oninput = renderList;
    $('cStatusFilter').onclick = e => { const k = e.target.closest('button')?.dataset.k; if (k) { statusFilter = k; showAll = false; renderList(); } };
    $('cList').onclick = e => { const b = e.target.closest('.item'); if (b) select(Store.company(b.dataset.cid)); };
    $('cNew').onclick = () => { const text = $('cSearch').value.trim(); select(null); if (text) { $('cName').value = text; duplicateCheck(); } $('cName').focus(); };
    $('cBack').onclick = close;
    $('cName').oninput = duplicateCheck;
    $('cSave').onclick = () => busy($('cSave'), save);
    $('deleteCompany').onclick = () => busy($('deleteCompany'), deleteCompany);
    $('pNew').onclick = () => openPersonForm(null);
    $('pCancel').onclick = closePersonForm;
    $('pSave').onclick = () => busy($('pSave'), savePerson);
    $('pFirstContact').onclick = () => { const p = Store.person(editingPersonId); closePersonForm(); Contacts.openNew({ person: p }); };
    $('cPeople').addEventListener('click', e => {
      const b = e.target.closest('button.item[data-id]'); if (!b) return;
      Contacts.setMode('contacts'); Contacts.select(b.dataset.id);
    });
    $('cNewContact').onclick = () => Contacts.openNew({ company: selected() });
  }

  // When the tab opens: the chosen company, or the list.
  function show() { if (selectedId || isNew) renderPeople(); else renderList(); }

  // After a change from elsewhere: a company that disappeared closes, otherwise show again.
  function refresh() {
    if (selectedId && !selected()) return close();
    show();
  }

  return { init, select, openFor, show, refresh, info };
})();
