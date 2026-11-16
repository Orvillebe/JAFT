/**
 * JAFT To do - the Te doen tab on the "Contact ingeven" page.
 *
 * Responsibilities:
 *   - One list to plan tasks from, in three groups (rules in Model.todo):
 *       Volgende stappen  next steps that light up (Instellingen › Volgende stap), earliest first
 *       Te contacteren    contact persons and companies with a phone or e-mail
 *       Info zoeken       the same without, with the export of companies where nobody has any
 *   - Only what needs attention now: an empty group is left out
 *   - A tap opens the contact, the first-contact form, or the company to complete;
 *     "Terug" there comes back here
 */

const Todo = (() => {
  const { $, esc } = UI;

  const group = (key, n, extra = '') =>
    `<div class="group todo-group"><span>${esc(t('todo.' + key))} · ${n}</span>${extra}</div>`;
  const company = c => c ? c.name : t('list.no_company');

  function nextRow(p) {
    return `<button type="button" class="item" data-open="contact" data-id="${esc(p.id)}"><span class="r1"><b>${esc(p.name)}</b></span>` +
      `<span class="sub">${esc(company(Store.company(p.companyId)))}</span>` +
      `<span class="nx">${esc(p.nextStep.text || t('next.default'))} · ${UI.dueText(p.nextStep.day)}</span></button>`;
  }

  // A contact person (with their company and how to reach them) or a company with nobody yet.
  function personOrCompanyRow(x, open) {
    const tag = `<span class="pill">${esc(t(x.kind === 'person' ? 'todo.tag_person' : 'todo.tag_company'))}</span>`;
    const p = x.item;
    const reach = x.kind === 'person'
      ? [x.company.name, p.jobTitle, p.phone, p.email, x.via && t('todo.via_company', { info: x.via.phone || x.via.email })]
      : [p.phone, p.email, p.website];
    const sub = reach.filter(Boolean).join(' · ');
    return `<button type="button" class="item" data-open="${open}" data-kind="${x.kind}" data-id="${esc(p.id)}"><span class="r1"><b>${esc(p.name)}</b>${tag}</span>` +
      (sub ? `<span class="sub">${esc(sub)}</span>` : '') + '</button>';
  }

  function render() {
    const r = Store.todo();
    const exportBtn = `<span class="todo-export"><label class="incl"><input type="checkbox" id="todoExportInactive"> ${esc(t('export.with_inactive'))}</label>` +
      `<button type="button" class="link" id="todoExport">${esc(t('todo.export'))}</button></span>`;
    const html = [
      r.next.length ? group('next', r.next.length) + r.next.map(nextRow).join('') : '',
      r.contact.length ? group('contact', r.contact.length) + r.contact.map(x => personOrCompanyRow(x, 'first')).join('') : '',
      r.search.length ? group('search', r.search.length, exportBtn) + r.search.map(x => personOrCompanyRow(x, 'edit')).join('') : ''
    ].join('');
    $('todoList').innerHTML = html || `<div class="empty">${esc(t('todo.nothing'))}</div>`;
    const ex = $('todoExport'); if (ex) ex.onclick = exportCompanies;
  }

  // Inactive companies only when asked, for this export.
  function exportCompanies() {
    const box = $('todoExportInactive');
    UI.download(`jaft-bedrijven-zonder-gegevens-${Model.iso(Model.today())}.csv`, Exporter.companiesWithoutInfo({ withInactive: box.checked }), 'text/csv;charset=utf-8');
    box.checked = false;
  }

  function open(b) {
    const id = b.dataset.id, back = () => Contacts.setMode('todo');
    if (b.dataset.open === 'contact') return Contacts.openDetail(id, back);
    if (b.dataset.kind === 'company') {
      if (b.dataset.open === 'first') return Contacts.openNew({ company: Store.company(id) });
      Contacts.setMode('companies'); return Companies.openFor(Store.company(id), { back });
    }
    const p = Store.person(id);
    if (b.dataset.open === 'first') return Contacts.openNew({ person: p });
    Contacts.setMode('companies'); Companies.openFor(Store.company(p.companyId), { person: p, back });
  }

  function init() {
    $('todoList').onclick = e => { const b = e.target.closest('.item'); if (b) open(b); };
  }

  return { init, render };
})();
